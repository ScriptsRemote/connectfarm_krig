# 🌱 ConnectFarm - Sistema de Interpolação e Análise de Solo

Sistema web completo para análise de solo, interpolação espacial (Kriging e IDW) e geração de malhas de amostragem para agricultura de precisão.

## 📋 Funcionalidades

### 🧪 Análise de Solo e Interpolação
- **Interpolação Kriging e IDW** para parâmetros de solo
- **Visualização em tempo real** dos resultados no mapa
- **Inspeção de pixels** com valores ao clicar no mapa
- **Download de arquivos** TIFF e PNG gerados
- **Classificação automática** dos valores (BAIXO, MÉDIO, ALTO)

### 🗺️ Geração de Malhas de Amostragem
- **Upload de arquivos** GeoJSON, Shapefile (ZIP), KML/KMZ
- **Geração automática** de malhas regulares
- **Visualização interativa** no mapa Leaflet
- **Exportação** dos pontos de amostragem

## 🛠️ Tecnologias Utilizadas

### Backend
- **Node.js** + Express
- **Python** para processamento geoespacial
- **PyKrige** para interpolação Kriging otimizada
- **Rasterio** para manipulação de dados raster
- **GeoPandas** para dados vetoriais

### Frontend
- **Leaflet.js** para mapas interativos
- **Bootstrap 5** para interface responsiva
- **GeoRasterLayer** para visualização de TIFF
- **Axios** para comunicação com API

### Bibliotecas Python
```
geopandas>=0.14.0
rasterio>=1.3.0
numpy>=1.24.0
scipy>=1.10.0
scikit-learn>=1.3.0
matplotlib>=3.7.0
pykrige>=1.7.0
Pillow>=10.0.0
```

## 🚀 Instalação e Configuração

### 1. Clone o repositório
```bash
git clone https://github.com/ScriptsRemote/connectfarm_krig.git
cd connectfarm_krig
```

### 2. Instale dependências Node.js
```bash
npm install
```

### 3. Instale dependências Python
```bash
pip install -r requirements.txt
```

### 4. Execute o servidor
```bash
node server.js
```

### 5. Acesse a aplicação
- **Página Principal**: http://localhost:3000
- **Análise de Solo**: http://localhost:3000/soil-analysis.html

## 📁 Estrutura do Projeto

```
connectfarm_krig/
├── public/                 # Frontend
│   ├── index.html         # Página principal - malhas
│   ├── soil-analysis.html # Página de análise de solo
│   ├── soil-analysis.js   # Lógica de interpolação
│   └── app.js            # Lógica das malhas
├── uploads/               # Arquivos enviados
├── output/               # Resultados das interpolações
├── server.js             # Servidor Node.js
├── soil_interpolation.py # Script Python para interpolação
├── extract_pixel_value.py # Script para extração de pixels
└── requirements.txt      # Dependências Python
```

## 🎯 Como Usar

### Análise de Solo e Interpolação

1. **Upload dos Dados**: Envie arquivo GeoJSON/Shapefile com dados de solo
2. **Seleção de Parâmetros**: Escolha os atributos para interpolação
3. **Configuração**: Defina método (Kriging/IDW), resolução e raio de busca
4. **Geração**: Execute a interpolação e visualize os resultados
5. **Inspeção**: Clique no mapa para ver valores dos pixels
6. **Download**: Baixe os arquivos TIFF e PNG gerados

### Geração de Malhas

1. **Definição da Área**: Desenhe polígono ou faça upload de área
2. **Configuração**: Defina espaçamento e tipo de malha
3. **Geração**: Crie a malha de pontos automaticamente
4. **Exportação**: Baixe os pontos em formato GeoJSON

## 🎨 Interface Gráfica

- **Identidade Visual ConnectFarm** com paleta de cores verde
- **Logo integrado** em todas as páginas
- **Design responsivo** e moderno
- **Mapas interativos** com Leaflet.js
- **Popups informativos** para inspeção de dados

## 📊 Formatos Suportados

### Entrada
- **GeoJSON** (.geojson)
- **Shapefile** (.zip)
- **KML/KMZ** (.kml, .kmz)

### Saída
- **GeoTIFF** (.tif) - dados raster
- **PNG** (.png) - visualização
- **GeoJSON** (.geojson) - pontos de malha

## 🔧 Configurações Avançadas

### Parâmetros de Interpolação
- **Resolução**: 1-50 metros (padrão: 10m)
- **Raio de busca**: 50-500 metros (padrão: 100m)
- **Método**: Kriging (recomendado) ou IDW

### Otimizações
- **Processamento em lotes** para datasets grandes
- **Fallback inteligente** IDW quando Kriging falha
- **Máscara otimizada** para área de interpolação
- **Carregamento progressivo** de mapas

## 📈 Desenvolvimento

O projeto utiliza:
- **PyKrige** para Kriging otimizado profissional
- **Rasterio** para manipulação eficiente de rasters
- **Scipy cKDTree** para busca rápida de vizinhos
- **Leaflet GeoRasterLayer** para visualização de TIFF
- **Extração server-side** de valores de pixel

## 🤝 Contribuição

1. Faça fork do projeto
2. Crie uma branch para sua feature (`git checkout -b feature/nova-feature`)
3. Commit suas mudanças (`git commit -m 'Adiciona nova feature'`)
4. Push para a branch (`git push origin feature/nova-feature`)
5. Abra um Pull Request

## 📄 Licença

Este projeto está sob licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.

## 🌱 ConnectFarm

Desenvolvido para agricultura de precisão, este sistema oferece ferramentas profissionais para análise espacial de dados de solo e geração de malhas de amostragem otimizadas.

---

**🎯 Ideal para**: Agrônomos, Consultores Agrícolas, Empresas de Agricultura de Precisão, Pesquisadores

**🔗 Repositório**: https://github.com/ScriptsRemote/connectfarm_krig