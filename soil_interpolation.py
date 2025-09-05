#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script de Interpolação de Dados de Solo
ConnecFarm - Sistema de Análise de Solo

Este script processa arquivos GeoJSON contendo dados de solo
e gera interpolações usando métodos de Krigagem e IDW.
"""

import sys
import json
import numpy as np
import pandas as pd
import argparse
from pathlib import Path
from typing import Tuple, Optional
import logging

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

try:
    import geopandas as gpd
    import matplotlib.pyplot as plt
    import matplotlib.colors as mcolors
    from matplotlib.colors import LinearSegmentedColormap
    from scipy.interpolate import griddata
    from scipy.spatial.distance import cdist
    from scipy.spatial import cKDTree
    import rasterio
    from rasterio.transform import from_origin, from_bounds
    from rasterio.features import rasterize
    import fiona
    import shapely.geometry as sgeom
    from shapely.geometry import Point, Polygon
    # Tentar importar pykrige para Krigagem (melhor que sklearn)
    try:
        from pykrige.ok import OrdinaryKriging
        PYKRIGE_AVAILABLE = True
        logger.info("✅ PyKrige disponível - Krigagem otimizada ativada")
    except ImportError:
        PYKRIGE_AVAILABLE = False
        logger.warning("⚠️ PyKrige não disponível - usando fallback sklearn")
        from sklearn.gaussian_process import GaussianProcessRegressor
        from sklearn.gaussian_process.kernels import RBF, ConstantKernel
        from sklearn.preprocessing import StandardScaler
except ImportError as e:
    logger.error(f"Erro ao importar bibliotecas: {e}")
    logger.error("Instale as dependências: pip install geopandas matplotlib scipy scikit-learn rasterio fiona shapely")
    sys.exit(1)

# Importar analisador de variogramas
try:
    from variogram_analysis import VariogramAnalyzer
    VARIOMOGRAM_AVAILABLE = True
    logger.info("✅ VariogramAnalyzer disponível - análise automática ativada")
except ImportError:
    VARIOMOGRAM_AVAILABLE = False
    logger.warning("⚠️ VariogramAnalyzer não disponível. Usando parâmetros padrão.")


class SoilInterpolation:
    """
    Classe para interpolação de dados de solo usando Krigagem e IDW
    """
    
    def __init__(self, resolution: float = 10.0, search_radius: float = 100.0, auto_params: bool = False, use_mask: bool = True):
        self.resolution = resolution  # metros
        self.search_radius = search_radius  # metros
        self.auto_params = auto_params  # usar análise automática de variogramas
        self.use_mask = use_mask  # aplicar máscara da área ou interpolar tudo
        self.data = None
        self.bounds = None
        self.area_polygon = None
        
    def load_geojson(self, file_path: str) -> bool:
        """Carrega dados do GeoJSON"""
        try:
            self.data = gpd.read_file(file_path)
            
            # Verificar se há pontos
            if self.data.empty or not any(self.data.geometry.geom_type == 'Point'):
                logger.error("GeoJSON deve conter pontos (Point geometries)")
                return False
            
            # Calcular bounds dos pontos
            self.bounds = self.data.total_bounds  # [minx, miny, maxx, maxy]
            
            # Criar polígono da área usando convex hull simples (como código de referência)
            points_union = self.data.geometry.unary_union
            self.area_polygon = points_union.convex_hull
            
            logger.info(f"Área definida como convex hull dos pontos (método otimizado)")
            
            logger.info(f"Carregados {len(self.data)} pontos de solo")
            logger.info(f"Bounds: {self.bounds}")
            logger.info(f"Área: {self.area_polygon}")
            
            return True
            
        except Exception as e:
            logger.error(f"Erro ao carregar GeoJSON: {e}")
            return False
    
    def interpolate_parameter(self, parameter: str, method: str = 'kriging'):
        """
        Interpola um parâmetro específico
        
        Returns:
            X_grid, Y_grid, Z_interpolated
        """
        # Extrair valores do parâmetro
        if parameter not in self.data.columns:
            raise ValueError(f"Parâmetro '{parameter}' não encontrado nos dados")
        
        # Filtrar dados válidos
        valid_data = self.data[self.data[parameter].notna()].copy()
        if len(valid_data) < 3:
            raise ValueError(f"Dados insuficientes para '{parameter}' (mínimo 3 pontos)")
        
        # Extrair coordenadas e valores
        coords = np.column_stack([valid_data.geometry.x, valid_data.geometry.y])
        values = valid_data[parameter].values
        
        logger.info(f"Valores para interpolação {parameter}: min={values.min():.3f}, max={values.max():.3f}, média={values.mean():.3f}")
        logger.info(f"Coordenadas: {coords.shape} pontos")
        
        # Criar grid regular
        x_min, y_min, x_max, y_max = self.bounds
        
        # Expandir bounds ligeiramente
        buffer = max((x_max - x_min), (y_max - y_min)) * 0.1
        x_min -= buffer
        x_max += buffer
        y_min -= buffer
        y_max += buffer
        
        # Calcular número de células baseado na resolução
        x_cells = int((x_max - x_min) / (self.resolution / 111320))  # Conversão aproximada metros para graus
        y_cells = int((y_max - y_min) / (self.resolution / 111320))
        
        x_grid = np.linspace(x_min, x_max, x_cells)
        y_grid = np.linspace(y_min, y_max, y_cells)
        X_grid, Y_grid = np.meshgrid(x_grid, y_grid)
        
        # 🛡️ PROTEÇÃO INTELIGENTE PARA DATASETS GRANDES
        total_points = len(coords)
        
        # Interpolar usando métodos otimizados
        if method.lower() == 'kriging':
            Z_interpolated = self._kriging_interpolation_optimized(coords, values, X_grid, Y_grid)
        else:  # IDW
            Z_interpolated = self._idw_interpolation_optimized(coords, values, X_grid, Y_grid)
        
        logger.info(f"Interpolação concluída: valores entre {Z_interpolated.min():.3f} e {Z_interpolated.max():.3f}")
        
        return X_grid, Y_grid, Z_interpolated
    
    def _kriging_interpolation(self, coords: np.ndarray, values: np.ndarray,
                              X_grid: np.ndarray, Y_grid: np.ndarray, 
                              use_auto_params: bool = True) -> np.ndarray:
        """Interpolação usando Krigagem (Gaussian Process) com parâmetros automáticos"""
        try:
            logger.info(f"Iniciando Krigagem com {len(coords)} pontos")
            logger.info(f"Valores de entrada: min={values.min():.3f}, max={values.max():.3f}")
            
            # Verificar se temos dados suficientes
            if len(coords) < 3:
                logger.warning("Poucos pontos para Krigagem, usando IDW")
                return self._idw_interpolation(coords, values, X_grid, Y_grid, 2.0)
            
            # Análise automática de variogramas se disponível
            kernel_params = None
            if use_auto_params and VARIOMOGRAM_AVAILABLE:
                try:
                    logger.info("🔍 Executando análise automática de variogramas...")
                    analyzer = VariogramAnalyzer()
                    analysis_result = analyzer.analyze_spatial_dependency(coords, values)
                    
                    if analysis_result['success']:
                        kernel_params = analysis_result
                        logger.info(f"✅ Análise automática: Kernel {kernel_params['kernel']}, "
                                  f"Length Scale {kernel_params['length_scale']}, "
                                  f"Alpha {kernel_params['alpha']:.2e}")
                        logger.info(f"📊 Qualidade do variograma: {kernel_params['variogram_quality']:.3f}")
                        logger.info(f"🌱 Tipo de solo: {kernel_params['soil_type']}")
                        logger.info(f"💡 Recomendação: {kernel_params['recommendation']}")
                    else:
                        logger.warning(f"⚠️ Análise automática falhou: {analysis_result['error']}")
                        
                except Exception as e:
                    logger.warning(f"⚠️ Erro na análise automática: {e}")
                    kernel_params = None
            
            # Normalizar coordenadas para melhor estabilidade numérica
            scaler = StandardScaler()
            coords_scaled = scaler.fit_transform(coords)
            
            logger.info(f"Coordenadas normalizadas: {coords_scaled.shape}")
            
            # Criar kernel baseado na análise automática ou padrão
            if kernel_params and kernel_params['success']:
                # Usar parâmetros da análise automática
                if kernel_params['kernel'] == 'RBF':
                    kernel = ConstantKernel(kernel_params['constant_value'], (1e-2, 1e2)) * RBF(
                        kernel_params['length_scale'],
                        (np.array(kernel_params['length_scale']) * 0.5, 
                         np.array(kernel_params['length_scale']) * 2.0)
                    )
                elif kernel_params['kernel'] == 'Matern':
                    kernel = ConstantKernel(kernel_params['constant_value'], (1e-2, 1e2)) * Matern(
                        length_scale=kernel_params['length_scale'],
                        nu=1.5
                    )
                else:
                    # Fallback para RBF
                    kernel = ConstantKernel(1.0, (1e-2, 1e2)) * RBF(
                        kernel_params['length_scale'],
                        (np.array(kernel_params['length_scale']) * 0.5, 
                         np.array(kernel_params['length_scale']) * 2.0)
                    )
                
                alpha = kernel_params['alpha']
                logger.info(f"🔧 Kernel automático: {kernel_params['kernel']} com alpha={alpha:.2e}")
                
            else:
                # Kernel padrão (método anterior)
                logger.info("🔧 Usando kernel padrão (método anterior)")
                length_scale = np.std(coords_scaled, axis=0)
                lower_bounds = np.maximum(length_scale * 0.1, 1e-3)
                upper_bounds = np.maximum(length_scale * 10, 1e-2)
                
                kernel = ConstantKernel(1.0, (1e-2, 1e2)) * RBF(
                    length_scale, 
                    (lower_bounds, upper_bounds)
                )
                alpha = 1e-8
            
            # Modelo com parâmetros otimizados para dados de solo
            gpr = GaussianProcessRegressor(
                kernel=kernel, 
                random_state=42,
                alpha=alpha,  # Regularização baseada na análise automática
                normalize_y=False,  # Não normalizar para manter escala original
                n_restarts_optimizer=10  # Mais tentativas de otimização
            )
            
            # Treinar modelo
            gpr.fit(coords_scaled, values)
            
            logger.info(f"Modelo treinado com kernel: {gpr.kernel_}")
            
            # Preparar grid para predição
            grid_points = np.column_stack([X_grid.ravel(), Y_grid.ravel()])
            grid_points_scaled = scaler.transform(grid_points)
            
            # 🚀 OTIMIZAÇÃO DE MEMÓRIA: Processamento em lotes para datasets grandes
            search_radius_deg = self.search_radius / 111320  # Conversão metros para graus
            predicted = np.full(grid_points.shape[0], np.mean(values))  # Valor padrão
            
            # Determinar tamanho do lote baseado no número de pontos
            total_points = len(coords)
            if total_points > 500:
                # Para datasets grandes: usar lotes pequenos
                batch_size = min(5000, grid_points.shape[0] // 10)
                logger.info(f"🔥 Dataset grande ({total_points} pontos): usando lotes de {batch_size}")
            elif total_points > 100:
                # Para datasets médios: usar lotes maiores
                batch_size = min(10000, grid_points.shape[0] // 5)
                logger.info(f"📊 Dataset médio ({total_points} pontos): usando lotes de {batch_size}")
            else:
                # Para datasets pequenos: processar tudo
                batch_size = grid_points.shape[0]
                logger.info(f"📍 Dataset pequeno ({total_points} pontos): processamento completo")
            
            # Configurar limites de valores
            value_range = values.max() - values.min()
            tolerance = value_range * 0.2
            min_limit = values.min() - tolerance
            max_limit = values.max() + tolerance
            
            # Processar em lotes para evitar problemas de memória
            total_valid = 0
            total_batches = (grid_points.shape[0] + batch_size - 1) // batch_size
            
            for i in range(0, grid_points.shape[0], batch_size):
                end_idx = min(i + batch_size, grid_points.shape[0])
                batch_grid_points = grid_points[i:end_idx]
                batch_grid_scaled = grid_points_scaled[i:end_idx]
                
                # Calcular distâncias apenas para este lote
                distances_batch = cdist(batch_grid_points, coords)
                min_distances_batch = np.min(distances_batch, axis=1)
                valid_batch = min_distances_batch <= search_radius_deg
                
                if np.any(valid_batch):
                    # Predizer apenas pontos válidos
                    predicted_batch, _ = gpr.predict(batch_grid_scaled[valid_batch], return_std=True)
                    predicted_batch = np.clip(predicted_batch, min_limit, max_limit)
                    
                    # Aplicar ao array principal
                    batch_indices = np.arange(i, end_idx)
                    predicted[batch_indices[valid_batch]] = predicted_batch
                    total_valid += np.sum(valid_batch)
                
                # Log progresso a cada 20% dos lotes
                batch_num = (i // batch_size) + 1
                if batch_num % max(1, total_batches // 5) == 0:
                    progress = (batch_num / total_batches) * 100
                    logger.info(f"⚡ Progresso Krigagem: {progress:.0f}% ({batch_num}/{total_batches} lotes)")
            
            logger.info(f"✅ Krigagem concluída: {total_valid} pontos válidos de {grid_points.shape[0]} total")
            logger.info(f"Valores limitados: min={min_limit:.3f}, max={max_limit:.3f}")
            logger.info(f"Predição Krigagem: min={predicted.min():.3f}, max={predicted.max():.3f}")
            
            # Reshape para grid
            interpolated = predicted.reshape(X_grid.shape)
            
            # Verificar se a interpolação gerou valores válidos
            if np.all(np.isnan(interpolated)) or np.all(interpolated == 0):
                logger.warning("Krigagem gerou valores inválidos, usando IDW")
                return self._idw_interpolation(coords, values, X_grid, Y_grid, 2.0)
            
            # Suavizar apenas se a resolução for muito alta (evitar artefatos em baixa resolução)
            if self.resolution <= 50:  # Aplicar suavização apenas para resoluções finas
                from scipy.ndimage import gaussian_filter
                interpolated = gaussian_filter(interpolated, sigma=0.5)
                logger.info(f"Interpolação suavizada com gaussian_filter (resolução {self.resolution}m)")
            else:
                logger.info(f"Suavização desabilitada para resolução grosseira ({self.resolution}m)")
            
            return interpolated
            
        except Exception as e:
            logger.error(f"Erro na Krigagem: {e}")
            logger.info("Usando IDW como fallback")
            # Fallback para IDW
            return self._idw_interpolation(coords, values, X_grid, Y_grid, 2.0)
    
    def _idw_interpolation(self, coords: np.ndarray, values: np.ndarray,
                          X_grid: np.ndarray, Y_grid: np.ndarray, power: float = 2.0) -> np.ndarray:
        """Interpolação usando IDW (Inverse Distance Weighting) com otimização de memória"""
        # Preparar grid
        grid_points = np.column_stack([X_grid.ravel(), Y_grid.ravel()])
        search_radius_deg = self.search_radius / 111320  # Conversão metros para graus
        interpolated = np.full(grid_points.shape[0], np.mean(values))  # Valor padrão
        
        # 🚀 OTIMIZAÇÃO DE MEMÓRIA: Processamento em lotes para IDW
        total_points = len(coords)
        if total_points > 500:
            batch_size = min(8000, grid_points.shape[0] // 8)
            logger.info(f"🔥 IDW Dataset grande ({total_points} pontos): lotes de {batch_size}")
        elif total_points > 100:
            batch_size = min(15000, grid_points.shape[0] // 4)
            logger.info(f"📊 IDW Dataset médio ({total_points} pontos): lotes de {batch_size}")
        else:
            batch_size = grid_points.shape[0]
            logger.info(f"📍 IDW Dataset pequeno ({total_points} pontos): processamento completo")
        
        total_valid = 0
        total_batches = (grid_points.shape[0] + batch_size - 1) // batch_size
        
        for i in range(0, grid_points.shape[0], batch_size):
            end_idx = min(i + batch_size, grid_points.shape[0])
            batch_grid_points = grid_points[i:end_idx]
            
            # Calcular distâncias apenas para este lote
            distances_batch = cdist(batch_grid_points, coords)
            
            # Evitar divisão por zero
            distances_batch = np.where(distances_batch == 0, 1e-10, distances_batch)
            
            # Aplicar máscara do raio de busca
            mask_batch = distances_batch <= search_radius_deg
            
            # Calcular pesos apenas para pontos dentro do raio
            weights_batch = np.where(mask_batch, 1.0 / (distances_batch ** power), 0)
            
            # Interpolar apenas onde há pontos dentro do raio
            weight_sums_batch = np.sum(weights_batch, axis=1)
            valid_batch = weight_sums_batch > 0
            
            if np.any(valid_batch):
                interpolated_batch = (
                    np.sum(weights_batch[valid_batch] * values, axis=1) / weight_sums_batch[valid_batch]
                )
                
                # Aplicar ao array principal
                batch_indices = np.arange(i, end_idx)
                interpolated[batch_indices[valid_batch]] = interpolated_batch
                total_valid += np.sum(valid_batch)
            
            # Log progresso
            batch_num = (i // batch_size) + 1
            if batch_num % max(1, total_batches // 5) == 0:
                progress = (batch_num / total_batches) * 100
                logger.info(f"⚡ Progresso IDW: {progress:.0f}% ({batch_num}/{total_batches} lotes)")
        
        logger.info(f"✅ IDW concluído: {total_valid} pontos interpolados, {grid_points.shape[0] - total_valid} com valor médio")
        
        return interpolated.reshape(X_grid.shape)
    
    def _idw_interpolation_optimized(self, coords: np.ndarray, values: np.ndarray, 
                                   X_grid: np.ndarray, Y_grid: np.ndarray, k: int = 12, p: float = 2.0) -> np.ndarray:
        """IDW otimizado usando cKDTree (baseado no código de referência)"""
        try:
            logger.info(f"Iniciando IDW otimizado com {len(coords)} pontos")
            
            # Usar cKDTree para busca eficiente de vizinhos
            tree = cKDTree(coords)
            pts_dst = np.column_stack([X_grid.ravel(), Y_grid.ravel()])
            
            # Buscar k vizinhos mais próximos
            dists, idxs = tree.query(pts_dst, k=min(k, len(coords)), workers=-1)
            
            # Garantir formato correto para k=1
            if k == 1 or len(coords) == 1:
                dists = dists[:, np.newaxis]
                idxs = idxs[:, np.newaxis]
            
            # Evitar divisão por zero
            dists = np.where(dists == 0, 1e-12, dists)
            
            # Calcular pesos IDW
            weights = 1.0 / (dists ** p)
            weights /= weights.sum(axis=1, keepdims=True)
            
            # Interpolar
            interp = (weights * values[idxs]).sum(axis=1)
            
            logger.info(f"IDW concluído: min={interp.min():.3f}, max={interp.max():.3f}")
            
            return interp.reshape(X_grid.shape)
            
        except Exception as e:
            logger.error(f"Erro no IDW otimizado: {e}")
            # Fallback para método original
            return self._idw_interpolation(coords, values, X_grid, Y_grid, p)
    
    def _kriging_interpolation_optimized(self, coords: np.ndarray, values: np.ndarray, 
                                       X_grid: np.ndarray, Y_grid: np.ndarray) -> np.ndarray:
        """Krigagem otimizada usando PyKrige (baseado no código de referência)"""
        try:
            logger.info(f"Iniciando Krigagem otimizada com {len(coords)} pontos")
            
            # Tentar usar PyKrige primeiro (mais eficiente)
            if PYKRIGE_AVAILABLE:
                logger.info("🚀 Usando PyKrige para Krigagem otimizada")
                
                x = coords[:, 0]
                y = coords[:, 1]
                
                from pykrige.ok import OrdinaryKriging
                OK = OrdinaryKriging(
                    x, y, values,
                    variogram_model="spherical",  # Como no código de referência
                    verbose=False,
                    enable_plotting=False
                )
                
                # Executar krigagem no grid
                z, _ = OK.execute("grid", X_grid[0, :], Y_grid[:, 0])
                
                logger.info(f"PyKrige Krigagem concluída: min={z.min():.3f}, max={z.max():.3f}")
                
                return np.array(z)
            
            else:
                # Fallback para sklearn (método original mais simples)
                logger.info("📦 Usando sklearn como fallback")
                return self._kriging_interpolation(coords, values, X_grid, Y_grid, False)
                
        except Exception as e:
            logger.warning(f"Erro na Krigagem otimizada: {e}")
            logger.info("🔄 Tentando fallback para IDW")
            # Fallback para IDW se a krigagem falhar
            return self._idw_interpolation_optimized(coords, values, X_grid, Y_grid)
    
    def mask_by_area_optimized(self, X_grid: np.ndarray, Y_grid: np.ndarray, Z_grid: np.ndarray) -> np.ndarray:
        """Máscara otimizada usando rasterize (baseada no código de referência)"""
        try:
            from rasterio.transform import from_origin
            
            # Calcular transform
            minx, miny, maxx, maxy = X_grid.min(), Y_grid.min(), X_grid.max(), Y_grid.max()
            height, width = Z_grid.shape
            transform = from_origin(minx, maxy, (maxx - minx) / width, (maxy - miny) / height)
            
            # Criar máscara usando rasterize
            mask_prop = rasterize(
                [(self.area_polygon, 1)],
                out_shape=(height, width),
                transform=transform,
                fill=0,
                all_touched=False,
                dtype="uint8"
            ).astype(bool)
            
            # Aplicar máscara
            Z_masked = Z_grid.copy()
            Z_masked[~mask_prop] = np.nan
            
            # Debug: verificar valores após máscara
            valid_values = Z_masked[~np.isnan(Z_masked)]
            logger.info(f"Máscara otimizada aplicada: {np.sum(mask_prop)} pixels válidos de {mask_prop.size} total")
            
            if len(valid_values) > 0:
                logger.info(f"Valores após máscara: min={valid_values.min():.3f}, max={valid_values.max():.3f}")
            else:
                logger.warning("PROBLEMA: Todos os valores foram mascarados!")
            
            return Z_masked
            
        except Exception as e:
            logger.warning(f"Erro na máscara otimizada: {e}. Usando método original.")
            return self.mask_by_area(X_grid, Y_grid, Z_grid)
    
    def mask_by_area(self, X_grid: np.ndarray, Y_grid: np.ndarray, Z_grid: np.ndarray) -> np.ndarray:
        """Mascara o grid pela área de interesse usando convex hull dos pontos"""
        try:
            # Criar array de pontos do grid
            points_grid = np.column_stack([X_grid.ravel(), Y_grid.ravel()])
            
            # Verificar quais pontos estão dentro do polígono da área
            from shapely.vectorized import contains
            mask_1d = contains(self.area_polygon, points_grid[:, 0], points_grid[:, 1])
            
            # Reshape para o formato do grid
            mask = mask_1d.reshape(Z_grid.shape)
            
            # Aplicar máscara
            Z_masked = np.where(mask, Z_grid, np.nan)
            
            # Debug: verificar valores após máscara
            valid_values = Z_masked[~np.isnan(Z_masked)]
            logger.info(f"Aplicada máscara da área: {np.sum(mask)} pixels válidos de {mask.size} total")
            
            if len(valid_values) > 0:
                logger.info(f"Valores após máscara: min={valid_values.min():.3f}, max={valid_values.max():.3f}")
            else:
                logger.warning("PROBLEMA: Todos os valores foram mascarados!")
            
            return Z_masked
            
        except Exception as e:
            logger.warning(f"Erro ao aplicar máscara: {e}. Usando dados sem máscara.")
            return Z_grid
    
    def save_as_tiff(self, X_grid: np.ndarray, Y_grid: np.ndarray, Z_grid: np.ndarray,
                     output_path: str, parameter: str) -> bool:
        """Salva interpolação como GeoTIFF"""
        try:
            # Aplicar máscara da área (opcional) - versão otimizada
            if self.use_mask:
                Z_masked = self.mask_by_area_optimized(X_grid, Y_grid, Z_grid)
                logger.info("✅ Máscara aplicada - interpolação restrita à área dos pontos")
            else:
                Z_masked = Z_grid
                logger.info("🌍 Máscara desabilitada - interpolação em toda a área")
            
            # Configurar transformação
            x_min, x_max = X_grid.min(), X_grid.max()
            y_min, y_max = Y_grid.min(), Y_grid.max()
            
            transform = from_bounds(x_min, y_min, x_max, y_max, Z_masked.shape[1], Z_masked.shape[0])
            
            # Salvar GeoTIFF
            with rasterio.open(
                output_path,
                'w',
                driver='GTiff',
                height=Z_masked.shape[0],
                width=Z_masked.shape[1],
                count=1,
                dtype=Z_masked.dtype,
                crs='+proj=longlat +datum=WGS84 +no_defs',
                transform=transform,
                nodata=np.nan
            ) as dst:
                dst.write(Z_masked, 1)
            
            logger.info(f"GeoTIFF salvo: {output_path}")
            return True
            
        except Exception as e:
            logger.error(f"Erro ao salvar GeoTIFF: {e}")
            return False
    
    def save_as_png(self, X_grid: np.ndarray, Y_grid: np.ndarray, Z_grid: np.ndarray,
                    output_path: str, parameter: str, method: str) -> bool:
        """Salva visualização como PNG"""
        try:
            # Aplicar máscara da área (opcional) - versão otimizada
            if self.use_mask:
                Z_masked = self.mask_by_area_optimized(X_grid, Y_grid, Z_grid)
                logger.info("✅ Máscara aplicada - interpolação restrita à área dos pontos")
            else:
                Z_masked = Z_grid
                logger.info("🌍 Máscara desabilitada - interpolação em toda a área")
            
            # Criar figura sem moldura
            fig, ax = plt.subplots(figsize=(12, 10))
            
            # Verificar valores válidos para ajustar colormap
            valid_values = Z_masked[~np.isnan(Z_masked)]
            if len(valid_values) > 0:
                vmin, vmax = valid_values.min(), valid_values.max()
                logger.info(f"Range de cores: {vmin:.3f} a {vmax:.3f}")
            else:
                vmin, vmax = 0, 1
            
            # Escolher paleta de cores baseada no método (como nos exemplos)
            if method.lower() == 'kriging':
                cmap = 'RdYlGn'  # Red→Yellow→Green para Kriging
                logger.info(f"Usando paleta RdYlGn para Kriging")
            else:
                cmap = 'viridis'  # Viridis para IDW
                logger.info(f"Usando paleta viridis para {method}")
            
            # Plotar interpolação contínua como nos exemplos
            im = ax.contourf(X_grid, Y_grid, Z_masked, levels=100, cmap=cmap, 
                           extend='both', vmin=vmin, vmax=vmax)
            
            # Não plotar pontos de amostra para ficar limpo como nos exemplos
            
            # Configurar eixos
            ax.set_xlabel('Longitude')
            ax.set_ylabel('Latitude')
            ax.set_title(f'{parameter} ({method.upper()})')
            
            # Remover grid para ficar limpo como nos exemplos
            ax.grid(False)
            
            # Barra de cores com título apropriado
            cbar = plt.colorbar(im, ax=ax, shrink=0.8)
            cbar.set_label(f'{parameter}')
            
            # Ajustar layout
            plt.tight_layout()
            
            # Salvar
            plt.savefig(output_path, dpi=300, bbox_inches='tight')
            plt.close()
            
            logger.info(f"PNG salvo: {output_path}")
            return True
            
        except Exception as e:
            logger.error(f"Erro ao salvar PNG: {e}")
            return False


def main():
    """Função principal"""
    parser = argparse.ArgumentParser(description='Interpolação de dados de solo')
    parser.add_argument('--input', required=True, help='Arquivo GeoJSON de entrada')
    parser.add_argument('--parameter', required=True, help='Parâmetro para interpolar')
    parser.add_argument('--method', required=True, choices=['kriging', 'idw'], help='Método de interpolação')
    parser.add_argument('--resolution', type=float, default=10.0, help='Resolução em metros')
    parser.add_argument('--search-radius', type=float, default=100.0, help='Raio de busca em metros')
    parser.add_argument('--output-dir', required=True, help='Diretório de saída')
    parser.add_argument('--auto-params', action='store_true', help='Usar análise automática de parâmetros')
    parser.add_argument('--no-mask', action='store_true', help='Desabilitar máscara da área - interpolar toda região')
    
    args = parser.parse_args()
    
    # Criar interpolador
    interpolator = SoilInterpolation(
        resolution=args.resolution, 
        search_radius=args.search_radius,
        auto_params=args.auto_params,
        use_mask=not args.no_mask  # Usar máscara por padrão, desabilitar se --no-mask
    )
    
    # Carregar dados
    if not interpolator.load_geojson(args.input):
        sys.exit(1)
    
    try:
        # Interpolar
        logger.info(f"Interpolando {args.parameter} usando {args.method}")
        if args.method == 'kriging' and args.auto_params:
            logger.info("🔍 Modo automático ativado - usando análise de variogramas")
        X_grid, Y_grid, Z_grid = interpolator.interpolate_parameter(args.parameter, args.method)
        
        # Caminhos de saída
        output_dir = Path(args.output_dir)
        output_dir.mkdir(exist_ok=True)
        
        tiff_path = output_dir / f"{args.parameter}_{args.method}_interpolation.tif"
        png_path = output_dir / f"{args.parameter}_{args.method}_interpolation.png"
        
        # Salvar arquivos
        success_tiff = interpolator.save_as_tiff(X_grid, Y_grid, Z_grid, str(tiff_path), args.parameter)
        success_png = interpolator.save_as_png(X_grid, Y_grid, Z_grid, str(png_path), args.parameter, args.method)
        
        if success_tiff and success_png:
            logger.info("Interpolação concluída com sucesso!")
        else:
            logger.error("Erro ao salvar alguns arquivos")
            sys.exit(1)
            
    except Exception as e:
        logger.error(f"Erro durante interpolação: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()