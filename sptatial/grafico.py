# -*- coding: utf-8 -*-
"""
Krigagem com seleção automática do melhor variograma (Spherical, Exponential, Gaussian)
e export de GeoTIFFs (predição e variância) por variável.

Requisitos:
    pip install geopandas gstools rasterio numpy pandas shapely scipy
"""

import warnings
warnings.filterwarnings("ignore")

from pathlib import Path
import numpy as np
import pandas as pd
import geopandas as gpd
import rasterio
from rasterio.transform import from_origin

import gstools as gs
from sklearn.metrics import mean_squared_error, mean_absolute_error
from scipy.spatial.distance import pdist
from scipy.spatial import cKDTree


# ================== CONFIG ==================
INPUT = "pontos_2ha_com_atributos.geojson"
VARIAVEIS = ["N_pct", "P_mgdm3", "K_mgdm3", "Mg_cmolcdm3"]

BIN_NUM = 12                  # nº de classes de distância do variograma experimental
MAX_DIST_FACTOR = 0.6         # fração da maior distância para limitar o ajuste
CELL_SIZE_M = None            # None => estima automaticamente; ou defina ex.: 5.0
BBOX_PAD_MULT = 0.5           # padding (em múltiplos de cell_size) no envelope

MODELOS = {
    "Spherical": gs.Spherical,
    "Exponential": gs.Exponential,
    "Gaussian": gs.Gaussian,
}

OUT_DIR = Path("kriging_out")
OUT_DIR.mkdir(exist_ok=True)


# =============== HELPERS ====================
def as_dim_n(coords_xy: np.ndarray) -> np.ndarray:
    """Converte (n,2) -> (2,n), formato que GSTools espera em cond_pos e nas predições pontuais."""
    coords_xy = np.asarray(coords_xy, dtype=float)
    if coords_xy.ndim != 2 or coords_xy.shape[1] != 2:
        raise ValueError("coords_xy deve ter shape (n, 2).")
    return coords_xy.T


def reproject_to_metric(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Projeta para um CRS métrico (UTM estimado pela extensão)."""
    metric_crs = gdf.estimate_utm_crs()
    return gdf.to_crs(metric_crs)


def estimate_cell_size(coords_xy: np.ndarray) -> float:
    """Resolução ≈ mediana da distância ao vizinho mais próximo / 4 (mínimo 1 m)."""
    tree = cKDTree(coords_xy)
    dists, _ = tree.query(coords_xy, k=2)  # [self, nearest]
    med = np.nanmedian(dists[:, 1])
    if not np.isfinite(med) or med <= 0:
        med = 10.0
    return max(1.0, float(med / 4.0))


def vario_fit(coords_xy: np.ndarray, values: np.ndarray, model_cls, bin_num=12, max_dist=None):
    """Estima variograma experimental e ajusta um modelo teórico com nugget."""
    pos = as_dim_n(coords_xy)                       # (2,n) para GSTools
    bc, gamma = gs.vario_estimate(pos, values, bin_num=bin_num, max_dist=max_dist)
    model = model_cls(dim=2)
    model.fit_variogram(bc, gamma, nugget=True)     # ajusta nugget automaticamente
    return model, (bc, gamma)


def loo_rmse_mae_me(coords_xy: np.ndarray, values: np.ndarray, model_cls):
    """Validação leave-one-out usando krigagem ordinária (GSTools)."""
    n = len(values)
    preds = np.zeros(n, dtype=float)

    for i in range(n):
        mask = np.ones(n, dtype=bool)
        mask[i] = False
        coords_train = coords_xy[mask]
        values_train = values[mask]

        # Distância robusta: 95º percentil — SciPy pdist trabalha com (n,2)
        dists = pdist(coords_train)
        max_dist = np.quantile(dists, 0.95) if dists.size else None

        model, _ = vario_fit(coords_train, values_train, model_cls, bin_num=BIN_NUM, max_dist=max_dist)

        ok = gs.krige.Ordinary(model, cond_pos=as_dim_n(coords_train), cond_val=values_train)
        pred_i, _ = ok(as_dim_n(coords_xy[i].reshape(1, 2)))  # predição no ponto i
        preds[i] = float(pred_i)

    rmse = mean_squared_error(values, preds, squared=False)
    mae  = mean_absolute_error(values, preds)
    me   = float(np.mean(preds - values))  # viés
    return rmse, mae, me


def model_params(model) -> dict:
    """Extrai parâmetros principais do modelo GSTools."""
    return dict(
        nugget=float(getattr(model, "nugget", np.nan)),
        sill=float(getattr(model, "sill", np.nan)),
        range_m=float(getattr(model, "len_scale", np.nan)),
    )


def build_grid(bounds, cell_size: float, pad_mult: float = 0.5):
    """Cria grid regular (xs, ys, xv, yv) cobrindo o envelope com padding."""
    minx, miny, maxx, maxy = bounds
    pad = max(cell_size, cell_size * pad_mult)
    minx -= pad; maxx += pad
    miny -= pad; maxy += pad

    xs = np.arange(minx, maxx + cell_size, cell_size, dtype=float)
    ys = np.arange(maxy, miny - cell_size, -cell_size, dtype=float)  # de cima p/ baixo (linha 0 = topo)
    xv, yv = np.meshgrid(xs, ys)  # 2D
    return xs, ys, xv, yv


def write_geotiff(path: Path, array2d: np.ndarray, xs: np.ndarray, ys: np.ndarray, crs):
    """Escreve um GeoTIFF float32. ys deve estar em ordem decrescente (top->down)."""
    height, width = array2d.shape
    px = float(xs[1] - xs[0]) if len(xs) > 1 else 1.0
    py = float(ys[0] - ys[1]) if len(ys) > 1 else 1.0
    transform = from_origin(float(xs[0]), float(ys[0]), px, py)

    profile = {
        "driver": "GTiff",
        "height": height,
        "width": width,
        "count": 1,
        "dtype": rasterio.float32,
        "crs": crs,
        "transform": transform,
        "compress": "deflate",
        "predictor": 2,
        "tiled": True,
        "blockxsize": min(256, width),
        "blockysize": min(256, height),
    }

    with rasterio.open(path, "w", **profile) as dst:
        dst.write(np.asarray(array2d, dtype=np.float32), 1)


# =============== PIPELINE ======================
def main():
    in_path = Path(INPUT)
    if not in_path.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {in_path.resolve()}")

    gdf = gpd.read_file(in_path)
    if gdf.empty:
        raise ValueError("GeoDataFrame vazio.")
    if not all(gt == "Point" for gt in gdf.geometry.geom_type):
        raise ValueError("A geometria deve ser do tipo Point.")

    # reprojeta para métrico
    gdf_m = reproject_to_metric(gdf)
    crs_m = gdf_m.crs

    # coordenadas (m)
    x = gdf_m.geometry.x.to_numpy(dtype=float)
    y = gdf_m.geometry.y.to_numpy(dtype=float)
    coords_xy = np.column_stack([x, y])  # (n,2)

    # resolução do raster
    cell_size = float(CELL_SIZE_M) if CELL_SIZE_M else estimate_cell_size(coords_xy)

    # distância global (p/ limitar max_dist no variograma)
    all_dists = pdist(coords_xy)
    max_dist_glob = np.max(all_dists) * MAX_DIST_FACTOR if all_dists.size else None

    # grid de saída
    xs, ys, xv, yv = build_grid(gdf_m.total_bounds, cell_size, pad_mult=BBOX_PAD_MULT)
    print(f"[INFO] Grid: {len(xs)} x {len(ys)} pixels | resolução ≈ {cell_size:.2f} m")

    resultados = []

    for var in VARIAVEIS:
        if var not in gdf_m.columns:
            print(f"[AVISO] Variável '{var}' não encontrada. Pulando.")
            continue

        vals = gdf_m[var].to_numpy(dtype=float)
        mask = np.isfinite(vals)
        if mask.sum() < 6:
            print(f"[AVISO] Variável '{var}' tem poucos dados válidos (<6). Pulando.")
            continue

        vals = vals[mask]
        coords_valid = coords_xy[mask]

        # validação LOO em cada modelo
        metricas = {}
        for nome, cls in MODELOS.items():
            try:
                rmse, mae, me = loo_rmse_mae_me(coords_valid, vals, cls)
            except Exception as e:
                print(f"[ERRO] LOO {var} - {nome}: {e}")
                rmse, mae, me = np.inf, np.inf, np.inf
            metricas[nome] = dict(rmse=rmse, mae=mae, me=me)

        # escolhe melhor por RMSE
        best_name = min(metricas, key=lambda k: metricas[k]["rmse"])
        best_cls = MODELOS[best_name]

        # ajusta modelo final com todos os dados válidos
        best_model, _ = vario_fit(coords_valid, vals, best_cls, bin_num=BIN_NUM, max_dist=max_dist_glob)
        best_params = model_params(best_model)

        # krigagem ordinária no grid
        ok = gs.krige.Ordinary(best_model, cond_pos=as_dim_n(coords_valid), cond_val=vals)
        field, variance = ok((xv, yv))  # superfícies 2D (predição e variância)

        # grava GeoTIFFs
        pred_tif = OUT_DIR / f"{var}__{best_name}_pred.tif"
        var_tif  = OUT_DIR / f"{var}__{best_name}_var.tif"
        write_geotiff(pred_tif, field, xs, ys, crs_m)
        write_geotiff(var_tif, variance, xs, ys, crs_m)

        resultados.append({
            "variavel": var,
            "melhor_modelo": best_name,
            "RMSE": metricas[best_name]["rmse"],
            "MAE": metricas[best_name]["mae"],
            "ME_vies": metricas[best_name]["me"],
            "nugget": best_params["nugget"],
            "sill": best_params["sill"],
            "range_m": best_params["range_m"],
            "pred_tif": str(pred_tif),
            "var_tif": str(var_tif),
        })

        # logging
        print(f"\n=== {var} ===")
        for nome, m in metricas.items():
            print(f"{nome:11s} -> RMSE={m['rmse']:.4f} | MAE={m['mae']:.4f} | ME={m['me']:.4f}")
        print(f"** Melhor: {best_name} | params: nugget={best_params['nugget']:.4f}, "
              f"sill={best_params['sill']:.4f}, range≈{best_params['range_m']:.2f} m")
        print(f"-> GeoTIFFs: {pred_tif.name}, {var_tif.name}")

    if resultados:
        df = pd.DataFrame(resultados)
        out_csv = OUT_DIR / "kriging_model_selection_summary.csv"
        df.to_csv(out_csv, index=False)
        print(f"\n>>> Resumo salvo em: {out_csv.resolve()}")
        print(df.to_string(index=False))
    else:
        print("\nNenhuma variável processada.")


if __name__ == "__main__":
    main()
