// Variáveis globais
let map;
let drawnItems;
let currentArea = null;
let currentBounds = null;
let currentAreaPolygon = null;
let selectedGridSize = null;
let gridData = null;

// Inicialização da aplicação
document.addEventListener('DOMContentLoaded', function() {
    initializeMap();
    setupEventListeners();
});

// Inicializar mapa Leaflet
function initializeMap() {
    // Criar mapa centrado no Brasil
    map = L.map('map').setView([-15.7801, -47.9292], 4);
    
    // Adicionar camada de tiles do OpenStreetMap
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    });
    
    // Adicionar camada de satélite
    const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri, Maxar, Earthstar Geographics, and the GIS User Community'
    });
    
    // Adicionar camada de terreno
    const terrainLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenTopoMap contributors'
    });
    
    // Adicionar camadas ao mapa
    osmLayer.addTo(map);
    
    // Criar controle de camadas
    const baseMaps = {
        "OpenStreetMap": osmLayer,
        "Satélite": satelliteLayer,
        "Terreno": terrainLayer
    };
    
    L.control.layers(baseMaps).addTo(map);
    
    // Inicializar camada para itens desenhados
    drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);
    
    // Adicionar controle de desenho
    const drawControl = new L.Control.Draw({
        draw: {
            polygon: {
                allowIntersection: false,
                drawError: {
                    color: '#e1e100',
                    message: '<strong>Erro:</strong> Polígonos não podem se intersectar!'
                },
                shapeOptions: {
                    color: '#667eea',
                    weight: 3,
                    fillOpacity: 0.3
                }
            },
            rectangle: {
                shapeOptions: {
                    color: '#667eea',
                    weight: 3,
                    fillOpacity: 0.3
                }
            },
            circle: false,
            circlemarker: false,
            marker: false,
            polyline: false
        },
        edit: {
            featureGroup: drawnItems,
            remove: true
        }
    });
    
    map.addControl(drawControl);
    
    // Eventos de desenho
    map.on('draw:created', function(e) {
        const layer = e.layer;
        drawnItems.addLayer(layer);
        
        // Calcular área e bounds
        calculateAreaFromLayer(layer);
        
        // Ajustar zoom para mostrar a área desenhada
        map.fitBounds(layer.getBounds(), { padding: [20, 20] });
    });
    
    map.on('draw:edited', function(e) {
        const layers = e.layers;
        layers.eachLayer(function(layer) {
            calculateAreaFromLayer(layer);
        });
    });
    
    map.on('draw:deleted', function(e) {
        clearAreaInfo();
    });
}

// Configurar event listeners
function setupEventListeners() {
    // Upload de arquivo
    const fileInput = document.getElementById('fileInput');
    fileInput.addEventListener('change', handleFileUpload);
    
    // Drag and drop
    const fileUpload = document.getElementById('fileUpload');
    
    fileUpload.addEventListener('dragover', function(e) {
        e.preventDefault();
        fileUpload.classList.add('dragover');
    });
    
    fileUpload.addEventListener('dragleave', function(e) {
        e.preventDefault();
        fileUpload.classList.remove('dragover');
    });
    
    fileUpload.addEventListener('drop', function(e) {
        e.preventDefault();
        fileUpload.classList.remove('dragover');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFile(files[0]);
        }
    });
    
    fileUpload.addEventListener('click', function() {
        fileInput.click();
    });
}

// Manipular upload de arquivo
function handleFileUpload(e) {
    const file = e.target.files[0];
    if (file) {
        handleFile(file);
    }
}

// Processar arquivo
function handleFile(file) {
    showLoading(true);
    
    const formData = new FormData();
    formData.append('file', file);
    
    let endpoint;
    if (file.name.endsWith('.kml') || file.name.endsWith('.kmz')) {
        endpoint = '/upload/kml';
    } else if (file.name.endsWith('.geojson') || file.name.endsWith('.json')) {
        endpoint = '/upload/geojson';
    } else if (file.name.endsWith('.zip')) {
        endpoint = '/upload/shapefile';
    } else {
        showAlert('Formato de arquivo não suportado. Use KML, KMZ, GeoJSON, JSON ou ZIP (Shapefile).', 'danger');
        showLoading(false);
        return;
    }
    
    fetch(endpoint, {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            displayImportedArea(data);
            showAlert('Arquivo importado com sucesso!', 'success');
        } else {
            showAlert('Erro ao processar arquivo: ' + data.error, 'danger');
        }
    })
    .catch(error => {
        console.error('Erro:', error);
        showAlert('Erro ao processar arquivo', 'danger');
    })
    .finally(() => {
        showLoading(false);
    });
}

// Exibir área importada
function displayImportedArea(data) {
    // Limpar área anterior
    clearMap();
    
    // Adicionar nova área ao mapa
    const geoJsonLayer = L.geoJSON(data.geoJson, {
        style: {
            color: '#667eea',
            weight: 3,
            fillColor: '#667eea',
            fillOpacity: 0.3
        }
    }).addTo(drawnItems);
    
    // Ajustar view do mapa com zoom adequado
    const bounds = geoJsonLayer.getBounds();
    map.fitBounds(bounds, { padding: [20, 20] });
    
    // Salvar dados da área
    currentArea = data.geoJson;
    currentBounds = data.bounds;
    currentAreaPolygon = data.areaPolygon;
    
    // Exibir informações
    displayAreaInfo(data.area, data.bounds);
    
    // Mostrar opções de grid
    document.getElementById('gridOptions').style.display = 'block';
}

// Calcular área a partir de camada desenhada
function calculateAreaFromLayer(layer) {
    // Limpar área anterior
    clearAreaInfo();
    
    // Obter coordenadas
    let coordinates;
    if (layer instanceof L.Polygon) {
        coordinates = layer.getLatLngs()[0];
    } else if (layer instanceof L.Rectangle) {
        const bounds = layer.getBounds();
        coordinates = [
            [bounds.getNorthEast().lat, bounds.getNorthEast().lng],
            [bounds.getNorthEast().lat, bounds.getSouthWest().lng],
            [bounds.getSouthWest().lat, bounds.getSouthWest().lng],
            [bounds.getSouthWest().lat, bounds.getNorthEast().lng],
            [bounds.getNorthEast().lat, bounds.getNorthEast().lng]
        ];
    }
    
    if (coordinates) {
        // Calcular área aproximada em hectares
        const area = calculatePolygonArea(coordinates);
        
        // Calcular bounds
        const lats = coordinates.map(coord => coord.lat || coord[0]);
        const lngs = coordinates.map(coord => coord.lng || coord[1]);
        
        const bounds = [
            [Math.min(...lats), Math.min(...lngs)],
            [Math.max(...lats), Math.max(...lngs)]
        ];
        
        // Salvar dados
        currentArea = {
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [coordinates.map(coord => [coord.lng || coord[1], coord.lat || coord[0]])]
            }
        };
        currentBounds = bounds;
        currentAreaPolygon = currentArea;
        
        // Exibir informações
        displayAreaInfo(area, bounds);
        
        // Mostrar opções de grid
        document.getElementById('gridOptions').style.display = 'block';
    }
}

// Calcular área de polígono em hectares
function calculatePolygonArea(coordinates) {
    let area = 0;
    const n = coordinates.length;
    
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const lat1 = coordinates[i].lat || coordinates[i][0];
        const lng1 = coordinates[i].lng || coordinates[i][1];
        const lat2 = coordinates[j].lat || coordinates[j][0];
        const lng2 = coordinates[j].lng || coordinates[j][1];
        
        area += lng1 * lat2;
        area -= lng2 * lat1;
    }
    
    area = Math.abs(area) / 2;
    
    // Converter para hectares (aproximação)
    const centerLat = coordinates[0].lat || coordinates[0][0];
    return area * 111.32 * 111.32 * Math.cos(centerLat * Math.PI / 180) / 10000;
}

// Exibir informações da área
function displayAreaInfo(area, bounds) {
    document.getElementById('totalArea').textContent = area.toFixed(2);
    document.getElementById('centerLat').textContent = ((bounds[0][0] + bounds[1][0]) / 2).toFixed(6);
    document.getElementById('centerLng').textContent = ((bounds[0][1] + bounds[1][1]) / 2).toFixed(6);
    document.getElementById('areaInfo').style.display = 'block';
}

// Limpar informações da área
function clearAreaInfo() {
    document.getElementById('areaInfo').style.display = 'none';
    document.getElementById('gridOptions').style.display = 'none';
    document.getElementById('exportSection').style.display = 'none';
    currentArea = null;
    currentBounds = null;
    currentAreaPolygon = null;
    selectedGridSize = null;
    gridData = null;
}

// Selecionar tamanho do grid
function selectGridSize(size) {
    selectedGridSize = size;
    
    // Remover seleção anterior
    document.querySelectorAll('.grid-option').forEach(option => {
        option.classList.remove('selected');
    });
    
    // Selecionar nova opção
    event.target.closest('.grid-option').classList.add('selected');
}

// Gerar grid
function generateGrid() {
    if (!currentBounds || !selectedGridSize) {
        showAlert('Selecione uma área e um tamanho de grid', 'warning');
        return;
    }
    
    showLoading(true);
    
    fetch('/generate-grid', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            bounds: currentBounds,
            gridSize: selectedGridSize,
            areaPolygon: currentAreaPolygon
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            gridData = data;
            displayGridOnMap(data);
            showExportSection();
            showAlert('Malha de amostragem gerada com sucesso!', 'success');
        } else {
            showAlert('Erro ao gerar grid: ' + data.error, 'danger');
        }
    })
    .catch(error => {
        console.error('Erro:', error);
        showAlert('Erro ao gerar grid', 'danger');
    })
    .finally(() => {
        showLoading(false);
    });
}

// Exibir grid no mapa
function displayGridOnMap(data) {
    // Limpar grid anterior
    if (window.gridLayer) {
        map.removeLayer(window.gridLayer);
    }
    if (window.pointsLayer) {
        map.removeLayer(window.pointsLayer);
    }
    
    // Adicionar polígonos do grid
    window.gridLayer = L.geoJSON(data.grid, {
        style: {
            color: '#ff6b6b',
            weight: 1,
            fillColor: '#ff6b6b',
            fillOpacity: 0.1
        }
    }).addTo(map);
    
    // Adicionar pontos centrais
    window.pointsLayer = L.geoJSON(data.points, {
        pointToLayer: function(feature, latlng) {
            return L.circleMarker(latlng, {
                radius: 6,
                fillColor: '#4ecdc4',
                color: '#2c3e50',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8
            }).bindPopup(`
                <strong>Ponto ${feature.properties.id}</strong><br>
                Grid: ${feature.properties.gridSize} ha<br>
                Lat: ${feature.properties.latitude.toFixed(6)}<br>
                Lng: ${feature.properties.longitude.toFixed(6)}
            `);
        }
    }).addTo(map);
}

// Mostrar seção de exportação
function showExportSection() {
    document.getElementById('exportSection').style.display = 'block';
}

// Exportar grid
function exportGrid(format) {
    if (!gridData || !gridData.grid) {
        showAlert('Nenhum grid para exportar', 'warning');
        return;
    }
    
    const filename = `grid_${selectedGridSize}ha_${new Date().toISOString().split('T')[0]}`;
    
    if (format === 'kml') {
        exportAsKML(gridData.grid, filename);
    } else if (format === 'geojson') {
        exportAsGeoJSON(gridData.grid, filename);
    }
}

// Exportar pontos
function exportPoints(format) {
    if (!gridData || !gridData.points) {
        showAlert('Nenhum ponto para exportar', 'warning');
        return;
    }
    
    const filename = `pontos_${selectedGridSize}ha_${new Date().toISOString().split('T')[0]}`;
    
    if (format === 'kml') {
        exportAsKML(gridData.points, filename);
    } else if (format === 'geojson') {
        exportAsGeoJSON(gridData.points, filename);
    }
}

// Exportar como KML
function exportAsKML(features, filename) {
    fetch('/export/kml', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            features: features,
            filename: filename
        })
    })
    .then(response => response.blob())
    .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}.kml`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    })
    .catch(error => {
        console.error('Erro ao exportar KML:', error);
        showAlert('Erro ao exportar KML', 'danger');
    });
}

// Exportar como GeoJSON
function exportAsGeoJSON(features, filename) {
    console.log('📁 Iniciando export GeoJSON:', filename, '- Features:', features.length);
    
    // Validar dados antes de enviar
    if (!features || features.length === 0) {
        showAlert('Nenhuma feature para exportar', 'warning');
        return;
    }
    
    fetch('/export/geojson', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            features: features,
            filename: filename
        })
    })
    .then(response => {
        console.log('📁 Resposta do servidor:', response.status, response.statusText);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        // Verificar se é realmente um blob
        const contentType = response.headers.get('Content-Type');
        console.log('📁 Content-Type:', contentType);
        
        return response.blob();
    })
    .then(blob => {
        console.log('📁 Blob recebido:', blob.size, 'bytes, tipo:', blob.type);
        
        // Verificar se o blob não está vazio
        if (blob.size === 0) {
            throw new Error('Arquivo vazio recebido do servidor');
        }
        
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}.geojson`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
        console.log('✅ Download iniciado:', `${filename}.geojson`);
        showAlert('Arquivo GeoJSON baixado com sucesso!', 'success');
    })
    .catch(error => {
        console.error('❌ Erro ao exportar GeoJSON:', error);
        showAlert(`Erro ao exportar GeoJSON: ${error.message}`, 'danger');
    });
}

// Funções auxiliares
function enableDrawing() {
    // O Leaflet Draw já está configurado, apenas mostrar instruções
    showAlert('Clique no ícone de polígono na barra de ferramentas do mapa para começar a desenhar', 'info');
}

function finishDrawing() {
    // O Leaflet Draw já finaliza automaticamente
    showAlert('Desenho finalizado automaticamente. Edite ou delete conforme necessário.', 'info');
}

function clearMap() {
    drawnItems.clearLayers();
    if (window.gridLayer) {
        map.removeLayer(window.gridLayer);
    }
    if (window.pointsLayer) {
        map.removeLayer(window.pointsLayer);
    }
    clearAreaInfo();
}

function showLoading(show) {
    document.getElementById('loading').style.display = show ? 'block' : 'none';
}

function showAlert(message, type) {
    // Criar alerta Bootstrap
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-custom alert-dismissible fade show`;
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    // Inserir no início do conteúdo
    const content = document.querySelector('.content');
    content.insertBefore(alertDiv, content.firstChild);
    
    // Auto-remover após 5 segundos
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.remove();
        }
    }, 5000);
}

// Adicionar biblioteca Leaflet Draw se não estiver disponível
if (typeof L.Control.Draw === 'undefined') {
    const drawCSS = document.createElement('link');
    drawCSS.rel = 'stylesheet';
    drawCSS.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.css';
    document.head.appendChild(drawCSS);
    
    const drawJS = document.createElement('script');
    drawJS.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.js';
    drawJS.onload = function() {
        // Reinicializar mapa com controles de desenho
        if (map) {
            const drawControl = new L.Control.Draw({
                draw: {
                    polygon: {
                        allowIntersection: false,
                        drawError: {
                            color: '#e1e100',
                            message: '<strong>Erro:</strong> Polígonos não podem se intersectar!'
                        },
                        shapeOptions: {
                            color: '#667eea',
                            weight: 3,
                            fillOpacity: 0.3
                        }
                    },
                    rectangle: {
                        shapeOptions: {
                            color: '#667eea',
                            weight: 3,
                            fillOpacity: 0.3
                        }
                    },
                    circle: false,
                    circlemarker: false,
                    marker: false,
                    polyline: false
                },
                edit: {
                    featureGroup: drawnItems,
                    remove: true
                }
            });
            
            map.addControl(drawControl);
        }
    };
    document.head.appendChild(drawJS);
}
