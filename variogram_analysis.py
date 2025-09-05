#!/usr/bin/env python3
"""
Análise Automática de Variogramas para Otimização de Parâmetros de Kriging
Autor: ConnecFarm
Data: 2024
"""

import numpy as np
import pandas as pd
from scipy.spatial.distance import pdist, squareform
from scipy.optimize import minimize
from sklearn.gaussian_process.kernels import RBF, Matern, ConstantKernel
import logging
from typing import Dict, Tuple, List, Optional
import json

# Configurar logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class VariogramAnalyzer:
    """Analisador automático de variogramas para otimização de Kriging"""
    
    def __init__(self):
        self.variogram_models = {
            'spherical': self._spherical_model,
            'exponential': self._exponential_model,
            'gaussian': self._gaussian_model,
            'linear': self._linear_model
        }
        
        # Parâmetros padrão por região/tipo de solo
        self.default_params = {
            'cerrado_brasil': {
                'kernel': 'RBF',
                'length_scale': [0.05, 0.1],
                'alpha': 1e-6,
                'nugget': 0.1,
                'sill': 1.0,
                'range': 0.5
            },
            'amazonia': {
                'kernel': 'Matern',
                'length_scale': [0.1, 0.2],
                'alpha': 1e-8,
                'nugget': 0.05,
                'sill': 1.0,
                'range': 0.8
            }
        }
    
    def analyze_spatial_dependency(self, coords: np.ndarray, values: np.ndarray) -> Dict:
        """
        Análise completa de dependência espacial
        
        Args:
            coords: Coordenadas dos pontos (n, 2)
            values: Valores dos pontos (n,)
            
        Returns:
            Dict com parâmetros otimizados
        """
        logger.info(f"🔍 Analisando dependência espacial para {len(coords)} pontos")
        
        try:
            # 1. Calcular variograma experimental
            experimental_variogram = self._calculate_experimental_variogram(coords, values)
            
            # 2. Ajustar modelo teórico
            best_model, model_params = self._fit_variogram_model(experimental_variogram)
            
            # 3. Otimizar parâmetros do kernel
            kernel_params = self._optimize_kernel_parameters(coords, values, model_params)
            
            # 4. Determinar região/tipo de solo
            soil_type = self._classify_soil_region(coords, values)
            
            # 5. Combinar parâmetros automáticos com padrões regionais
            final_params = self._combine_parameters(kernel_params, soil_type)
            
            logger.info(f"✅ Análise concluída. Modelo: {best_model}, Kernel: {final_params['kernel']}")
            
            return {
                'success': True,
                'model': best_model,
                'kernel': final_params['kernel'],
                'length_scale': final_params['length_scale'],
                'alpha': final_params['alpha'],
                'nugget': final_params['nugget'],
                'sill': final_params['sill'],
                'range': final_params['range'],
                'variogram_quality': model_params['quality'],
                'soil_type': soil_type,
                'recommendation': self._generate_recommendation(final_params)
            }
            
        except Exception as e:
            logger.error(f"❌ Erro na análise: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'fallback_params': self._get_fallback_params()
            }
    
    def _calculate_experimental_variogram(self, coords: np.ndarray, values: np.ndarray) -> Dict:
        """Calcular variograma experimental"""
        logger.info("📊 Calculando variograma experimental...")
        
        # Calcular distâncias entre todos os pontos
        distances = pdist(coords)
        distance_matrix = squareform(distances)
        
        # Agrupar por faixas de distância
        max_distance = np.max(distances)
        n_lags = min(20, len(coords) // 2)  # Número de lags
        lag_size = max_distance / n_lags
        
        lags = []
        semivariances = []
        counts = []
        
        for i in range(n_lags):
            lag_start = i * lag_size
            lag_end = (i + 1) * lag_size
            
            # Encontrar pares de pontos nesta faixa
            mask = (distance_matrix > lag_start) & (distance_matrix <= lag_end)
            
            if np.sum(mask) > 0:
                # Calcular semivariância para esta faixa
                pairs = np.where(mask)
                pair_values = []
                
                for j, k in zip(pairs[0], pairs[1]):
                    if j < k:  # Evitar duplicatas
                        pair_values.append((values[j] - values[k]) ** 2)
                
                if pair_values:
                    lags.append((lag_start + lag_end) / 2)
                    semivariances.append(np.mean(pair_values) / 2)
                    counts.append(len(pair_values))
        
        return {
            'lags': np.array(lags),
            'semivariances': np.array(semivariances),
            'counts': np.array(counts),
            'max_distance': max_distance
        }
    
    def _fit_variogram_model(self, experimental: Dict) -> Tuple[str, Dict]:
        """Ajustar modelo teórico ao variograma experimental"""
        logger.info("🔧 Ajustando modelo teórico...")
        
        best_model = None
        best_params = None
        best_quality = float('inf')
        
        for model_name, model_func in self.variogram_models.items():
            try:
                # Ajustar modelo
                params = model_func(experimental['lags'], experimental['semivariances'])
                
                # Calcular qualidade do ajuste (R²)
                predicted = model_func(experimental['lags'], experimental['semivariances'], params)
                ss_res = np.sum((experimental['semivariances'] - predicted) ** 2)
                ss_tot = np.sum((experimental['semivariances'] - np.mean(experimental['semivariances'])) ** 2)
                
                if ss_tot > 0:
                    r_squared = 1 - (ss_res / ss_tot)
                    quality = 1 - r_squared  # Menor é melhor
                    
                    if quality < best_quality:
                        best_quality = quality
                        best_model = model_name
                        best_params = {
                            'params': params,
                            'quality': r_squared,
                            'predicted': predicted
                        }
                        
            except Exception as e:
                logger.warning(f"⚠️ Erro ao ajustar modelo {model_name}: {str(e)}")
                continue
        
        if best_model is None:
            logger.warning("⚠️ Nenhum modelo ajustou bem. Usando modelo padrão.")
            best_model = 'spherical'
            best_params = {
                'params': [1.0, 0.5],  # [sill, range]
                'quality': 0.5,
                'predicted': experimental['semivariances']
            }
        
        logger.info(f"✅ Melhor modelo: {best_model} (R² = {best_params['quality']:.3f})")
        return best_model, best_params
    
    def _spherical_model(self, lags: np.ndarray, semivariances: np.ndarray, params: Optional[List] = None) -> np.ndarray:
        """Modelo esférico de variograma"""
        if params is None:
            # Ajustar parâmetros
            sill = np.max(semivariances)
            range_param = np.max(lags) * 0.6
            params = [sill, range_param]
        
        sill, range_param = params
        h = lags
        
        # Modelo esférico
        result = np.where(h <= range_param,
                         sill * (1.5 * h / range_param - 0.5 * (h / range_param) ** 3),
                         sill)
        
        return result
    
    def _exponential_model(self, lags: np.ndarray, semivariances: np.ndarray, params: Optional[List] = None) -> np.ndarray:
        """Modelo exponencial de variograma"""
        if params is None:
            sill = np.max(semivariances)
            range_param = np.max(lags) * 0.3
            params = [sill, range_param]
        
        sill, range_param = params
        h = lags
        
        result = sill * (1 - np.exp(-3 * h / range_param))
        return result
    
    def _gaussian_model(self, lags: np.ndarray, semivariances: np.ndarray, params: Optional[List] = None) -> np.ndarray:
        """Modelo gaussiano de variograma"""
        if params is None:
            sill = np.max(semivariances)
            range_param = np.max(lags) * 0.5
            params = [sill, range_param]
        
        sill, range_param = params
        h = lags
        
        result = sill * (1 - np.exp(-3 * (h / range_param) ** 2))
        return result
    
    def _linear_model(self, lags: np.ndarray, semivariances: np.ndarray, params: Optional[List] = None) -> np.ndarray:
        """Modelo linear de variograma"""
        if params is None:
            sill = np.max(semivariances)
            range_param = np.max(lags)
            params = [sill, range_param]
        
        sill, range_param = params
        h = lags
        
        result = np.minimum(sill * h / range_param, sill)
        return result
    
    def _optimize_kernel_parameters(self, coords: np.ndarray, values: np.ndarray, model_params: Dict) -> Dict:
        """Otimizar parâmetros do kernel baseado no variograma"""
        logger.info("⚙️ Otimizando parâmetros do kernel...")
        
        # Extrair parâmetros do variograma
        sill = model_params['params'][0] if len(model_params['params']) > 0 else 1.0
        range_param = model_params['params'][1] if len(model_params['params']) > 1 else 0.5
        
        # Normalizar coordenadas
        coords_scaled = (coords - np.mean(coords, axis=0)) / np.std(coords, axis=0)
        
        # Calcular length_scale baseado no range do variograma
        length_scale = range_param * np.std(coords_scaled, axis=0)
        length_scale = np.maximum(length_scale, 0.01)  # Mínimo de 0.01
        
        # Determinar kernel baseado na qualidade do ajuste
        if model_params['quality'] > 0.8:
            kernel_type = 'RBF'  # Muito bom ajuste
        elif model_params['quality'] > 0.6:
            kernel_type = 'Matern'  # Bom ajuste
        else:
            kernel_type = 'RBF'  # Ajuste ruim, usar RBF robusto
        
        # Calcular alpha baseado na variabilidade dos dados
        data_variance = np.var(values)
        alpha = max(1e-8, data_variance * 0.01)  # Regularização proporcional
        
        return {
            'kernel': kernel_type,
            'length_scale': length_scale.tolist(),
            'alpha': alpha,
            'constant_value': np.sqrt(sill)
        }
    
    def _classify_soil_region(self, coords: np.ndarray, values: np.ndarray) -> str:
        """Classificar região/tipo de solo baseado nas coordenadas e valores"""
        # Coordenadas aproximadas do Brasil
        lat_center = np.mean(coords[:, 1])
        lon_center = np.mean(coords[:, 0])
        
        # Classificação baseada na localização
        if -25 < lat_center < -10 and -60 < lon_center < -40:
            return 'cerrado_brasil'
        elif -10 < lat_center < 5 and -80 < lon_center < -50:
            return 'amazonia'
        else:
            return 'general'
    
    def _combine_parameters(self, kernel_params: Dict, soil_type: str) -> Dict:
        """Combinar parâmetros automáticos com padrões regionais"""
        # Parâmetros base do kernel
        final_params = {
            'kernel': kernel_params['kernel'],
            'length_scale': kernel_params['length_scale'],
            'alpha': kernel_params['alpha'],
            'nugget': 0.0,
            'sill': 1.0,
            'range': 1.0
        }
        
        # Ajustar baseado no tipo de solo se disponível
        if soil_type in self.default_params:
            default = self.default_params[soil_type]
            
            # Mesclar parâmetros (automático tem prioridade)
            final_params['nugget'] = default.get('nugget', 0.0)
            final_params['sill'] = default.get('sill', 1.0)
            final_params['range'] = default.get('range', 1.0)
            
            # Ajustar length_scale se muito extremo
            if kernel_params['kernel'] == 'RBF':
                ls = np.array(kernel_params['length_scale'])
                ls = np.clip(ls, 0.01, 1.0)  # Limitar entre 0.01 e 1.0
                final_params['length_scale'] = ls.tolist()
        
        return final_params
    
    def _generate_recommendation(self, params: Dict) -> str:
        """Gerar recomendação baseada nos parâmetros"""
        kernel = params['kernel']
        alpha = params['alpha']
        
        if kernel == 'RBF':
            if alpha < 1e-6:
                return "Kernel RBF com regularização baixa - adequado para dados suaves"
            else:
                return "Kernel RBF com regularização moderada - equilibra suavidade e precisão"
        elif kernel == 'Matern':
            return "Kernel Matern - adequado para dados com variações moderadas"
        else:
            return f"Kernel {kernel} - configuração personalizada"
    
    def _get_fallback_params(self) -> Dict:
        """Parâmetros de fallback em caso de erro"""
        return {
            'kernel': 'RBF',
            'length_scale': [0.1, 0.1],
            'alpha': 1e-6,
            'nugget': 0.0,
            'sill': 1.0,
            'range': 1.0
        }

def main():
    """Função principal para teste"""
    # Dados de exemplo
    np.random.seed(42)
    n_points = 100
    
    # Coordenadas simuladas (Brasil)
    lats = np.random.uniform(-15, -12, n_points)
    lons = np.random.uniform(-46, -45, n_points)
    coords = np.column_stack([lons, lats])
    
    # Valores simulados com dependência espacial
    values = np.random.normal(50, 20, n_points)
    
    # Adicionar dependência espacial
    for i in range(n_points):
        for j in range(i):
            dist = np.sqrt((coords[i, 0] - coords[j, 0])**2 + (coords[i, 1] - coords[j, 1])**2)
            if dist < 0.1:  # Pontos próximos são similares
                values[i] = values[i] * 0.8 + values[j] * 0.2 + np.random.normal(0, 5)
    
    # Analisar
    analyzer = VariogramAnalyzer()
    result = analyzer.analyze_spatial_dependency(coords, values)
    
    print("🔍 Resultado da Análise:")
    print(json.dumps(result, indent=2, default=str))

if __name__ == "__main__":
    main()
