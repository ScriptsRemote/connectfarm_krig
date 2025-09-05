# -*- coding: utf-8 -*-
"""
Interpolação (IDW e, se disponível, Krigagem) para malha de pontos com N/P/K/Mg.
- Lê um .gpkg (layer 'amostras') ou .geojson com pontos
- Gera rasters 10 m e PNGs com paleta RdYlGn (vermelho→amarelo→verde)
- Salva resumo em CSV

Autor: você
"""

import os
from pathlib import Path
import numpy as np
import pandas as pd
import geopandas as gpd
import matplotlib.pyplot as plt
from shapely.ops import unary_union
from scipy.spatial import cKDTree
import rasterio
from rasterio.transform import from_origin
from rasterio.features import rasterize

# ============== CONFIG ==============
INFILE   = Path("pontos_2ha_com_atributos.geojson")  # troque pelo seu arquivo (.gpkg ou .geojson)
IN_LAYER = "amostras"                              # ignorado para GeoJSON
OUTDIR   = Path("saidas_interpolacao")
OUTDIR.mkdir(parents=True, exist_ok=True)

CRS_METRIC = "EPSG:31982"  # SIRGAS 2000 / UTM 22S (RS)
PIX = 10                   # resolução (m)

# IDW
IDW_K = 12
IDW_P = 2.0

# Krigagem
USE_KRIGING = True         # deixe True; se faltar pykrige, cai fora sozinho
KRIG_VARIOMODEL = "spherical"

# Variáveis (coluna -> (título, unidade))
VARMAP = {
    "N_pct": ("Nitrogênio Total", "%"),
    "P_mgdm3": ("Fósforo disponível", "mg/dm³"),
    "K_mgdm3": ("Potássio trocável", "mg/dm³"),
    "Mg_cmolcdm3": ("Magnésio trocável", "cmolc/dm³"),
}
# ===================================


# ============== FUNÇÕES ==============
def load_points(path: Path, layer: str = None) -> gpd.GeoDataFrame:
    if path.suffix.lower() == ".gpkg":
        gdf = gpd.read_file(path, layer=layer)
    else:
        gdf = gpd.read_file(path)
    if gdf.crs is None or gdf.crs.is_geographic:
        gdf = gdf.to_crs(CRS_METRIC)
    return gdf

def simulate_attributes(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Cria N/P/K/Mg sintéticos caso não existam, com gradiente centro→bordas + ruído."""
    rng = np.random.default_rng(42)
    xs = gdf.geometry.x.values
    ys = gdf.geometry.y.values
    cx, cy = xs.mean(), ys.mean()
    r = np.sqrt((xs - cx)**2 + (ys - cy)**2)
    r_norm = (r - r.min()) / (r.max() - r.min() + 1e-12)

    def synth(base, amp, noise, low, high):
        vals = base + amp*(1 - r_norm) + rng.normal(0, noise, size=r_norm.shape[0])
        return np.clip(vals, low, high)

    if "N_pct" not in gdf:
        gdf["N_pct"] = synth(0.12, 0.10, 0.02, 0.03, 0.40)
    if "P_mgdm3" not in gdf:
        gdf["P_mgdm3"] = synth(8.0, 12.0, 2.0, 1.0, 60.0)
    if "K_mgdm3" not in gdf:
        gdf["K_mgdm3"] = synth(90.0, 70.0, 8.0, 10.0, 320.0)
    if "Mg_cmolcdm3" not in gdf:
        gdf["Mg_cmolcdm3"] = synth(0.9, 0.6, 0.08, 0.10, 4.00)
    return gdf

def idw_interpolation(xy_obs, vals, xx, yy, k=12, p=2.0):
    tree = cKDTree(xy_obs)
    pts_dst = np.column_stack([xx.ravel(), yy.ravel()])
    dists, idxs = tree.query(pts_dst, k=k, workers=-1)
    if k == 1:
        dists = dists[:, np.newaxis]
        idxs  = idxs[:,  np.newaxis]
    dists = np.where(dists == 0, 1e-12, dists)
    weights = 1.0 / (dists**p)
    weights /= weights.sum(axis=1, keepdims=True)
    interp = (weights * vals[idxs]).sum(axis=1)
    return interp.reshape(xx.shape)

def try_kriging(x, y, v, xx, yy, variogram_model="spherical"):
    if not USE_KRIGING:
        return None
    try:
        from pykrige.ok import OrdinaryKriging
        OK = OrdinaryKriging(
            x, y, v,
            variogram_model=variogram_model,
            verbose=False,
            enable_plotting=False
        )
        z, _ = OK.execute("grid", xx[0, :], yy[:, 0])
        return np.array(z)
    except Exception as e:
        print(f"[AVISO] Krigagem não executada: {e}")
        return None

def save_geotiff(path, arr, transform, crs, nodata=np.nan):
    profile = {
        "driver": "GTiff",
        "height": arr.shape[0],
        "width":  arr.shape[1],
        "count": 1,
        "dtype": rasterio.float32,
        "crs": crs,
        "transform": transform,
        "nodata": nodata,
        "compress": "lzw",
    }
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(arr.astype(np.float32), 1)

def save_png(path, arr, mask, title, vmin=None, vmax=None):
    plt.figure(figsize=(6, 6))
    data = np.ma.array(arr, mask=~mask)
    im = plt.imshow(data, cmap="RdYlGn", vmin=vmin, vmax=vmax)
    plt.title(title)
    plt.colorbar(im, fraction=0.046, pad=0.04)
    plt.axis("off")
    plt.tight_layout()
    plt.savefig(path, dpi=200)
    plt.close()
# ====================================


def main():
    # 1) Carregar pontos
    gdf = load_points(INFILE, IN_LAYER)

    # 2) Garantir atributos (simula se não houver)
    gdf = simulate_attributes(gdf)

    # 3) Polígono de máscara (hull convexo + margem de 10 m)
    hull = gdf.unary_union.convex_hull
    margin = PIX
    minx, miny, maxx, maxy = hull.bounds
    minx -= margin; miny -= margin; maxx += margin; maxy += margin

    # 4) Grade 10 m
    width  = int(np.ceil((maxx - minx) / PIX))
    height = int(np.ceil((maxy - miny) / PIX))
    transform = from_origin(minx, maxy, PIX, PIX)

    mask_prop = rasterize(
        [(hull, 1)],
        out_shape=(height, width),
        transform=transform,
        fill=0,
        all_touched=False,
        dtype="uint8"
    ).astype(bool)

    xs_grid = minx + PIX*(0.5 + np.arange(width))
    ys_grid = maxy - PIX*(0.5 + np.arange(height))
    XX, YY = np.meshgrid(xs_grid, ys_grid)

    # 5) Arrays de amostras
    x = gdf.geometry.x.values
    y = gdf.geometry.y.values
    xy = np.column_stack([x, y])

    # 6) Interpolar e salvar
    rows = []
    for col, (label, unit) in VARMAP.items():
        if col not in gdf.columns:
            print(f"[AVISO] '{col}' ausente, pulando.")
            continue

        v = gdf[col].astype(float).values

        # IDW
        idw_grid = idw_interpolation(xy, v, XX, YY, k=IDW_K, p=IDW_P)
        idw_grid[~mask_prop] = np.nan
        vmin = np.nanpercentile(idw_grid, 5)
        vmax = np.nanpercentile(idw_grid, 95)

        tiff_idw = OUTDIR / f"{col}_IDW_10m.tif"
        png_idw  = OUTDIR / f"{col}_IDW_10m.png"
        save_geotiff(tiff_idw, idw_grid, transform, gdf.crs)
        save_png(png_idw, idw_grid, mask_prop, f"{label} (IDW) [{unit}]", vmin=vmin, vmax=vmax)

        # Krigagem (opcional)
        krig_status = "indisponível"
        if USE_KRIGING:
            krig_grid = try_kriging(x, y, v, XX, YY, variogram_model=KRIG_VARIOMODEL)
            if krig_grid is not None:
                krig_grid[~mask_prop] = np.nan
                tiff_krig = OUTDIR / f"{col}_Krigagem_10m.tif"
                png_krig  = OUTDIR / f"{col}_Krigagem_10m.png"
                save_geotiff(tiff_krig, krig_grid, transform, gdf.crs)
                save_png(png_krig, krig_grid, mask_prop, f"{label} (Krigagem) [{unit}]", vmin=vmin, vmax=vmax)
                krig_status = "ok"

        rows.append({
            "variavel": col,
            "min_obs": float(np.min(v)),
            "p25_obs": float(np.percentile(v, 25)),
            "mediana_obs": float(np.median(v)),
            "p75_obs": float(np.percentile(v, 75)),
            "max_obs": float(np.max(v)),
            "krigagem": krig_status,
            "tiff_idw": str(tiff_idw),
            "png_idw": str(png_idw),
            "tiff_krig": str(OUTDIR / f"{col}_Krigagem_10m.tif") if krig_status == "ok" else "",
            "png_krig": str(OUTDIR / f"{col}_Krigagem_10m.png") if krig_status == "ok" else "",
        })

    # 7) Resumo
    summary = pd.DataFrame(rows)
    summary_path = OUTDIR / "resumo_interpolacao.csv"
    summary.to_csv(summary_path, index=False, encoding="utf-8")
    print("\n== Resumo ==")
    print(summary)
    print(f"\nArquivos salvos em: {OUTDIR.resolve()}")
    print(f"Tabela resumo: {summary_path.resolve()}")


if __name__ == "__main__":
    main()
