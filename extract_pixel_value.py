#!/usr/bin/env python3
"""
Script para extrair valor de pixel de um arquivo TIFF em coordenadas específicas
"""

import argparse
import json
import sys
import numpy as np
import rasterio
from rasterio.transform import rowcol

def extract_pixel_value(tiff_path, lat, lng):
    """
    Extrai o valor do pixel de um arquivo TIFF em coordenadas lat/lng específicas
    
    Args:
        tiff_path (str): Caminho para o arquivo TIFF
        lat (float): Latitude
        lng (float): Longitude
    
    Returns:
        dict: Resultado com valor e metadados
    """
    try:
        with rasterio.open(tiff_path) as src:
            # Converter coordenadas geográficas para índices do raster
            row, col = rowcol(src.transform, lng, lat)
            
            # Verificar se as coordenadas estão dentro dos limites
            if row < 0 or row >= src.height or col < 0 or col >= src.width:
                return {
                    "success": False,
                    "error": "Coordenadas fora dos limites do raster",
                    "bounds": {
                        "width": src.width,
                        "height": src.height,
                        "bounds": src.bounds._asdict()
                    },
                    "coordinates": {"row": int(row), "col": int(col)}
                }
            
            # Ler valor do pixel
            value = src.read(1)[row, col]
            
            # Verificar se é um valor válido
            if np.isnan(value) or value == src.nodata:
                return {
                    "success": False,
                    "error": "Valor no data ou NaN",
                    "raw_value": float(value) if not np.isnan(value) else None,
                    "nodata": src.nodata
                }
            
            # Sucesso
            return {
                "success": True,
                "value": float(value),
                "coordinates": {
                    "lat": lat,
                    "lng": lng,
                    "row": int(row),
                    "col": int(col)
                },
                "metadata": {
                    "crs": str(src.crs),
                    "transform": list(src.transform),
                    "width": src.width,
                    "height": src.height,
                    "bounds": src.bounds._asdict()
                }
            }
            
    except FileNotFoundError:
        return {
            "success": False,
            "error": f"Arquivo TIFF não encontrado: {tiff_path}"
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Erro na extração: {str(e)}"
        }

def main():
    parser = argparse.ArgumentParser(description='Extrair valor de pixel de TIFF')
    parser.add_argument('--tiff', required=True, help='Caminho para o arquivo TIFF')
    parser.add_argument('--lat', type=float, required=True, help='Latitude')
    parser.add_argument('--lng', type=float, required=True, help='Longitude')
    
    args = parser.parse_args()
    
    # Extrair valor
    result = extract_pixel_value(args.tiff, args.lat, args.lng)
    
    # Imprimir resultado como JSON
    print(json.dumps(result))
    
    # Exit code baseado no sucesso
    sys.exit(0 if result.get("success", False) else 1)

if __name__ == "__main__":
    main()
