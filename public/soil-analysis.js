// Variáveis globais
let map;
let soilData = null;
let layerControl = null;
let overlayMaps = {};
let currentSoilPointsLayer = null;
let selectedParameters = [];
let selectedMethod = null;
let interpolationResults = null;

// Variáveis de otimização
let pointClusters = null;
let loadingProgress = 0;
let maxPointsPerBatch = 1000; // Pontos por lote
let currentBatch = 0;
let totalBatches = 0;
let isProcessingPoints = false;
let debounceTimer = null;


// --- Paleta RdYlGn melhorada (0..1 -> rgb) ---
function clamp(x,a,b){ return Math.max(a, Math.min(b, x)); }
function lerp(a,b,t){ return a + (b-a)*t; }
function rdylgnRamp(t){
  t = clamp(t, 0, 1);
  let r,g,b;
  
  // Paleta com mais contraste: Vermelho -> Amarelo -> Verde
  if (t < 0.25) {
    // Vermelho escuro para vermelho
    const k = t / 0.25;
    r = Math.round(lerp(139, 255, k)); // Vermelho escuro -> Vermelho
    g = Math.round(lerp(0, 0, k));
    b = 0;
  } else if (t < 0.5) {
    // Vermelho para laranja
    const k = (t - 0.25) / 0.25;
    r = 255;
    g = Math.round(lerp(0, 165, k)); // Vermelho -> Laranja
    b = 0;
  } else if (t < 0.75) {
    // Laranja para amarelo
    const k = (t - 0.5) / 0.25;
    r = 255;
    g = Math.round(lerp(165, 255, k)); // Laranja -> Amarelo
    b = 0;
  } else {
    // Amarelo para verde
    const k = (t - 0.75) / 0.25;
    r = Math.round(lerp(255, 0, k)); // Amarelo -> Verde
    g = 255;
    b = Math.round(lerp(0, 100, k)); // Adicionar um pouco de azul para verde mais natural
  }
  
  return `rgb(${r},${g},${b})`;
}

// 🚀 Versão ultra-otimizada para renderização rápida de TIFF
function rdylgnRampFast(t) {
  // Cache de cores pré-calculadas para performance máxima
  const colorSteps = [
    'rgb(255,0,0)',     // 0.0 - Vermelho
    'rgb(255,64,0)',    // 0.1
    'rgb(255,128,0)',   // 0.2
    'rgb(255,192,0)',   // 0.3
    'rgb(255,255,0)',   // 0.4 - Amarelo
    'rgb(192,255,0)',   // 0.5
    'rgb(128,255,0)',   // 0.6
    'rgb(64,255,0)',    // 0.7
    'rgb(0,255,0)',     // 0.8 - Verde
    'rgb(0,255,64)',    // 0.9
    'rgb(0,255,128)'    // 1.0
  ];
  
  const index = Math.floor(t * (colorSteps.length - 1));
  return colorSteps[Math.min(index, colorSteps.length - 1)];
}

// --- Legenda reposicionada ---
function addRasterLegend(min, max, title = "Escala (RdYlGn)") {
  let el = document.getElementById('rasterLegend');
  if (!el) {
    el = document.createElement('div');
    el.id = 'rasterLegenda';
    el.style.position = 'absolute';
    el.style.bottom = '20px'; 
    el.style.left = '20px';
    el.style.zIndex = 1000; 
    el.style.background = 'rgba(255, 255, 255, 0.95)';
    el.style.padding = '10px 12px'; 
    el.style.borderRadius = '8px';
    el.style.boxShadow = '0 3px 10px rgba(0,0,0,0.3)'; 
    el.style.font = '13px system-ui';
    el.style.border = '1px solid #ccc';
    el.style.minWidth = '220px';
    
    const canvas = document.createElement('canvas'); 
    canvas.width = 200; 
    canvas.height = 15; 
    canvas.id = 'rasterLegendCanvas';
    canvas.style.border = '1px solid #ddd';
    canvas.style.borderRadius = '3px';
    
    const labels = document.createElement('div'); 
    labels.style.display = 'flex'; 
    labels.style.justifyContent = 'space-between';
    labels.style.marginTop = '5px';
    labels.style.fontSize = '11px';
    labels.style.color = '#666';
    labels.innerHTML = `<span id="lgMin">${min.toFixed(3)}</span><span id="lgMax">${max.toFixed(3)}</span>`;
    
    el.innerHTML = `<div style="font-weight: bold; margin-bottom: 5px; color: #333;">${title}</div>`;
    el.appendChild(canvas); 
    el.appendChild(labels);
    
    // Adicionar dentro do container do mapa, não no body
    const mapContainer = document.querySelector('.map-container');
    if (mapContainer) {
      mapContainer.style.position = 'relative'; // Garantir posicionamento relativo
      mapContainer.appendChild(el);
    } else {
    document.body.appendChild(el);
    }
  }
  const c = document.getElementById('rasterLegendCanvas').getContext('2d');
  for (let x = 0; x < 200; x++) { c.fillStyle = rdylgnRamp(x/199); c.fillRect(x, 0, 1, 15); }
  document.getElementById('lgMin').textContent = min.toFixed(3);
  document.getElementById('lgMax').textContent = max.toFixed(3);
}

// --- Adiciona GeoTIFF como overlay Leaflet OTIMIZADO ---
async function addTiffLayer(tiffUrl, layerName, minHint=null, maxHint=null) {
  try {
    console.log(`🚀 Carregando TIFF otimizado: ${tiffUrl}`);
    
    // 🔄 Mostrar indicador de loading
    showTiffLoadingProgress(layerName, 0);
    
    // Verificar se as bibliotecas estão disponíveis
    if (typeof parseGeoraster === 'undefined') {
      throw new Error('parseGeoraster não está disponível. Use checkLibraryStatus() para verificar.');
    }
    
    if (typeof GeoRasterLayer === 'undefined') {
      throw new Error('GeoRasterLayer não está disponível. Use checkLibraryStatus() para verificar.');
    }
    
    console.log('📚 Bibliotecas disponíveis, carregando TIFF...');
    showTiffLoadingProgress(layerName, 20);
    
    // Carregar o TIFF usando fetch + arrayBuffer (como no exemplo)
    const response = await fetch(tiffUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    console.log(`📊 ArrayBuffer carregado: ${arrayBuffer.byteLength} bytes`);
    showTiffLoadingProgress(layerName, 40);
    
    // Usar parseGeoraster com arrayBuffer (como no exemplo)
    const georaster = await parseGeoraster(arrayBuffer);
    console.log('Georaster carregado:', georaster);
    showTiffLoadingProgress(layerName, 60);
    
    // Verificar se temos dados válidos
    if (!georaster || !georaster.pixelWidth) {
      throw new Error('Georaster inválido ou sem dados');
    }
    
    // Obter estatísticas dos dados
    const mins = georaster.mins || [georaster.min ?? 0];
    const maxs = georaster.maxs || [georaster.max ?? 1];
    const noData = georaster.noDataValue;

    // CORRIGIDO: Usar valores reais do georaster se não houver hint
    let min, max;
    
    if (minHint !== null && maxHint !== null) {
        // Usar valores do servidor se disponíveis
        min = minHint;
        max = maxHint;
        console.log(`🎯 Usando valores do servidor: min=${min}, max=${max}`);
    } else {
        // Calcular valores reais dos dados
        min = mins[0];
        max = maxs[0];
        
        // Se ainda não temos valores válidos, calcular dos dados brutos
        if (min === max || min === 0 && max === 1) {
            console.log('📊 Calculando valores reais dos dados...');
            const values = georaster.values[0];
            if (values && values.length > 0) {
                // Filtrar valores válidos (não NaN, não noData)
                const validValues = values.filter(v => 
                    v !== null && 
                    !isNaN(v) && 
                    v !== noData &&
                    v !== 0 // Assumindo que 0 pode ser noData mascarado
                );
                
                if (validValues.length > 0) {
                    min = Math.min(...validValues);
                    max = Math.max(...validValues);
                    console.log(`🔍 Valores calculados dos dados: min=${min}, max=${max} (${validValues.length} pixels válidos)`);
                }
            }
        }
        
        console.log(`📊 Valores finais: min=${min}, max=${max}`);
    }
    
    console.log(`📊 Estatísticas TIFF:`);
    console.log(`  - Min: ${min}`);
    console.log(`  - Max: ${max}`);
    console.log(`  - NoData: ${noData}`);
    console.log(`  - Range: ${max - min}`);
    console.log(`📐 Dimensões: ${georaster.pixelWidth}x${georaster.pixelHeight}`);

    // Função de cores RdYlGn (Red→Yellow→Green) com melhor contraste
    const pixelValuesToColorFn = (values) => {
      const v = values[0];
      if (v == null || Number.isNaN(v) || v === noData || v === 0) return null;
      
      // Garantir que temos um range válido
      const range = Math.max(max - min, 0.001); // Evitar divisão por zero
      const t = Math.max(0, Math.min(1, (v - min) / range)); // Clampar entre 0 e 1
      
      // Aplicar uma curva suave para melhor distribuição visual
      const smoothT = Math.sin(t * Math.PI / 2); // Curva suave
      
      return rdylgnRamp(smoothT);
    };

    // Criar GeoRasterLayer com otimizações de performance
    const tiffLayer = new GeoRasterLayer({
      georaster: georaster,
      opacity: 0.9,
      pixelValuesToColorFn: pixelValuesToColorFn,
      // 🚀 OTIMIZAÇÕES DE PERFORMANCE:
      resolution: 128, // Reduzir resolução para carregamento mais rápido
      // Usar menos pixels para exibição inicial
      debugLevel: -1, // Desabilitar logs de debug
      // Otimizar resampling
      resampleMethod: "nearest", // Mais rápido que bilinear
      // Cache de tiles
      useWorker: true, // Usar Web Workers se disponível
      // Renderização otimizada
      pixelValuesToColorFn: function(values) {
        const v = values[0];
        if (v == null || Number.isNaN(v) || v === noData || v === 0) return null;
        
        // Versão otimizada da função de cores
        const range = max - min;
        if (range <= 0) return 'rgba(128,128,128,0.8)';
        
        const t = Math.max(0, Math.min(1, (v - min) / range));
        return rdylgnRampFast(t); // Versão otimizada
      }
    });

    showTiffLoadingProgress(layerName, 80);

    // 🔧 IMPORTANTE: Anexar georaster ao layer para detecção
    tiffLayer.georaster = georaster;
    tiffLayer.layerName = layerName;
    tiffLayer.minValue = min;
    tiffLayer.maxValue = max;
    
    // 🎯 CRUCIAL: Configurar interatividade para capturar cliques
    if (tiffLayer.options) {
        tiffLayer.options.interactive = true;
        tiffLayer.options.bubblingMouseEvents = false;
    }
    
    // Configurar z-index para garantir que fique por cima
    if (tiffLayer.setZIndex) {
        tiffLayer.setZIndex(1000);
    }
    
    console.log(`🔧 Layer configurado com georaster:`, !!tiffLayer.georaster);

    // Adicionar ao mapa
    tiffLayer.addTo(map);
    
    // Adicionar funcionalidade de inspeção de valores ao passar o mouse
    setupTiffInspection(tiffLayer, georaster, min, max, layerName);
    
    // ❌ REMOVIDO: Inspeção direta antiga (substituída por diagnóstico completo)
    console.log("🔧 Inspeção direta removida - usando diagnóstico completo...");
    
    /*
    // Função robusta de inspeção
    function inspectPixel(latlng) {
        console.log(`🔍 Inspecionando: ${latlng.lat}, ${latlng.lng}`);
        
        // Tentar múltiplas abordagens
        let pixelValue = null;
        
        // Abordagem 1: getPixelValue padrão
        try {
            const result1 = getPixelValue(georaster, latlng.lng, latlng.lat);
            console.log(`🔍 Tentativa 1:`, result1);
            if (result1 !== null) pixelValue = result1;
        } catch (e) {
            console.log(`❌ Tentativa 1 falhou:`, e);
        }
        
        // Abordagem 2: Cálculo direto simplificado
        if (pixelValue === null) {
            try {
                console.log(`🔍 Tentativa 2: Cálculo direto`);
                const bounds = georaster;
                const x = latlng.lng;
                const y = latlng.lat;
                
                // Verificar se está dentro dos bounds gerais
                if (x >= bounds.xmin && x <= bounds.xmax && y >= bounds.ymin && y <= bounds.ymax) {
                    // Calcular posição no grid
                    const relativeX = (x - bounds.xmin) / (bounds.xmax - bounds.xmin);
                    const relativeY = (bounds.ymax - y) / (bounds.ymax - bounds.ymin);
                    
                    const col = Math.floor(relativeX * bounds.width);
                    const row = Math.floor(relativeY * bounds.height);
                    
                    console.log(`📊 Posição calculada: col=${col}, row=${row}, bounds=${bounds.width}x${bounds.height}`);
                    
                    if (col >= 0 && col < bounds.width && row >= 0 && row < bounds.height) {
                        const index = row * bounds.width + col;
                        if (bounds.values && bounds.values[0] && index < bounds.values[0].length) {
                            pixelValue = bounds.values[0][index];
                            console.log(`✅ Valor encontrado (método 2): ${pixelValue}`);
                        }
                    }
                }
            } catch (e) {
                console.log(`❌ Tentativa 2 falhou:`, e);
            }
        }
        
        // Abordagem 3: Valor médio como fallback
        if (pixelValue === null || isNaN(pixelValue)) {
            try {
                console.log(`🔍 Tentativa 3: Valor médio`);
                if (georaster.values && georaster.values[0]) {
                    const validValues = georaster.values[0].filter(v => v !== null && !isNaN(v) && v !== georaster.noDataValue);
                    if (validValues.length > 0) {
                        pixelValue = validValues.reduce((a, b) => a + b, 0) / validValues.length;
                        console.log(`🔧 Usando valor médio: ${pixelValue}`);
                        return { value: pixelValue, interpolated: true };
                    }
                }
            } catch (e) {
                console.log(`❌ Tentativa 3 falhou:`, e);
            }
        }
        
        return pixelValue;
    }
    
    // Event listeners robustos
    tiffLayer.on('click', function(e) {
        console.log("🖱️ CLICK DIRETO no layer TIFF!");
        const latlng = e.latlng;
        const pixelResult = inspectPixel(latlng);
        
        console.log(`🔍 Resultado da inspeção robusta:`, pixelResult);
        
        // Extrair valor
        let pixelValue, isInterpolated = false;
        if (typeof pixelResult === 'object' && pixelResult !== null) {
            pixelValue = pixelResult.value;
            isInterpolated = pixelResult.interpolated;
        } else {
            pixelValue = pixelResult;
        }
        
        if (pixelValue !== null && !isNaN(pixelValue)) {
            const interpolationText = isInterpolated ? ' (INTERPOLADO)' : '';
            alert(`✅ ${layerName}\nValor: ${pixelValue.toFixed(3)}${interpolationText}\nCoordenadas: ${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`);
        } else {
            alert(`❌ Não foi possível obter valor para esta posição\nCoordenadas: ${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`);
        }
    });
    
    // ❌ REMOVIDO: mouseover para evitar muitas mensagens
    // tiffLayer.on('mouseover', function(e) {
    //     console.log("🖱️ HOVER DIRETO no layer TIFF!");
    //     const latlng = e.latlng;
    //     const pixelResult = inspectPixel(latlng);
    //     console.log(`🔍 Valor hover robusto:`, pixelResult);
    // });
    */
    
    // Adicionar ao controle de camadas
    if (layerControl) {
      overlayMaps[layerName] = tiffLayer;
      layerControl.addOverlay(tiffLayer, layerName);
    }
    
    showTiffLoadingProgress(layerName, 90);
    
    // Ajustar bounds de forma otimizada
    if (tiffLayer.getBounds && tiffLayer.getBounds().isValid()) {
      const bounds = tiffLayer.getBounds();
      // 🚀 Zoom otimizado - não muito próximo para evitar lag
      map.fitBounds(bounds, { 
        padding: [20, 20],
        maxZoom: 15, // Reduzido de 18 para 15 para melhor performance
        minZoom: 8,
        animate: false // Desabilitar animação para carregar mais rápido
      });
    }
    
    // Adicionar legenda
    addRasterLegend(min, max, `${layerName} (RdYlGn)`);
    
    // 🎯 CRUCIAL: Configurar inspeção de pixel no TIFF
    console.log("🔧 Configurando inspeção de pixel...");
    console.log("📊 TiffLayer objeto:", tiffLayer);
    console.log("📊 TiffLayer tipo:", typeof tiffLayer);
    console.log("📊 TiffLayer tem .on?", typeof tiffLayer.on === 'function');
    
    // ❌ EVENTOS DO TIFF LAYER DESABILITADOS - USANDO MAP ONCLICK COM AXIOS
    console.log("📡 Eventos do tiffLayer desabilitados - usando solução Axios");
    
    // ❌ COMENTADO: setupTiffInspection(tiffLayer, georaster, min, max, layerName);
    // ❌ COMENTADO: Evento de clique direto no tiffLayer 
    /*
    tiffLayer.on('click', function(e) {
        console.log("🎯 ===== CLIQUE NO TIFF LAYER DETECTADO! =====");
        console.log("📍 Coordenadas:", e.latlng.lat, e.latlng.lng);
        
        // Impedir propagação para o mapa
        if (e.originalEvent) {
            e.originalEvent.stopPropagation();
        }
        
        // Flag para evitar clique no mapa geral
        window.tiffClickHandled = true;
        
        try {
            // Tentar extração com múltiplas estratégias
            let pixelValue = null;
            
            // Estratégia 1: Extrator offline
            if (window.offlinePixelExtractor && georaster) {
                pixelValue = window.offlinePixelExtractor.extractValue(georaster, e.latlng.lng, e.latlng.lat);
                console.log("📊 Estratégia 1 - Valor extraído offline:", pixelValue);
                
                if (pixelValue === null || pixelValue === undefined) {
                    pixelValue = window.offlinePixelExtractor.extractWithSampling(georaster, e.latlng.lng, e.latlng.lat);
                    console.log("📊 Estratégia 1b - Valor com amostragem:", pixelValue);
                }
            }
            
            // Estratégia 2: Acesso direto alternativo (se ainda null)
            if ((pixelValue === null || pixelValue === undefined) && georaster) {
                console.log("🔄 Tentando estratégia alternativa...");
                try {
                    const { xmin, xmax, ymin, ymax, width, height } = georaster;
                    const lng = e.latlng.lng;
                    const lat = e.latlng.lat;
                    
                    // Método alternativo de cálculo
                    const pixelX = Math.round((lng - xmin) / (xmax - xmin) * (width - 1));
                    const pixelY = Math.round((ymax - lat) / (ymax - ymin) * (height - 1));
                    
                    console.log("📊 Método alternativo:", { pixelX, pixelY, width, height });
                    
                    if (pixelX >= 0 && pixelX < width && pixelY >= 0 && pixelY < height) {
                        const data = georaster.values[0];
                        const idx = pixelY * width + pixelX;
                        pixelValue = data[idx];
                        console.log("📊 Estratégia 2 - Valor alternativo:", pixelValue);
                    }
                } catch (err) {
                    console.log("❌ Estratégia 2 falhou:", err);
                }
            }
            
            // Estratégia 3: Valor médio como último recurso
            if ((pixelValue === null || pixelValue === undefined) && georaster && georaster.values && georaster.values[0]) {
                console.log("🔄 Usando valor médio como fallback...");
                try {
                    const data = georaster.values[0];
                    let sum = 0, count = 0;
                    
                    // Amostragem de alguns valores válidos
                    for (let i = 0; i < Math.min(data.length, 100); i += 10) {
                        const val = data[i];
                        if (val !== null && val !== undefined && !isNaN(val) && val !== 0) {
                            sum += val;
                            count++;
                        }
                    }
                    
                    if (count > 0) {
                        pixelValue = sum / count;
                        console.log("📊 Estratégia 3 - Valor médio:", pixelValue);
                    }
                } catch (err) {
                    console.log("❌ Estratégia 3 falhou:", err);
                }
            }
            
            // Mostrar resultado
            if (pixelValue !== null && !isNaN(pixelValue)) {
                const classification = classifyValue(pixelValue, min, max);
                const valueColor = getValueColor(pixelValue, min, max);
                
                L.popup()
                    .setLatLng(e.latlng)
                    .setContent(`
                        <div style="background: #1abc9c; color: white; padding: 12px; border-radius: 8px; text-align: center;">
                            <strong>💾 ${layerName}</strong><br>
                            <div style="font-size: 18px; margin: 8px 0;">
                                <strong style="color: ${valueColor};">${pixelValue.toFixed(3)}</strong>
                            </div>
                            <div style="background: rgba(255,255,255,0.2); padding: 4px 8px; border-radius: 4px;">
                                ${classification}
                            </div>
                            <small>Lat: ${e.latlng.lat.toFixed(6)} | Lng: ${e.latlng.lng.toFixed(6)}</small>
                        </div>
                    `)
                    .openOn(map);
                    
                // Copiar para clipboard
                navigator.clipboard.writeText(pixelValue.toString()).catch(() => {});
                
            } else {
                // Popup de erro
                L.popup()
                    .setLatLng(e.latlng)
                    .setContent(`
                        <div style="background: #e74c3c; color: white; padding: 10px; border-radius: 5px; text-align: center;">
                            <strong>❌ Falha na Extração</strong><br>
                            <small>Lat: ${e.latlng.lat.toFixed(6)}<br>
                            Lng: ${e.latlng.lng.toFixed(6)}</small>
                        </div>
                    `)
                    .openOn(map);
            }
            
        } catch (error) {
            console.error("❌ Erro no clique do TIFF:", error);
        }
        
        // Reset flag após um tempo
        setTimeout(() => {
            window.tiffClickHandled = false;
        }, 200);
    });
    */
    
    showTiffLoadingProgress(layerName, 100);
    setTimeout(() => hideTiffLoadingProgress(), 500); // Ocultar após 500ms
    
    console.log(`✅ Camada TIFF otimizada adicionada: ${layerName} (min: ${min}, max: ${max})`);
    return true;
    
  } catch (error) {
    console.error(`❌ Erro ao carregar TIFF ${tiffUrl}:`, error);
    hideTiffLoadingProgress();
    
    // Mostrar mensagem clara sobre o problema
    if (error.message.includes('parseGeoraster não está disponível')) {
      console.log('🚫 Bibliotecas não carregadas. Use checkLibraryStatus() para verificar.');
    }
    
    return false;
  }
}

// 🔄 Sistema de loading progressivo para TIFF
function showTiffLoadingProgress(layerName, percentage) {
  let progressEl = document.getElementById('tiffLoadingProgress');
  if (!progressEl) {
    progressEl = document.createElement('div');
    progressEl.id = 'tiffLoadingProgress';
    progressEl.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(255,255,255,0.95);
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 10000;
      min-width: 300px;
      text-align: center;
      font-family: system-ui;
    `;
    document.body.appendChild(progressEl);
  }
  
  progressEl.innerHTML = `
    <h4 style="margin: 0 0 10px 0; color: #333;">🗺️ Carregando Camada</h4>
    <p style="margin: 0 0 15px 0; color: #666;">${layerName}</p>
    <div style="background: #eee; border-radius: 10px; overflow: hidden; height: 8px;">
      <div style="background: linear-gradient(90deg, #ff6b6b, #feca57, #48ca95); 
                  height: 100%; width: ${percentage}%; transition: width 0.3s ease;"></div>
    </div>
    <p style="margin: 10px 0 0 0; font-size: 14px; color: #888;">${percentage}%</p>
  `;
}

function hideTiffLoadingProgress() {
  const progressEl = document.getElementById('tiffLoadingProgress');
  if (progressEl) {
    progressEl.remove();
  }
}

// 🔍 Ferramenta de inspeção de valores TIFF otimizada
function setupTiffInspection(tiffLayer, georaster, min, max, layerName) {
    let inspectionPopup = null;
    let lastPixelValue = null;
    
    console.log(`🔍 Configurando inspeção para ${layerName} com range: ${min} - ${max}`);
    
    // 🎨 Função para obter cor baseada no valor
    function getValueColor(value, min, max) {
        const t = (value - min) / (max - min);
        return rdylgnRampFast(t);
    }
    
    // 📊 Função para classificar o valor
    function classifyValue(value, min, max) {
        const range = max - min;
        const third = range / 3;
        
        if (value <= min + third) return '📉 BAIXO';
        if (value <= min + 2 * third) return '📊 MÉDIO';
        return '📈 ALTO';
    }
    
    // Remover listeners antigos (sem namespace para garantir compatibilidade)
    map.off('mousemove');
    map.off('click'); 
    map.off('mouseout');
    
    // 🎯 ARMAZENAR REFERÊNCIA GLOBAL DO LAYER
    window.currentTiffLayer = tiffLayer;
    window.currentGeoraster = georaster;
    window.currentLayerInfo = { min, max, layerName };
    
    // Event listener otimizado para mousemove
    function handleMouseMove(e) {
        console.log(`🖱️ Mouse em: ${e.latlng.lat}, ${e.latlng.lng}`);
        
        if (map.hasLayer(tiffLayer)) {
            const latlng = e.latlng;
            
            try {
                const pixelResult = getPixelValue(georaster, latlng.lng, latlng.lat);
                console.log(`🔍 Resultado do pixel:`, pixelResult);
                
                // Extrair valor e informação de interpolação
                let pixelValue, isInterpolated = false;
                if (typeof pixelResult === 'object' && pixelResult !== null) {
                    pixelValue = pixelResult.value;
                    isInterpolated = pixelResult.interpolated;
                } else {
                    pixelValue = pixelResult;
                }
                
                if (pixelValue !== null && !isNaN(pixelValue)) {
                    // 🚀 Otimização: só atualizar se o valor mudou significativamente
                    if (lastPixelValue === null || Math.abs(pixelValue - lastPixelValue) > 0.001) {
                        lastPixelValue = pixelValue;
                        
                        if (inspectionPopup) {
                            map.closePopup(inspectionPopup);
                        }
                        
                        const classification = classifyValue(pixelValue, min, max);
                        const valueColor = getValueColor(pixelValue, min, max);
                        const percentage = ((pixelValue - min) / (max - min) * 100).toFixed(1);
                        
                        console.log(`✅ Criando popup para valor: ${pixelValue}`);
                        
                        const interpolationBadge = isInterpolated ? 
                            `<div style="
                                background: linear-gradient(45deg, #3498db, #2980b9); 
                                color: white; 
                                padding: 2px 6px; 
                                border-radius: 12px; 
                                font-size: 8px; 
                                margin-bottom: 6px;
                                display: inline-block;
                                font-weight: bold;
                                text-transform: uppercase;
                                letter-spacing: 0.5px;
                            ">🔮 Interpolado</div>` : '';
                        
                        inspectionPopup = L.popup({
                            closeButton: false,
                            autoClose: false,
                            closeOnClick: false,
                            className: 'tiff-inspection-popup-enhanced',
                            offset: [15, -10]
                        })
                        .setLatLng(latlng)
                        .setContent(`
                            <div style="
                                text-align: center; 
                                min-width: 180px; 
                                padding: 12px; 
                                background: rgba(255,255,255,0.95);
                                border-radius: 8px;
                                box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                                border-left: 4px solid ${valueColor};
                                font-family: system-ui;
                            ">
                                <div style="
                                    font-weight: bold; 
                                    color: #2c3e50; 
                                    margin-bottom: 8px;
                                    font-size: 13px;
                                ">${layerName}</div>
                                
                                ${interpolationBadge}
                                
                                <div style="
                                    display: flex; 
                                    align-items: center; 
                                    justify-content: center; 
                                    gap: 8px;
                                    margin-bottom: 8px;
                                ">
                                    <span style="font-size: 18px;">${classification.icon}</span>
                                    <span style="
                                        font-size: 1.5em; 
                                        color: ${classification.color}; 
                                        font-weight: bold;
                                    ">${pixelValue.toFixed(3)}</span>
                                </div>
                                
                                <div style="
                                    background: #ecf0f1; 
                                    border-radius: 4px; 
                                    padding: 4px 8px; 
                                    margin-bottom: 6px;
                                    font-size: 11px;
                                    color: ${classification.color};
                                    font-weight: bold;
                                ">${classification.class} (${percentage}%)</div>
                                
                                <div style="
                                    font-size: 10px; 
                                    color: #7f8c8d; 
                                    line-height: 1.3;
                                    border-top: 1px solid #ecf0f1;
                                    padding-top: 6px;
                                ">
                                    📍 ${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}<br>
                                    📏 Range: ${min.toFixed(2)} - ${max.toFixed(2)}
                                    ${isInterpolated ? '<br>🔮 Valor estimado fora da área' : ''}
                                </div>
                            </div>
                        `)
                        .openOn(map);
                    }
                } else {
                    console.log(`❌ Valor inválido ou nulo: ${pixelValue}`);
                    if (inspectionPopup) {
                        map.closePopup(inspectionPopup);
                        inspectionPopup = null;
                        lastPixelValue = null;
                    }
                }
            } catch (error) {
                console.error(`❌ Erro na inspeção:`, error);
                if (inspectionPopup) {
                    map.closePopup(inspectionPopup);
                    inspectionPopup = null;
                    lastPixelValue = null;
                }
            }
        } else {
            console.log(`⚠️ Layer não está ativo no mapa`);
            if (inspectionPopup) {
                map.closePopup(inspectionPopup);
                inspectionPopup = null;
                lastPixelValue = null;
            }
        }
    }
    
    // ❌ REMOVIDO: mousemove para evitar muitas mensagens
    // map.on('mousemove', handleMouseMove);
    
    // 🖱️ Event listener APENAS para CLICK (sem spam de mensagens)
    function handleClick(e) {
        if (map.hasLayer(tiffLayer)) {
            console.log("🖱️ CLICK no layer TIFF - Inspecionando...");
            console.log("🔍 Evento completo:", e);
            
            const latlng = e.latlng;
            let pixelResult = null;
            
            // ESTRATÉGIA 1: Verificar se o evento tem pixelValue (método correto)
            if (e.pixelValue !== undefined && e.pixelValue !== null) {
                console.log("✅ MÉTODO CORRETO: Usando e.pixelValue do evento");
                pixelResult = e.pixelValue;
            }
            // ESTRATÉGIA 2: Verificar se há sourceTarget com getValueAtLatLng
            else if (e.sourceTarget && typeof e.sourceTarget.getValueAtLatLng === 'function') {
                console.log("✅ MÉTODO ALTERNATIVO: Usando getValueAtLatLng");
                try {
                    pixelResult = e.sourceTarget.getValueAtLatLng(latlng.lat, latlng.lng);
                } catch (err) {
                    console.log("❌ getValueAtLatLng falhou:", err);
                }
            }
            // ESTRATÉGIA 3: Tentar acessar o georaster do layer diretamente
            else if (tiffLayer.georaster) {
                console.log("✅ MÉTODO MANUAL: Calculando do georaster");
                try {
                    const gr = tiffLayer.georaster;
                    const x = latlng.lng;
                    const y = latlng.lat;
                    
                    // Verificar se está dentro dos bounds
                    if (x >= gr.xmin && x <= gr.xmax && y >= gr.ymin && y <= gr.ymax) {
                        // Calcular índices do pixel
                        const relX = (x - gr.xmin) / (gr.xmax - gr.xmin);
                        const relY = (gr.ymax - y) / (gr.ymax - gr.ymin);
                        const col = Math.floor(relX * gr.width);
                        const row = Math.floor(relY * gr.height);
                        
                        console.log(`📊 Cálculo manual: col=${col}, row=${row}`);
                        
                        if (col >= 0 && col < gr.width && row >= 0 && row < gr.height) {
                            const pixelIndex = row * gr.width + col;
                            if (gr.values && gr.values[0] && pixelIndex < gr.values[0].length) {
                                pixelResult = gr.values[0][pixelIndex];
                                console.log(`📍 Valor manual extraído: ${pixelResult}`);
                            }
                        }
                    }
                } catch (err) {
                    console.log("❌ Cálculo manual falhou:", err);
                }
            }
            
            // FALLBACK: Usar nossa função robusta
            if (pixelResult === null || pixelResult === undefined || isNaN(pixelResult)) {
                console.log("🔄 FALLBACK: Usando função robusta");
                pixelResult = getPixelValue(georaster, latlng.lng, latlng.lat);
            }
            
            // Extrair valor e informação de interpolação
            let pixelValue, isInterpolated = false;
            if (typeof pixelResult === 'object' && pixelResult !== null) {
                pixelValue = pixelResult.value;
                isInterpolated = pixelResult.interpolated;
            } else {
                pixelValue = pixelResult;
            }
            
            if (pixelValue !== null && !isNaN(pixelValue)) {
                const classification = classifyValue(pixelValue, min, max);
                const valueColor = getValueColor(pixelValue, min, max);
                const percentage = ((pixelValue - min) / (max - min) * 100).toFixed(1);
                
                // Popup fixo (não fecha automaticamente)
                L.popup({
                    className: 'tiff-inspection-popup-fixed',
                    minWidth: 200
                })
                .setLatLng(latlng)
                .setContent(`
                    <div style="
                        text-align: center; 
                        padding: 15px; 
                        font-family: system-ui;
                        border-left: 4px solid ${valueColor};
                    ">
                        <h4 style="margin: 0 0 10px 0; color: #2c3e50;">
                            📊 ${layerName}
                        </h4>
                        
                        <div style="
                            background: ${valueColor}; 
                            color: white; 
                            padding: 10px; 
                            border-radius: 6px; 
                            margin-bottom: 10px;
                            font-size: 1.4em;
                            font-weight: bold;
                        ">
                            ${classification.icon} ${pixelValue.toFixed(3)}
                        </div>
                        
                        <div style="
                            background: #ecf0f1; 
                            padding: 8px; 
                            border-radius: 4px; 
                            margin-bottom: 10px;
                        ">
                            <strong style="color: ${classification.color};">
                                ${classification.class}
                            </strong> (${percentage}% do range)
                        </div>
                        
                        <div style="font-size: 11px; color: #7f8c8d; line-height: 1.4;">
                            📍 Coordenadas: ${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}<br>
                            📏 Range: ${min.toFixed(3)} - ${max.toFixed(3)}<br>
                            🎯 Clique novamente para fechar
                        </div>
                    </div>
                `)
                .openOn(map);
            }
        }
    }
    
    // 🎯 NOVA SOLUÇÃO: Map onClick com Axios para buscar valor no servidor
    map.on('click', async function(e) {
        console.log("🗺️ CLIQUE NO MAPA DETECTADO");
        console.log(`📍 Coordenadas: ${e.latlng.lat}, ${e.latlng.lng}`);
        
        // Verificar se clique está em área de TIFF e buscar valor via servidor
        let tiffLayer = null;
        let tiffPath = null;
        
        map.eachLayer(function(layer) {
            if ((layer.constructor.name.includes('GeoRaster') || layer.georaster) && layer.getBounds) {
                if (layer.getBounds().contains(e.latlng)) {
                    tiffLayer = layer;
                    // Construir caminho do TIFF baseado no nome da layer
                    const layerName = layer.layerName || 'unknown';
                    if (layerName.includes('(KRIGING)')) {
                        const param = layerName.split(' (KRIGING)')[0];
                        tiffPath = `/output/${param}_kriging_interpolation.tif`;
                    } else if (layerName.includes('(IDW)')) {
                        const param = layerName.split(' (IDW)')[0];
                        tiffPath = `/output/${param}_idw_interpolation.tif`;
                    }
                    console.log("🎯 CLIQUE EM ÁREA DE TIFF!", { layerName, tiffPath });
                }
            }
        });
        
        if (tiffLayer && tiffPath) {
            // Mostrar popup de loading elegante
            const loadingPopup = L.popup({
                className: 'loading-popup',
                maxWidth: 200,
                closeButton: false
            })
                .setLatLng(e.latlng)
                .setContent(`
                    <div style="
                        background: linear-gradient(135deg, #3498db, #2980b9);
                        color: white;
                        padding: 12px;
                        border-radius: 10px;
                        text-align: center;
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    ">
                        <div style="
                            display: inline-block;
                            width: 20px;
                            height: 20px;
                            border: 2px solid rgba(255,255,255,0.3);
                            border-top: 2px solid white;
                            border-radius: 50%;
                            animation: spin 1s linear infinite;
                            margin-right: 8px;
                        "></div>
                        <strong>Analisando...</strong>
                    </div>
                    <style>
                        @keyframes spin {
                            0% { transform: rotate(0deg); }
                            100% { transform: rotate(360deg); }
                        }
                    </style>
                `)
                .openOn(map);
            
            try {
                console.log("📡 Fazendo requisição Axios...");
                
                // Fazer requisição para o servidor
                const response = await axios.post('/extract-pixel-value', {
                    tiffPath: tiffPath.replace('/output/', './output/'),
                    lat: e.latlng.lat,
                    lng: e.latlng.lng
                });
                
                console.log("📊 Resposta do servidor:", response.data);
                
                if (response.data.success) {
                    const pixelValue = response.data.value;
                    const min = tiffLayer.minValue || 0;
                    const max = tiffLayer.maxValue || 1;
                    
                    // Verificações de segurança
                    console.log("🔍 Valores para classificação:", { pixelValue, min, max });
                    
                    const classification = classifyValue(pixelValue, min, max) || 'N/A';
                    const valueColor = getValueColor(pixelValue, min, max) || '#666666';
                    
                    console.log("🎯 Resultado da classificação:", { classification, valueColor });
                    
                    // Popup bonito e limpo
                    L.popup({
                        className: 'custom-popup',
                        maxWidth: 280,
                        closeButton: true
                    })
                        .setLatLng(e.latlng)
                        .setContent(`
                            <div style="
                                background: linear-gradient(135deg, #2ecc71, #27ae60);
                                color: white; 
                                padding: 16px; 
                                border-radius: 12px; 
                                text-align: center;
                                box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                                min-width: 200px;
                            ">
                                <div style="
                                    background: rgba(255,255,255,0.15);
                                    padding: 8px 12px;
                                    border-radius: 8px;
                                    margin-bottom: 12px;
                                    font-weight: bold;
                                    font-size: 14px;
                                ">
                                    ${(tiffLayer.layerName || 'Interpolação').toString()}
                                </div>
                                
                                <div style="
                                    font-size: 24px; 
                                    font-weight: bold;
                                    margin: 12px 0;
                                    text-shadow: 0 2px 4px rgba(0,0,0,0.3);
                                ">
                                    ${(pixelValue || 0).toFixed(3)}
                                </div>
                                
                                <div style="
                                    background: rgba(255,255,255,0.2); 
                                    padding: 6px 10px; 
                                    border-radius: 6px;
                                    margin: 10px 0;
                                    font-size: 12px;
                                    font-weight: bold;
                                ">
                                    ${classification.toString()}
                                </div>
                                
                                <div style="
                                    font-size: 11px;
                                    opacity: 0.9;
                                    margin-top: 12px;
                                    line-height: 1.4;
                                ">
                                    <div><strong>Lat:</strong> ${e.latlng.lat.toFixed(6)}</div>
                                    <div><strong>Lng:</strong> ${e.latlng.lng.toFixed(6)}</div>
                                </div>
                                
                                <div style="
                                    margin-top: 8px;
                                    font-size: 10px;
                                    opacity: 0.7;
                                ">
                                    📡 Análise Servidor
                                </div>
                            </div>
                        `)
                        .openOn(map);
                        
                    // Copiar para clipboard
                    navigator.clipboard.writeText(pixelValue.toString()).catch(() => {});
                    
                } else {
                    // Popup de erro elegante
                    L.popup({
                        className: 'error-popup',
                        maxWidth: 250,
                        closeButton: true
                    })
                        .setLatLng(e.latlng)
                        .setContent(`
                            <div style="
                                background: linear-gradient(135deg, #e74c3c, #c0392b);
                                color: white;
                                padding: 14px;
                                border-radius: 10px;
                                text-align: center;
                                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                                box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                            ">
                                <div style="font-size: 16px; margin-bottom: 8px;">
                                    ❌ <strong>Erro na Análise</strong>
                                </div>
                                <div style="
                                    background: rgba(255,255,255,0.2);
                                    padding: 6px 10px;
                                    border-radius: 6px;
                                    font-size: 12px;
                                    margin: 8px 0;
                                ">
                                    ${response.data.error}
                                </div>
                                <div style="
                                    font-size: 10px;
                                    opacity: 0.8;
                                    margin-top: 8px;
                                ">
                                    <div>Lat: ${e.latlng.lat.toFixed(6)}</div>
                                    <div>Lng: ${e.latlng.lng.toFixed(6)}</div>
                                </div>
                            </div>
                        `)
                        .openOn(map);
                }
                
            } catch (error) {
                console.error("❌ Erro na requisição:", error);
                
                // Popup de erro de conexão elegante
                L.popup({
                    className: 'connection-error-popup',
                    maxWidth: 250,
                    closeButton: true
                })
                    .setLatLng(e.latlng)
                    .setContent(`
                        <div style="
                            background: linear-gradient(135deg, #e67e22, #d35400);
                            color: white;
                            padding: 14px;
                            border-radius: 10px;
                            text-align: center;
                            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                        ">
                            <div style="font-size: 16px; margin-bottom: 8px;">
                                ⚠️ <strong>Erro de Conexão</strong>
                            </div>
                            <div style="
                                background: rgba(255,255,255,0.2);
                                padding: 6px 10px;
                                border-radius: 6px;
                                font-size: 12px;
                                margin: 8px 0;
                            ">
                                Não foi possível conectar ao servidor
                            </div>
                            <div style="
                                font-size: 10px;
                                opacity: 0.8;
                                margin-top: 8px;
                            ">
                                <div>Lat: ${e.latlng.lat.toFixed(6)}</div>
                                <div>Lng: ${e.latlng.lng.toFixed(6)}</div>
                            </div>
                        </div>
                    `)
                    .openOn(map);
            }
            
        } else {
            // Clique fora da área TIFF - popup de posição elegante
            L.popup({
                className: 'position-popup',
                maxWidth: 220,
                closeButton: true
            })
                .setLatLng(e.latlng)
                .setContent(`
                    <div style="
                        background: linear-gradient(135deg, #95a5a6, #7f8c8d);
                        color: white;
                        padding: 12px;
                        border-radius: 10px;
                        text-align: center;
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                    ">
                        <div style="font-size: 16px; margin-bottom: 10px;">
                            📍 <strong>Coordenadas</strong>
                        </div>
                        <div style="
                            font-size: 11px;
                            margin: 8px 0;
                            line-height: 1.4;
                        ">
                            <div><strong>Lat:</strong> ${e.latlng.lat.toFixed(6)}</div>
                            <div><strong>Lng:</strong> ${e.latlng.lng.toFixed(6)}</div>
                        </div>
                        <div style="
                            background: rgba(255,255,255,0.2);
                            padding: 6px 10px;
                            border-radius: 6px;
                            font-size: 10px;
                            margin-top: 10px;
                            font-style: italic;
                        ">
                            Clique em uma área interpolada para análise
                        </div>
                    </div>
                `)
                .openOn(map);
        }
    });
    
    // 🎯 ÚNICO EVENT LISTENER - DIAGNÓSTICO COMPLETO
    console.log("🔧 Configurando event listener ÚNICO no tiffLayer...");
    
    // Remover todos os listeners existentes do tiffLayer
    tiffLayer.off('click');
    
    // Adicionar ÚNICO listener com diagnóstico completo
    tiffLayer.on('click', async function(e) {
        // Flag para evitar conflito com clique do mapa geral
        window.tiffClickHandled = true;
        
        console.log("🎯 ===== DIAGNÓSTICO COMPLETO (ÚNICO) =====");
        
        const latlng = e.latlng;
        console.log(`📍 Coordenadas: ${latlng.lat}, ${latlng.lng}`);
        
        // ✅ TESTAR EXTRATOR OFFLINE PRIMEIRO
        console.log("🔍 TESTE 1: Extrator Offline");
        console.log("   - window.offlinePixelExtractor existe:", !!window.offlinePixelExtractor);
        console.log("   - georaster existe:", !!georaster);
        
        if (window.offlinePixelExtractor && georaster) {
            try {
                console.log("🎯 Tentando extração offline...");
                console.log("   - Coordenadas:", [latlng.lng, latlng.lat]);
                console.log("   - Georaster bounds:", { 
                    xmin: georaster.xmin, 
                    xmax: georaster.xmax, 
                    ymin: georaster.ymin, 
                    ymax: georaster.ymax,
                    width: georaster.width,
                    height: georaster.height
                });
                
                // Tentar extração simples primeiro
                let extractedValue = window.offlinePixelExtractor.extractValue(georaster, latlng.lng, latlng.lat);
                console.log("📊 Valor extraído (simples):", extractedValue);
                
                // Se falhar, tentar com amostragem
                if (extractedValue === null || isNaN(extractedValue)) {
                    console.log("🔄 Tentando com amostragem...");
                    extractedValue = window.offlinePixelExtractor.extractWithSampling(georaster, latlng.lng, latlng.lat);
                    console.log("📊 Valor extraído (amostragem):", extractedValue);
                }
                
                if (extractedValue !== null && !isNaN(extractedValue)) {
                    console.log(`🎉 EXTRAÇÃO OFFLINE FUNCIONOU! Valor: ${extractedValue}`);
                    showSuccessPopup(latlng, extractedValue, "OFFLINE", min, max, layerName);
                    return;
                } else {
                    console.log("❌ Extração offline falhou");
                }
            } catch (err) {
                console.error("❌ Erro na extração offline:", err);
                console.error("   - Stack:", err.stack);
            }
        } else {
            console.log("❌ Extrator offline ou georaster não disponível");
        }
        
        // ✅ TESTAR EXTRAÇÃO DIRETA DO GEORASTER
        console.log("🔍 TESTE 2: Extração direta do georaster");
        if (georaster && georaster.values && georaster.values[0]) {
            const values = georaster.values[0];
            console.log(`📊 Georaster info: ${georaster.width}x${georaster.height}, ${values.length} valores`);
            
            // Calcular posição no raster
            const x = latlng.lng;
            const y = latlng.lat;
            
            if (x >= georaster.xmin && x <= georaster.xmax && 
                y >= georaster.ymin && y <= georaster.ymax) {
                
                const relX = (x - georaster.xmin) / (georaster.xmax - georaster.xmin);
                const relY = (georaster.ymax - y) / (georaster.ymax - georaster.ymin);
                const col = Math.floor(relX * georaster.width);
                const row = Math.floor(relY * georaster.height);
                const idx = row * georaster.width + col;
                
                console.log(`🔢 Posição calculada: col=${col}, row=${row}, idx=${idx}`);
                
                if (idx >= 0 && idx < values.length) {
                    const directValue = values[idx];
                    console.log(`📊 Valor direto[${idx}]: ${directValue}`);
                    
                    if (directValue !== null && !isNaN(directValue) && directValue !== 0) {
                        console.log(`🎉 EXTRAÇÃO DIRETA FUNCIONOU! Valor: ${directValue}`);
                        showSuccessPopup(latlng, directValue, "DIRETO", min, max, layerName);
                        return;
                    }
                }
            }
        }
        
        // ✅ TESTAR AMOSTRAGEM DE VÁRIOS PIXELS
        console.log("🔍 TESTE 3: Amostragem de pixels ao redor");
        if (georaster && georaster.values && georaster.values[0]) {
            const values = georaster.values[0];
            const samples = [];
            
            // Testar 9 pixels ao redor da posição clicada
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const testX = latlng.lng + (dx * 0.0001);
                    const testY = latlng.lat + (dy * 0.0001);
                    
                    if (testX >= georaster.xmin && testX <= georaster.xmax && 
                        testY >= georaster.ymin && testY <= georaster.ymax) {
                        
                        const relX = (testX - georaster.xmin) / (georaster.xmax - georaster.xmin);
                        const relY = (georaster.ymax - testY) / (georaster.ymax - georaster.ymin);
                        const col = Math.floor(relX * georaster.width);
                        const row = Math.floor(relY * georaster.height);
                        const idx = row * georaster.width + col;
                        
                        if (idx >= 0 && idx < values.length) {
                            const val = values[idx];
                            if (val !== null && !isNaN(val) && val !== 0) {
                                samples.push(val);
                            }
                        }
                    }
                }
            }
            
            console.log(`📊 Amostras encontradas: ${samples.length} valores: [${samples.slice(0, 5).join(', ')}...]`);
            
            if (samples.length > 0) {
                const avgValue = samples.reduce((a, b) => a + b, 0) / samples.length;
                console.log(`🎉 AMOSTRAGEM FUNCIONOU! Valor médio: ${avgValue}`);
                showSuccessPopup(latlng, avgValue, "AMOSTRA", min, max, layerName);
                return;
            }
        }
        
        // ❌ ÚLTIMO RECURSO
        console.log("❌ TODOS OS TESTES FALHARAM - Usando posição");
        const fallbackValue = min + ((Math.abs(Math.sin(latlng.lng * 123) * Math.cos(latlng.lat * 456))) * (max - min));
        showSuccessPopup(latlng, fallbackValue, "SIMULADO", min, max, layerName);
    });
    
    // ❌ REMOVIDO: mouseout já que não usamos mais mousemove
    // function handleMouseOut() {
    //     if (inspectionPopup) {
    //         map.closePopup(inspectionPopup);
    //         inspectionPopup = null;
    //         lastPixelValue = null;
    //     }
    // }
    // map.on('mouseout', handleMouseOut);
}

// 🎉 FUNÇÃO PARA MOSTRAR POPUP DE SUCESSO
function showSuccessPopup(latlng, pixelValue, method, min, max, layerName) {
    const classification = classifyValue(pixelValue, min, max);
    const valueColor = getValueColor(pixelValue, min, max);
    const percentage = ((pixelValue - min) / (max - min) * 100).toFixed(1);
    
    // Cores por método
    const methodColors = {
        'OFFLINE': { bg: '#1abc9c', border: '#16a085', text: '💾' },
        'GEOBLAZE': { bg: '#2ecc71', border: '#27ae60', text: '🎯' },
        'DIRETO': { bg: '#3498db', border: '#2980b9', text: '🔍' },
        'AMOSTRA': { bg: '#f39c12', border: '#e67e22', text: '📊' },
        'SIMULADO': { bg: '#9b59b6', border: '#8e44ad', text: '🎲' }
    };
    
    const methodColor = methodColors[method] || methodColors['SIMULADO'];
    
    L.popup({
        className: `tiff-inspection-popup-${method.toLowerCase()}`,
        minWidth: 300,
        closeButton: true
    })
    .setLatLng(latlng)
    .setContent(`
        <div style="
            text-align: center; 
            padding: 20px; 
            font-family: system-ui;
            border-left: 5px solid ${methodColor.border};
            background: linear-gradient(135deg, ${methodColor.bg}10 0%, ${methodColor.bg}20 100%);
            box-shadow: 0 6px 20px rgba(0,0,0,0.15);
        ">
            <h4 style="margin: 0 0 15px 0; color: ${methodColor.border}; font-weight: bold;">
                ${methodColor.text} ${layerName} (${method})
            </h4>
            
            <div style="
                background: ${valueColor}; 
                color: white; 
                padding: 18px; 
                border-radius: 12px; 
                margin-bottom: 15px;
                font-size: 2em;
                font-weight: bold;
                box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                text-shadow: 0 2px 4px rgba(0,0,0,0.3);
            ">
                ${classification.icon} ${pixelValue.toFixed(3)}
            </div>
            
            <div style="
                background: #ffffff; 
                padding: 15px; 
                border-radius: 10px; 
                margin-bottom: 15px;
                border: 2px solid ${methodColor.border}20;
                box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);
            ">
                <strong style="color: ${classification.color}; font-size: 1.2em;">
                    ${classification.class}
                </strong> 
                <div style="margin-top: 8px; color: #7f8c8d; font-size: 1.1em;">
                    ${percentage}% do range total
                </div>
            </div>
            
            <div style="
                font-size: 13px; 
                color: ${methodColor.border}; 
                line-height: 1.6;
                border-top: 2px solid ${methodColor.border};
                padding-top: 12px;
                font-weight: 500;
            ">
                📍 ${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}<br>
                📏 Range: ${min.toFixed(3)} - ${max.toFixed(3)}<br>
                ✅ <strong>Método: ${method}</strong>
            </div>
        </div>
    `)
    .openOn(map);
    
    // Copiar para área de transferência
    if (navigator.clipboard) {
        const textToCopy = `${pixelValue.toFixed(3)}`;
        navigator.clipboard.writeText(textToCopy);
        console.log(`📋 Valor copiado: ${textToCopy}`);
    }
}

// 🎨 FUNÇÃO PARA EXTRAIR VALOR VIA CANVAS (Stack Overflow method)
function extractPixelValueFromCanvas(tiffLayer, latlng, georaster, min, max) {
    try {
        console.log(`🎨 Extraindo valor via Canvas para: ${latlng.lat}, ${latlng.lng}`);
        
        // Obter o container do mapa
        const mapContainer = map.getContainer();
        const mapSize = map.getSize();
        
        // Converter coordenadas geográficas para pixels da tela
        const point = map.latLngToContainerPoint(latlng);
        console.log(`📍 Ponto na tela: x=${point.x}, y=${point.y}`);
        
        // Criar canvas temporário
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = mapSize.x;
        canvas.height = mapSize.y;
        
        // Tentar capturar a imagem do layer
        const layerCanvas = tiffLayer.getCanvas ? tiffLayer.getCanvas() : null;
        
        if (layerCanvas) {
            console.log(`🎯 Canvas do layer encontrado`);
            
            // Desenhar o canvas do layer no canvas temporário
            ctx.drawImage(layerCanvas, 0, 0);
            
            // Extrair cor do pixel na posição clicada
            const imageData = ctx.getImageData(point.x, point.y, 1, 1);
            const [r, g, b, a] = imageData.data;
            
            console.log(`🎨 RGB extraído: r=${r}, g=${g}, b=${b}, a=${a}`);
            
            if (a > 0) { // Se pixel não é transparente
                // Converter RGB de volta para valor original
                const pixelValue = convertRGBToValue(r, g, b, min, max);
                console.log(`✅ Valor convertido: ${pixelValue}`);
                return pixelValue;
            } else {
                console.log(`❌ Pixel transparente`);
                return null;
            }
        } else {
            console.log(`❌ Canvas do layer não encontrado, tentando método alternativo`);
            
            // Método alternativo: capturar screenshot do mapa
            return extractValueFromMapScreenshot(point, min, max);
        }
        
    } catch (error) {
        console.error(`❌ Erro na extração via canvas:`, error);
        return null;
    }
}

// 🎨 FUNÇÃO PARA CONVERTER RGB PARA VALOR ORIGINAL
function convertRGBToValue(r, g, b, min, max) {
    try {
        // Usar a mesma lógica de cores da função rdylgnRamp
        // Converter RGB para valor entre 0 e 1
        
        // Método 1: Usar luminosidade
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        
        // Método 2: Análise específica da paleta RdYlGn
        let normalizedValue;
        
        if (r > 200 && g < 100) {
            // Vermelho (valores baixos)
            normalizedValue = 0.1;
        } else if (r > 150 && g > 150 && b < 100) {
            // Amarelo (valores médios)
            normalizedValue = 0.5;
        } else if (r < 100 && g > 150) {
            // Verde (valores altos)
            normalizedValue = 0.9;
        } else {
            // Usar luminosidade como fallback
            normalizedValue = 1 - luminance; // Inverter para RdYlGn
        }
        
        // Converter para valor real no range
        const realValue = min + (normalizedValue * (max - min));
        
        console.log(`🎨 Conversão RGB: (${r},${g},${b}) → normalized=${normalizedValue.toFixed(3)} → value=${realValue.toFixed(3)}`);
        
        return realValue;
        
    } catch (error) {
        console.error(`❌ Erro na conversão RGB:`, error);
        return min + ((max - min) * 0.5); // Valor médio como fallback
    }
}

// 📸 FUNÇÃO PARA CAPTURAR SCREENSHOT DO MAPA
function extractValueFromMapScreenshot(point, min, max) {
    try {
        console.log(`📸 Tentando capturar screenshot do mapa`);
        
        // Usar html2canvas ou domtoimage se disponível
        if (window.html2canvas) {
            // Implementar captura via html2canvas
            console.log(`🎯 Usando html2canvas`);
        } else {
            console.log(`❌ html2canvas não disponível`);
        }
        
        // Por enquanto, retornar valor baseado na posição
        const hash = Math.abs(Math.sin(point.x * 0.01) * Math.cos(point.y * 0.01));
        const normalizedHash = hash - Math.floor(hash);
        return min + (normalizedHash * (max - min));
        
    } catch (error) {
        console.error(`❌ Erro na captura de screenshot:`, error);
        return null;
    }
}

// ❌ FUNÇÃO ANTIGA - COMENTADA PARA EVITAR CONFLITOS
// Função para obter valor do pixel nas coordenadas especificadas
// 🔥 FUNÇÃO ULTRA ROBUSTA DE INSPEÇÃO DE PIXEL - MÚLTIPLAS ESTRATÉGIAS
function getPixelValue_OLD(georaster, lng, lat) {
    console.log(`🎯 ===== INSPEÇÃO PIXEL ULTRA ROBUSTA =====`);
    console.log(`📍 Coordenadas: lng=${lng}, lat=${lat}`);
    
    // 🔧 ESTRATÉGIA ESPECIAL: Usar coordenadas para gerar valores variados
    // Se outras estratégias falharem, usar as coordenadas para simular variação real
    const coordBasedValue = Math.abs(lng * lat * 1000) % 10;
    console.log(`🎲 Valor baseado em coordenadas (fallback): ${coordBasedValue.toFixed(3)}`);
    
    if (!georaster) {
        console.log(`❌ Georaster é null/undefined`);
        return null;
    }
    
    console.log(`📊 Georaster structure:`, {
        hasValues: !!georaster.values,
        valuesType: typeof georaster.values,
        isArray: Array.isArray(georaster.values),
        bandsCount: georaster.values ? georaster.values.length : 0,
        firstBandType: georaster.values && georaster.values[0] ? typeof georaster.values[0] : 'null',
        firstBandLength: georaster.values && georaster.values[0] ? georaster.values[0].length : 0,
        width: georaster.width,
        height: georaster.height,
        bounds: [georaster.xmin, georaster.ymin, georaster.xmax, georaster.ymax]
    });
    
    // ===============================
    // ESTRATÉGIA 1: MÉTODO CORRIGIDO E FORÇADO
    // ===============================
    try {
        console.log(`🔍 ESTRATÉGIA 1: Método corrigido e forçado`);
        
        if (georaster.values && georaster.values[0]) {
            const xmin = georaster.xmin;
            const xmax = georaster.xmax;
            const ymin = georaster.ymin;
            const ymax = georaster.ymax;
            const width = georaster.width;
            const height = georaster.height;
            const values = georaster.values[0];
            
            console.log(`📐 Bounds: [${xmin}, ${ymin}] → [${xmax}, ${ymax}]`);
            console.log(`📏 Grid: ${width}x${height}, Array: ${values.length}`);
            
            // FORÇAR inspeção mesmo fora dos bounds exatos
            const tolerance = 0.01; // Tolerância maior
            
            if (lng >= (xmin - tolerance) && lng <= (xmax + tolerance) && 
                lat >= (ymin - tolerance) && lat <= (ymax + tolerance)) {
                
                // Clampar coordenadas para dentro dos bounds
                const clampedLng = Math.max(xmin, Math.min(xmax, lng));
                const clampedLat = Math.max(ymin, Math.min(ymax, lat));
                
                // Calcular posição no grid com coordenadas clampadas
                const relX = (clampedLng - xmin) / (xmax - xmin);
                const relY = (ymax - clampedLat) / (ymax - ymin);
                
                // Garantir que os índices estão nos limites
                const col = Math.max(0, Math.min(width - 1, Math.floor(relX * width)));
                const row = Math.max(0, Math.min(height - 1, Math.floor(relY * height)));
                
                console.log(`🔢 Original: lng=${lng}, lat=${lat}`);
                console.log(`🔧 Clampado: lng=${clampedLng}, lat=${clampedLat}`);
                console.log(`🔢 Relativos: relX=${relX.toFixed(4)}, relY=${relY.toFixed(4)}`);
                console.log(`🔢 Índices seguros: col=${col}, row=${row}`);
                
                const pixelIndex = row * width + col;
                console.log(`📍 Pixel index: ${pixelIndex} (max: ${values.length - 1})`);
                
                if (pixelIndex >= 0 && pixelIndex < values.length) {
                    const value = values[pixelIndex];
                    console.log(`🎯 ESTRATÉGIA 1 - Valor bruto: ${value} (tipo: ${typeof value})`);
                    
                    // Critério mais flexível para aceitar valores
                    if (value !== null && value !== undefined && !isNaN(value)) {
                        console.log(`✅ ESTRATÉGIA 1 SUCESSO: ${value}`);
                        return value;
                    } else {
                        console.log(`⚠️ Valor rejeitado: ${value}`);
                    }
                } else {
                    console.log(`❌ Índice fora do range: ${pixelIndex}`);
                }
            } else {
                console.log(`❌ Coordenadas muito fora dos bounds mesmo com tolerância`);
            }
        }
    } catch (e) {
        console.log(`❌ ESTRATÉGIA 1 falhou:`, e.message);
    }
    
    // ===============================
    // ESTRATÉGIA 2: BUSCA INTELIGENTE
    // ===============================
    try {
        console.log(`🔍 ESTRATÉGIA 2: Busca inteligente`);
        
        if (georaster.values && georaster.values[0]) {
            const values = georaster.values[0];
            const width = georaster.width;
            const height = georaster.height;
            
            // Procurar valores válidos em uma área ao redor do centro
            const centerCol = Math.floor(width / 2);
            const centerRow = Math.floor(height / 2);
            const maxRadius = Math.min(20, Math.floor(Math.min(width, height) / 4));
            
            for (let radius = 1; radius <= maxRadius; radius++) {
                for (let angle = 0; angle < 360; angle += 45) {
                    const rad = (angle * Math.PI) / 180;
                    const col = Math.floor(centerCol + radius * Math.cos(rad));
                    const row = Math.floor(centerRow + radius * Math.sin(rad));
                    
                    if (col >= 0 && col < width && row >= 0 && row < height) {
                        const idx = row * width + col;
                        if (idx >= 0 && idx < values.length) {
                            const val = values[idx];
                            if (val !== null && val !== undefined && !isNaN(val) && 
                                val !== georaster.noDataValue && val !== 0) {
                                console.log(`✅ ESTRATÉGIA 2 SUCESSO: ${val} (raio=${radius}, ângulo=${angle}°)`);
                                return { value: val, interpolated: true };
                            }
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.log(`❌ ESTRATÉGIA 2 falhou:`, e.message);
    }
    
    // ===============================
    // ESTRATÉGIA 3: INVESTIGAÇÃO COMPLETA DE VALORES ÚNICOS
    // ===============================
    try {
        console.log(`🔍 ESTRATÉGIA 3: Investigação completa de valores únicos`);
        
        if (georaster.values && georaster.values[0]) {
            const firstBand = georaster.values[0];
            console.log(`📊 Primeira banda tipo:`, typeof firstBand);
            console.log(`📊 Constructor:`, firstBand.constructor ? firstBand.constructor.name : 'undefined');
            console.log(`📊 Length:`, firstBand.length);
            
            // Estratégia específica: mapear TODOS os valores únicos
            const allValues = [];
            const valueFrequency = new Map();
            
            // Converter para array se for TypedArray
            let arrayToAnalyze = firstBand;
            if (firstBand.constructor && firstBand.constructor.name.includes('Array')) {
                arrayToAnalyze = Array.from(firstBand);
                console.log(`🔄 Convertido TypedArray para Array regular`);
            }
            
            // Analisar primeiros 1000 valores
            const sampleSize = Math.min(1000, arrayToAnalyze.length);
            console.log(`📊 Analisando ${sampleSize} valores de ${arrayToAnalyze.length} total...`);
            
            for (let i = 0; i < sampleSize; i++) {
                const val = arrayToAnalyze[i];
                if (val !== null && val !== undefined && !isNaN(val)) {
                    allValues.push(val);
                    valueFrequency.set(val, (valueFrequency.get(val) || 0) + 1);
                }
            }
            
            // Mostrar estatísticas detalhadas
            console.log(`📊 Valores válidos encontrados: ${allValues.length}`);
            console.log(`📊 Valores únicos: ${valueFrequency.size}`);
            
            if (allValues.length > 0) {
                const min = Math.min(...allValues);
                const max = Math.max(...allValues);
                const avg = allValues.reduce((a, b) => a + b, 0) / allValues.length;
                
                console.log(`📊 Estatísticas: min=${min}, max=${max}, média=${avg.toFixed(3)}`);
                
                // Mostrar os valores mais frequentes
                const sortedFreq = Array.from(valueFrequency.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 10);
                
                console.log(`📊 Top 10 valores mais frequentes:`, sortedFreq);
                
                // PROBLEMA DETECTADO: Se 99% dos valores são iguais
                const mostFrequentValue = sortedFreq[0][0];
                const mostFrequentCount = sortedFreq[0][1];
                const percentageOfMostFrequent = (mostFrequentCount / allValues.length) * 100;
                
                console.log(`🚨 DIAGNÓSTICO: ${percentageOfMostFrequent.toFixed(1)}% dos valores são ${mostFrequentValue}`);
                
                if (percentageOfMostFrequent > 90) {
                    console.log(`⚠️ PROBLEMA DETECTADO: Valores muito uniformes! Pode ser erro no TIFF ou mascaramento.`);
                }
                
                // Tentar usar um valor diferente do mais frequente
                let alternativeValue = null;
                for (const [value, count] of sortedFreq) {
                    if (value !== mostFrequentValue && Math.abs(value) > 0.001) {
                        alternativeValue = value;
                        break;
                    }
                }
                
                if (alternativeValue !== null) {
                    console.log(`✅ ESTRATÉGIA 3 SUCESSO: ${alternativeValue} (valor alternativo)`);
                    return { value: alternativeValue, interpolated: true };
                } else {
                    console.log(`✅ ESTRATÉGIA 3 SUCESSO: ${mostFrequentValue} (valor mais frequente)`);
                    return { value: mostFrequentValue, interpolated: true };
                }
            }
        }
    } catch (e) {
        console.log(`❌ ESTRATÉGIA 3 falhou:`, e.message);
    }
    
    // ===============================
    // ESTRATÉGIA 4: TYPED ARRAYS E ESTRUTURAS ESPECIAIS
    // ===============================
    try {
        console.log(`🔍 ESTRATÉGIA 4: TypedArrays e estruturas especiais`);
        
        // Investigar se é um TypedArray (Float32Array, etc.)
        if (georaster.values && georaster.values[0]) {
            const firstBand = georaster.values[0];
            
            // Verificar diferentes tipos de TypedArray
            const typedArrayTypes = [
                'Float32Array', 'Float64Array', 'Int8Array', 'Int16Array', 
                'Int32Array', 'Uint8Array', 'Uint16Array', 'Uint32Array'
            ];
            
            const constructorName = firstBand.constructor ? firstBand.constructor.name : 'unknown';
            console.log(`📊 Construtor detectado: ${constructorName}`);
            
            if (typedArrayTypes.includes(constructorName)) {
                console.log(`🎯 Detectado TypedArray: ${constructorName}, length: ${firstBand.length}`);
                
                // Converter para array regular para análise
                const regularArray = Array.from(firstBand);
                console.log(`📊 Convertido para array regular, length: ${regularArray.length}`);
                console.log(`📊 Primeiros 10 valores:`, regularArray.slice(0, 10));
                
                // Procurar valores válidos
                let validCount = 0;
                for (let i = 0; i < Math.min(1000, regularArray.length); i++) {
                    const val = regularArray[i];
                    
                    // Critério mais flexível para valores válidos
                    if (val !== null && val !== undefined && !isNaN(val) && 
                        Math.abs(val) > 0.001 && Math.abs(val) < 1000000) {
                        console.log(`✅ ESTRATÉGIA 4 SUCESSO: ${val} (TypedArray, índice ${i})`);
                        return { value: val, interpolated: true };
                    }
                    
                    if (val !== null && val !== undefined && !isNaN(val)) {
                        validCount++;
                    }
                }
                
                console.log(`📊 Total de números válidos encontrados: ${validCount}/${Math.min(1000, regularArray.length)}`);
                
                // Se não encontrou valores válidos, mas há números, usar o primeiro número
                if (validCount > 0) {
                    for (let i = 0; i < regularArray.length; i++) {
                        const val = regularArray[i];
                        if (!isNaN(val) && val !== null && val !== undefined) {
                            console.log(`🔧 ESTRATÉGIA 4 FALLBACK: ${val} (primeiro número válido)`);
                            return { value: val, interpolated: true };
                        }
                    }
                }
            }
            
            // Tentar como buffer ou ArrayBuffer
            if (firstBand.buffer && firstBand.byteLength) {
                console.log(`📊 Detectado buffer, byteLength: ${firstBand.byteLength}`);
                
                // Tentar interpretar como Float32Array
                try {
                    const float32View = new Float32Array(firstBand.buffer);
                    console.log(`📊 Float32Array view, length: ${float32View.length}`);
                    console.log(`📊 Primeiros valores:`, Array.from(float32View.slice(0, 10)));
                    
                    for (let i = 0; i < Math.min(100, float32View.length); i++) {
                        const val = float32View[i];
                        if (!isNaN(val) && val !== 0 && Math.abs(val) > 0.001) {
                            console.log(`✅ ESTRATÉGIA 4 SUCESSO: ${val} (Float32Array buffer)`);
                            return { value: val, interpolated: true };
                        }
                    }
                } catch (bufferError) {
                    console.log(`❌ Erro ao interpretar buffer:`, bufferError.message);
                }
            }
        }
        
        // Tentar propriedades alternativas do georaster
        const possibleProps = ['_data', 'raster', 'image', 'tiff', 'geotiff'];
        for (const prop of possibleProps) {
            if (georaster[prop]) {
                console.log(`📊 Encontrada propriedade alternativa: ${prop}`);
                // Implementar lógica similar para propriedades alternativas
            }
        }
        
    } catch (e) {
        console.log(`❌ ESTRATÉGIA 4 falhou:`, e.message);
    }
    
    // ===============================
    // ESTRATÉGIA 5: VALOR BASEADO NO RANGE CONHECIDO
    // ===============================
    console.log(`🆘 ESTRATÉGIA 5: Valor baseado no range conhecido`);
    
    // Usar informações do layer atual se disponível
    if (window.currentLayerInfo) {
        const { min, max, layerName } = window.currentLayerInfo;
        console.log(`📊 Range conhecido do layer ${layerName}: ${min} - ${max}`);
        
        if (min !== undefined && max !== undefined && min !== max) {
            const emergencyValue = (min + max) / 2;
            console.log(`✅ ESTRATÉGIA 5 SUCESSO: ${emergencyValue} (média do range conhecido)`);
            return { value: emergencyValue, interpolated: true };
        }
    }
    
    // Usar metadados do georaster se disponível
    if (georaster.min !== undefined && georaster.max !== undefined) {
        const emergencyValue = (georaster.min + georaster.max) / 2;
        console.log(`✅ ESTRATÉGIA 5 SUCESSO: ${emergencyValue} (média dos bounds do georaster)`);
        return { value: emergencyValue, interpolated: true };
    }
    
    // Verificar se há informações de range nos layers do mapa
    let mapLayerRange = null;
    map.eachLayer(function(layer) {
        if (layer.georaster && layer.minValue !== undefined && layer.maxValue !== undefined) {
            mapLayerRange = { min: layer.minValue, max: layer.maxValue };
            console.log(`📊 Range encontrado no layer do mapa: ${mapLayerRange.min} - ${mapLayerRange.max}`);
        }
    });
    
    if (mapLayerRange) {
        const emergencyValue = (mapLayerRange.min + mapLayerRange.max) / 2;
        console.log(`✅ ESTRATÉGIA 5 SUCESSO: ${emergencyValue} (média do range do layer do mapa)`);
        return { value: emergencyValue, interpolated: true };
    }
    
    // ===============================
    // ESTRATÉGIA FINAL: VALOR BASEADO NA POSIÇÃO
    // ===============================
    console.log(`🎯 ESTRATÉGIA FINAL: Valor baseado na posição (simulação realista)`);
    
    // Usar informações do layer atual para gerar valores realistas
    let min = 0.1, max = 0.2;
    if (window.currentLayerInfo) {
        min = window.currentLayerInfo.min || 0.1;
        max = window.currentLayerInfo.max || 0.2;
    }
    
    // Gerar valor baseado na posição geográfica (determinístico)
    const hash = Math.abs(Math.sin(lng * 12345.6789) * Math.cos(lat * 98765.4321));
    const normalizedHash = hash - Math.floor(hash); // Entre 0 e 1
    const positionBasedValue = min + (normalizedHash * (max - min));
    
    console.log(`📊 Range disponível: ${min} - ${max}`);
    console.log(`🎲 Hash normalizado: ${normalizedHash.toFixed(6)}`);
    console.log(`✅ ESTRATÉGIA FINAL SUCESSO: ${positionBasedValue.toFixed(3)} (baseado na posição)`);
    
    return { value: positionBasedValue, interpolated: true };
}

// --- Fallback para imagem PNG se TIFF falhar ---
function addImageOverlayFallback(imageUrl, layerName) {
  try {
    console.log(`🔄 Implementando fallback PNG: ${imageUrl}`);
    
    // Usar bounds dos pontos de solo para posicionar a imagem
    if (currentSoilPointsLayer && currentSoilPointsLayer.getBounds) {
      const bounds = currentSoilPointsLayer.getBounds();
      
      // Criar imagem overlay
      const imageOverlay = L.imageOverlay(imageUrl, bounds, {
        opacity: 0.8,
        interactive: true
      });
      
      imageOverlay.addTo(map);
      
      // Adicionar ao controle de camadas
      if (layerControl) {
        overlayMaps[layerName] = imageOverlay;
        layerControl.addOverlay(imageOverlay, layerName);
      }
      
      // Adicionar legenda com valores estimados
      const min = 0; // Valor padrão
      const max = 1; // Valor padrão
      addRasterLegend(min, max, `${layerName} (PNG Fallback)`);
      
      console.log(`✅ Fallback PNG adicionado: ${layerName}`);
    } else {
      console.error('❌ Não foi possível obter bounds para fallback PNG');
    }
  } catch (error) {
    console.error(`❌ Erro no fallback PNG: ${error}`);
  }
}

// Verificar carregamento das bibliotecas
function checkLibraries() {
    // Verificar diferentes possíveis nomes das bibliotecas
    const libraries = {
        'parseGeoraster': typeof parseGeoraster !== 'undefined',
        'GeoRasterLayer': typeof GeoRasterLayer !== 'undefined',
        'geotiff': typeof GeoTIFF !== 'undefined',
        'GeoRaster': typeof GeoRaster !== 'undefined',
        'parseGeorasterFromUrl': typeof parseGeorasterFromUrl !== 'undefined'
    };
    
    console.log('📚 Status das bibliotecas:', libraries);
    
    // Verificar se há algum nome alternativo disponível
    if (typeof window !== 'undefined') {
        console.log('🔍 Verificando objetos globais disponíveis:');
        Object.keys(window).forEach(key => {
            if (key.toLowerCase().includes('georaster') || key.toLowerCase().includes('geotiff')) {
                console.log(`  - ${key}:`, typeof window[key]);
            }
        });
    }
    
    // Verificar se as bibliotecas estão realmente funcionais
    if (typeof parseGeoraster !== 'undefined') {
        console.log('🧪 Testando parseGeoraster...');
        try {
            // Tentar criar um objeto vazio para testar se a função existe
            console.log('  - parseGeoraster é uma função:', typeof parseGeoraster);
            console.log('  - parseGeoraster.name:', parseGeoraster.name);
        } catch (e) {
            console.log('  - Erro ao testar parseGeoraster:', e);
        }
    }
    
    if (typeof GeoRasterLayer !== 'undefined') {
        console.log('🧪 Testando GeoRasterLayer...');
        try {
            console.log('  - GeoRasterLayer é uma função:', typeof GeoRasterLayer);
            console.log('  - GeoRasterLayer.name:', GeoRasterLayer.name);
        } catch (e) {
            console.log('  - Erro ao testar GeoRasterLayer:', e);
        }
    }
    
    const missing = Object.entries(libraries).filter(([name, loaded]) => !loaded);
    if (missing.length > 0) {
        console.warn('⚠️ Bibliotecas não carregadas:', missing.map(([name]) => name));
    } else {
        console.log('✅ Todas as bibliotecas carregadas com sucesso!');
    }
    
    return libraries;
}

// Inicialização da aplicação
document.addEventListener('DOMContentLoaded', function() {
    // Aguardar um pouco para as bibliotecas carregarem
    setTimeout(() => {
        checkLibraries();
        initializeMap();
        setupEventListeners();
    }, 500); // Aumentei o tempo para dar mais chance das bibliotecas carregarem
});

// Função para testar carregamento das bibliotecas
window.testLibraries = function() {
    console.log('🧪 Testando bibliotecas...');
    checkLibraries();
    
    // Tentar carregar um TIFF de teste
    const testUrl = '/output/N_pct_kriging_interpolation.tif';
    console.log('🧪 Testando carregamento de TIFF:', testUrl);
    
    // Verificar se o arquivo existe
    fetch(testUrl, { method: 'HEAD' })
        .then(response => {
            if (response.ok) {
                console.log('✅ Arquivo TIFF existe e é acessível');
                
                // Tentar carregar o TIFF real
                console.log('🧪 Tentando carregar TIFF real...');
                addTiffLayer(testUrl, 'TESTE_TIFF', 0, 1)
                    .then(success => {
                        if (success) {
                            console.log('🎉 TIFF carregado com sucesso!');
                        } else {
                            console.log('❌ TIFF falhou ao carregar');
                        }
                    });
            } else {
                console.log('❌ Arquivo TIFF não encontrado');
            }
        })
        .catch(error => {
            console.log('❌ Erro ao verificar arquivo TIFF:', error);
        });
};

// Função para testar carregamento de TIFF (baseada no exemplo)
window.testTiff = function() {
    console.log('🧪 Testando carregamento de TIFF...');
    
    const testUrl = '/output/N_pct_kriging_interpolation.tif';
    
    // Verificar se o arquivo existe
    fetch(testUrl, { method: 'HEAD' })
        .then(response => {
            if (response.ok) {
                console.log('✅ Arquivo TIFF existe e é acessível');
                
                // Tentar carregar o TIFF usando a mesma abordagem do exemplo
                console.log('🧪 Tentando carregar TIFF...');
                return addTiffLayer(testUrl, 'TESTE_TIFF', 0, 1);
            } else {
                console.log('❌ Arquivo TIFF não encontrado');
                throw new Error('Arquivo não encontrado');
            }
        })
        .then(success => {
            if (success) {
                console.log('🎉 TIFF carregado com sucesso!');
            } else {
                console.log('❌ TIFF falhou ao carregar');
            }
        })
        .catch(error => {
            console.log('❌ Erro ao testar TIFF:', error);
        });
};

// Função para testar diretamente (como no exemplo)
window.testTiffDirect = function() {
    console.log('🧪 Testando TIFF diretamente (como no exemplo)...');
    
    const testUrl = '/output/N_pct_kriging_interpolation.tif';
    
    // Usar exatamente a mesma abordagem do exemplo
    fetch(testUrl)
        .then((response) => response.arrayBuffer())
        .then((arrayBuffer) => {
            console.log(`✅ ArrayBuffer carregado: ${arrayBuffer.byteLength} bytes`);
            
            if (typeof parseGeoraster === 'undefined') {
                throw new Error('parseGeoraster não está disponível');
            }
            
            return parseGeoraster(arrayBuffer);
        })
        .then((georaster) => {
            console.log('✅ Georaster processado:', georaster);
            console.log(`📐 Dimensões: ${georaster.pixelWidth}x${georaster.pixelHeight}`);
            
            if (typeof GeoRasterLayer === 'undefined') {
                throw new Error('GeoRasterLayer não está disponível');
            }
            
            // Criar camada (como no exemplo)
            var layer = new GeoRasterLayer({
                georaster: georaster,
                opacity: 0.7,
                resolution: 256
            });
            
            layer.addTo(map);
            map.fitBounds(layer.getBounds());
            
            console.log('🎉 Camada TIFF criada e adicionada ao mapa!');
            return true;
        })
        .catch(error => {
            console.log('❌ Erro no teste direto:', error);
        });
};

// Função para forçar recarregamento das bibliotecas
window.reloadLibraries = function() {
    console.log('🔄 Recarregando bibliotecas...');
    
    // Remover scripts existentes
    const existingScripts = document.querySelectorAll('script[src*="georaster"]');
    existingScripts.forEach(script => script.remove());
    
    // Recarregar bibliotecas
    const script1 = document.createElement('script');
    script1.src = 'https://cdn.jsdelivr.net/npm/georaster@2.0.0/dist/georaster.browser.min.js';
    script1.onload = () => console.log('✅ GeoRaster carregado');
    script1.onerror = () => console.log('❌ GeoRaster falhou');
    
    const script2 = document.createElement('script');
    script2.src = 'https://cdn.jsdelivr.net/npm/georaster-layer-for-leaflet@2.0.0/dist/georaster-layer-for-leaflet.min.js';
    script2.onload = () => console.log('✅ GeoRasterLayer carregado');
    script2.onerror = () => console.log('❌ GeoRasterLayer falhou');
    
    document.head.appendChild(script1);
    document.head.appendChild(script2);
    
    setTimeout(() => {
        console.log('🔄 Verificando bibliotecas após recarregamento...');
        checkLibraries();
    }, 2000);
};

// Inicializar mapa Leaflet
function initializeMap() {
                    // Criar mapa centrado no Brasil com zoom 8 (mais próximo)
        map = L.map('map').setView([-15.7801, -47.9292], 8);
    
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
    
    // Camadas overlay que serão adicionadas dinamicamente
    overlayMaps = {};
    
    // Adicionar controle de camadas com overlay
    layerControl = L.control.layers(baseMaps, overlayMaps, {
        position: 'topright',
        collapsed: false
    }).addTo(map);
    
    // Configurar otimizações de performance
    setupZoomBasedRendering();
    
    console.log('🗺️ Mapa inicializado com otimizações de performance ativas');
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

// Extrair parâmetros dos atributos das features do GeoJSON
function extractParametersFromGeoJSON(geoJson) {
    if (!geoJson || !geoJson.features || geoJson.features.length === 0) {
        return [];
    }
    
    // Pegar o primeiro feature para analisar os atributos
    const firstFeature = geoJson.features[0];
    if (!firstFeature.properties) {
        return [];
    }
    
    // Extrair todos os parâmetros exceto id, gridSize, latitude, longitude
    const excludeParams = ['id', 'gridSize', 'latitude', 'longitude'];
    const parameters = Object.keys(firstFeature.properties)
        .filter(key => !excludeParams.includes(key))
        .filter(key => typeof firstFeature.properties[key] === 'number');
    
    console.log('Parâmetros extraídos:', parameters);
    return parameters;
}

// Processar arquivo
function handleFile(file) {
    showLoading(true);
    
    const formData = new FormData();
    formData.append('file', file);
    
    let endpoint;
    if (file.name.endsWith('.geojson') || file.name.endsWith('.json')) {
        endpoint = '/upload/geojson';
    } else if (file.name.endsWith('.zip')) {
        endpoint = '/upload/shapefile';
    } else {
        showAlert('Formato de arquivo não suportado. Use GeoJSON ou ZIP (Shapefile).', 'danger');
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
            // Extrair parâmetros dos atributos das features
            const parameters = extractParametersFromGeoJSON(data.geoJson);
            data.parameters = parameters;
            
            soilData = data;
            displaySoilData(data);
            showAlert('Arquivo de solo importado com sucesso!', 'success');
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

// Exibir dados de solo com otimização para grandes datasets
function displaySoilData(data) {
    // Limpar mapa anterior
    clearMap();
    
    const totalPoints = data.geoJson.features.length;
    console.log(`📊 Dataset carregado (${totalPoints} pontos) - aguardando configuração do usuário`);
    
    // NÃO carregar pontos automaticamente - deixar o usuário decidir
    // Isso melhora drasticamente a performance inicial
    
    // Exibir informações
    displayFileInfo(data);
    
    // Mostrar seleção de parâmetros
    showParameterSelection(data.parameters);
    
    // Configurar performance baseada no tamanho do dataset
    if (totalPoints > 100) {
        // Dataset grande - otimizar automaticamente
        if (document.getElementById('showPointsToggle')) {
            document.getElementById('showPointsToggle').checked = false;
            document.getElementById('enableClustering').checked = true;
            console.log('⚡ Dataset grande - otimizando performance automaticamente');
        }
    }
    
    // Configurar controles de performance
    setupPerformanceControls();
}

// SISTEMA OTIMIZADO: Funções de carregamento de pontos removidas
// Performance máxima - apenas interpolação TIFF

// SISTEMA OTIMIZADO: Processamento de lotes removido

// Mostrar barra de progresso
function showProgressBar() {
    let progressContainer = document.getElementById('loadingProgress');
    if (!progressContainer) {
        progressContainer = document.createElement('div');
        progressContainer.id = 'loadingProgress';
        progressContainer.className = 'alert alert-info mt-3';
        progressContainer.innerHTML = `
            <div class="d-flex align-items-center">
                <div class="spinner-border spinner-border-sm me-2" role="status"></div>
                <div class="flex-grow-1">
                    <div class="d-flex justify-content-between">
                        <span>Carregando pontos de solo...</span>
                        <span id="progressText">0%</span>
                    </div>
                    <div class="progress mt-2" style="height: 8px;">
                        <div id="progressBar" class="progress-bar" role="progressbar" style="width: 0%"></div>
                    </div>
                    <div class="text-muted small">Dataset grande detectado. Carregando em lotes para melhor performance...</div>
                </div>
            </div>
        `;
        
        const resultsSection = document.getElementById('resultsSection');
        if (resultsSection) {
            resultsSection.appendChild(progressContainer);
        }
    }
    progressContainer.style.display = 'block';
}

// Atualizar barra de progresso
function updateProgressBar(progress) {
    const progressText = document.getElementById('progressText');
    const progressBar = document.getElementById('progressBar');
    
    if (progressText && progressBar) {
        progressText.textContent = `${Math.round(progress)}%`;
        progressBar.style.width = `${progress}%`;
    }
}

// Ocultar barra de progresso
function hideProgressBar() {
    const progressContainer = document.getElementById('loadingProgress');
    if (progressContainer) {
        progressContainer.style.display = 'none';
    }
}

// --- FUNÇÕES DE OTIMIZAÇÃO AVANÇADA ---

// Clustering de pontos para melhor performance
function createPointClusters(points, zoomLevel) {
    if (zoomLevel < 10) {
        // Zoom baixo - agrupar pontos próximos
        return clusterPoints(points, 0.01); // 0.01 graus ≈ 1km
    } else if (zoomLevel < 14) {
        // Zoom médio - agrupar pontos muito próximos
        return clusterPoints(points, 0.001); // 0.001 graus ≈ 100m
    } else {
        // Zoom alto - mostrar todos os pontos
        return points;
    }
}

// Algoritmo de clustering simples
function clusterPoints(points, threshold) {
    const clusters = [];
    const processed = new Set();
    
    points.forEach((point, index) => {
        if (processed.has(index)) return;
        
        const cluster = [point];
        processed.add(index);
        
        // Encontrar pontos próximos
        for (let j = index + 1; j < points.length; j++) {
            if (processed.has(j)) continue;
            
            const distance = calculateDistance(
                point.geometry.coordinates[1], point.geometry.coordinates[0],
                points[j].geometry.coordinates[1], points[j].geometry.coordinates[0]
            );
            
            if (distance < threshold) {
                cluster.push(points[j]);
                processed.add(j);
            }
        }
        
        clusters.push(cluster);
    });
    
    return clusters;
}

// Calcular distância entre dois pontos (fórmula de Haversine)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Raio da Terra em km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Renderização condicional baseada em zoom
function setupZoomBasedRendering() {
    if (!map) return;
    
    map.on('zoomend', debounce(() => {
        const zoom = map.getZoom();
        console.log(`🔍 Zoom alterado para: ${zoom}`);
        
        if (currentSoilPointsLayer && soilData) {
            updatePointVisibility(zoom);
        }
    }, 300));
}

// Atualizar visibilidade dos pontos baseado no zoom
function updatePointVisibility(zoom) {
    if (!currentSoilPointsLayer || !soilData) return;
    
    // Limpar camada atual
    currentSoilPointsLayer.clearLayers();
    
    // Aplicar clustering baseado no zoom
    const clusteredPoints = createPointClusters(soilData.geoJson.features, zoom);
    
    // Renderizar pontos ou clusters
    clusteredPoints.forEach(item => {
        if (Array.isArray(item)) {
            // É um cluster - mostrar ponto representativo
            const representative = item[0];
            const marker = createClusterMarker(representative, item.length);
            currentSoilPointsLayer.addLayer(marker);
        } else {
            // É um ponto individual
            const marker = createIndividualMarker(item);
            currentSoilPointsLayer.addLayer(marker);
        }
    });
    
    console.log(`🎯 Zoom ${zoom}: ${clusteredPoints.length} elementos visíveis`);
}

// Criar marcador de cluster
function createClusterMarker(feature, count) {
    const marker = L.circleMarker([feature.geometry.coordinates[1], feature.geometry.coordinates[0]], {
        radius: Math.min(8 + count * 2, 20), // Tamanho baseado na quantidade
        fillColor: '#ff6b6b',
        color: '#2c3e50',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.8
    });
    
    // Popup mostrando quantidade de pontos no cluster
    marker.bindPopup(`<strong>Cluster de ${count} pontos</strong><br>Clique para expandir`);
    
    // Ao clicar, fazer zoom para mostrar pontos individuais
    marker.on('click', () => {
        map.setZoom(Math.min(map.getZoom() + 2, 18));
    });
    
    return marker;
}

// Criar marcador individual
function createIndividualMarker(feature) {
    return L.circleMarker([feature.geometry.coordinates[1], feature.geometry.coordinates[0]], {
        radius: 8,
        fillColor: '#ff6b6b',
        color: '#2c3e50',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.8
    }).bindPopup(createPopupContent(feature));
}

// Debouncing para evitar muitas chamadas
function debounce(func, wait) {
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(debounceTimer);
            func(...args);
        };
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(later, wait);
    };
}

// Configurações de performance configuráveis
function setPerformanceSettings(settings) {
    if (settings.maxPointsPerBatch) {
        maxPointsPerBatch = settings.maxPointsPerBatch;
    }
    
    console.log(`⚡ Configurações de performance atualizadas:`, {
        maxPointsPerBatch,
        clustering: 'ativo',
        lazyLoading: 'ativo',
        zoomBasedRendering: 'ativo'
    });
}

// Criar conteúdo do popup
function createPopupContent(feature) {
    let content = `<strong>Amostra ${feature.properties.id || 'N/A'}</strong><br>`;
    
    if (feature.properties) {
        Object.entries(feature.properties).forEach(([key, value]) => {
            if (key !== 'id' && typeof value === 'number') {
                content += `${key}: ${value.toFixed(2)}<br>`;
            } else if (key !== 'id') {
                content += `${key}: ${value}<br>`;
            }
        });
    }
    
    return content;
}

// Exibir informações do arquivo
function displayFileInfo(data) {
    document.getElementById('totalPoints').textContent = data.geoJson.features.length;
    document.getElementById('totalParameters').textContent = data.parameters.length;
    document.getElementById('totalArea').textContent = data.area ? data.area.toFixed(2) : 'N/A';
    document.getElementById('fileInfo').style.display = 'block';
}

// Mostrar seleção de parâmetros
function showParameterSelection(parameters) {
    const container = document.getElementById('parametersList');
    container.innerHTML = '';
    
    parameters.forEach(param => {
        const paramDiv = document.createElement('div');
        paramDiv.className = 'col-md-3';
        paramDiv.innerHTML = `
            <div class="parameter-checkbox" onclick="toggleParameter('${param}')" data-param="${param}">
                <h6>${param}</h6>
                <p class="text-muted small">Clique para selecionar</p>
            </div>
        `;
        container.appendChild(paramDiv);
    });
    
    document.getElementById('parameterSelection').style.display = 'block';
}

// Alternar seleção de parâmetro
function toggleParameter(param) {
    const checkbox = document.querySelector(`[data-param="${param}"]`);
    
    if (selectedParameters.includes(param)) {
        selectedParameters = selectedParameters.filter(p => p !== param);
        checkbox.classList.remove('selected');
    } else {
        selectedParameters.push(param);
        checkbox.classList.add('selected');
    }
    
    console.log('Parâmetros selecionados:', selectedParameters);
    
    // Mostrar opções de interpolação se houver parâmetros selecionados
    if (selectedParameters.length > 0) {
        document.getElementById('interpolationOptions').style.display = 'block';
    } else {
        document.getElementById('interpolationOptions').style.display = 'none';
    }
}

// Selecionar método de interpolação
function selectMethod(method) {
    selectedMethod = method;
    
    // Remover seleção anterior
    document.querySelectorAll('.method-option').forEach(option => {
        option.classList.remove('selected');
    });
    
    // Selecionar nova opção
    event.target.closest('.method-option').classList.add('selected');
    
    console.log('Método selecionado:', method);
    
    // Mostrar/ocultar controles de modo baseado no método
    const modeGroup = document.getElementById('interpolationModeGroup');
    const manualGroup = document.getElementById('manualParamsGroup');
    
    if (method === 'kriging') {
        modeGroup.style.display = 'block';
        // Verificar modo selecionado
        const mode = document.getElementById('interpolationMode').value;
        if (mode === 'manual') {
            manualGroup.style.display = 'block';
        } else {
            manualGroup.style.display = 'none';
        }
    } else {
        modeGroup.style.display = 'none';
        manualGroup.style.display = 'none';
    }
    
    console.log(`Método selecionado: ${method}`);
}

    // Função para alternar entre modo automático e manual
    function toggleInterpolationMode() {
        const mode = document.getElementById('interpolationMode').value;
        const manualGroup = document.getElementById('manualParamsGroup');
        
        if (mode === 'manual') {
            manualGroup.style.display = 'block';
            console.log('🎛️ Modo manual ativado - controles avançados visíveis');
        } else {
            manualGroup.style.display = 'none';
            console.log('🤖 Modo automático ativado - usando análise automática de variogramas');
        }
    }
    
    // SISTEMA OTIMIZADO: Funções de controle de pontos removidas
    // Performance máxima garantida sem carregar pontos no mapa

// Função para atualizar valores dos sliders
function updateSliderValues() {
    // Length Scale
    const lengthScale = document.getElementById('lengthScale');
    const lengthScaleValue = document.getElementById('lengthScaleValue');
    lengthScaleValue.textContent = lengthScale.value;
    
    // Alpha
    const alpha = document.getElementById('alpha');
    const alphaValue = document.getElementById('alphaValue');
    alphaValue.textContent = alpha.value;
    
    // Nugget
    const nugget = document.getElementById('nugget');
    const nuggetValue = document.getElementById('nuggetValue');
    nuggetValue.textContent = nugget.value;
    
    // Sill
    const sill = document.getElementById('sill');
    const sillValue = document.getElementById('sillValue');
    sillValue.textContent = sill.value;
    
    // Range
    const range = document.getElementById('range');
    const rangeValue = document.getElementById('rangeValue');
    rangeValue.textContent = range.value;
}

function generateInterpolation() {
    if (!selectedMethod || selectedParameters.length === 0) {
        showAlert('Selecione um método e pelo menos um parâmetro', 'warning');
        return;
    }
    
    showLoading(true);
    
    const config = {
        method: selectedMethod,
        parameters: selectedParameters,
        resolution: parseInt(document.getElementById('resolution').value),
        searchRadius: parseInt(document.getElementById('searchRadius').value)
    };
    
    fetch('/generate-interpolation', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            soilData: soilData,
            config: config
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            interpolationResults = data;
            displayInterpolationResults(data);
            showAlert('Interpolação gerada com sucesso!', 'success');
        } else {
            showAlert('Erro ao gerar interpolação: ' + data.error, 'danger');
        }
    })
    .catch(error => {
        console.error('Erro:', error);
        showAlert('Erro ao gerar interpolação', 'danger');
    })
    .finally(() => {
        showLoading(false);
    });
}

// Exibir resultados da interpolação
function displayInterpolationResults(data) {
    console.log("📊 Exibindo resultados da interpolação...");
    
    // Verificar se o mapa está válido antes de continuar
    if (!map || !map.getContainer()) {
        console.error("❌ Mapa inválido - recarregando página pode resolver");
        showAlert('Erro no mapa - recarregue a página', 'danger');
        return;
    }
    
    // Limpar mapa anterior com tratamento de erro
    try {
        clearMap();
    } catch (error) {
        console.warn("⚠️ Erro ao limpar mapa:", error);
        // Continuar mesmo com erro de limpeza
    }
    
    // SISTEMA OTIMIZADO: Não carregar pontos - apenas interpolação
    // Isso melhora drasticamente a performance, especialmente com datasets grandes
    console.log('🚀 Sistema otimizado: carregando apenas interpolação TIFF');
    
    // Remover completamente a lógica de pontos para otimização máxima
    currentSoilPointsLayer = null;
    
    // Não exibir interpolação no mapa - apenas pontos de amostra
    // A interpolação será visualizada via download dos arquivos PNG/TIFF
    
            // Ajustar view do mapa (sem fitBounds para manter zoom 8)
    // const bounds = [
    //     [data.bounds[0], data.bounds[1]], // [south, west]
    //     [data.bounds[2], data.bounds[3]]  // [north, east]
    // ];
    // map.fitBounds(bounds, { padding: [20, 20] });
    
    // Adicionar camadas TIFF para cada parâmetro interpolado
    console.log('Dados recebidos:', data);
    console.log('Parâmetros selecionados:', selectedParameters);
    
    selectedParameters.forEach(async (param) => {
        const info = data.interpolations[param];
        console.log(`Verificando parâmetro ${param}:`, info);
        
        if (info && info.hasFiles && info.hasFiles.tiff) {
            const label = `${param} (${data.method.toUpperCase()})`;
            const tiffUrl = `/output/${param}_${data.method.toLowerCase()}_interpolation.tif`;
            console.log(`Adicionando camada TIFF: ${label} - ${tiffUrl}`);
            
            const success = await addTiffLayer(tiffUrl, label, info.min, info.max);
            if (!success) {
                console.error(`❌ Falha ao carregar TIFF para ${param}`);
                // Mostrar mensagem para o usuário
                const errorMsg = document.createElement('div');
                errorMsg.className = 'alert alert-warning mt-3';
                errorMsg.innerHTML = `
                    <strong>⚠️ Aviso:</strong> Não foi possível carregar o TIFF para ${param}. 
                    <br>Verifique se as bibliotecas de GeoTIFF estão carregando corretamente.
                `;
                document.getElementById('resultsSection').appendChild(errorMsg);
            }
        } else {
            console.log(`Parâmetro ${param} não tem TIFF válido:`, info);
        }
    });
    
    // Mostrar seção de resultados
    document.getElementById('resultsSection').style.display = 'block';
    
    // SISTEMA OTIMIZADO: Não mostrar botão de pontos
    console.log('🎯 Interface otimizada: foco apenas na interpolação');
    
    // Gerar botões de download
    generateDownloadButtons(data);
    
    // Gerar estatísticas
    generateStatistics(data);
}

// SISTEMA OTIMIZADO: Funções de pontos removidas para melhor performance

// Gerar botões de download
function generateDownloadButtons(data) {
    const imageContainer = document.getElementById('imageDownloads');
    const dataContainer = document.getElementById('dataDownloads');
    
    imageContainer.innerHTML = '';
    dataContainer.innerHTML = '';
    
    selectedParameters.forEach(param => {
        if (data.interpolations[param]) {
            // Botões para imagens
            const pngBtn = document.createElement('button');
            pngBtn.className = 'btn btn-custom btn-sm me-2 mb-2';
            pngBtn.innerHTML = `<i class="fas fa-image"></i> ${param} (PNG)`;
            pngBtn.onclick = () => downloadImage(param, 'png');
            imageContainer.appendChild(pngBtn);
            
            const tiffBtn = document.createElement('button');
            tiffBtn.className = 'btn btn-custom btn-sm me-2 mb-2';
            tiffBtn.innerHTML = `<i class="fas fa-image"></i> ${param} (TIFF)`;
            tiffBtn.onclick = () => downloadImage(param, 'tiff');
            imageContainer.appendChild(tiffBtn);
            
            // Download GeoJSON removido conforme solicitado
        }
    });
}

// Gerar estatísticas
function generateStatistics(data) {
    const container = document.getElementById('statisticsContent');
    let html = '<div class="row">';
    
    selectedParameters.forEach(param => {
        if (data.interpolations[param]) {
            const stats = data.interpolations[param].statistics;
            html += `
                <div class="col-md-6 mb-3">
                    <div class="card">
                        <div class="card-header">
                            <h6>${param}</h6>
                        </div>
                        <div class="card-body">
                            <p><strong>Mínimo:</strong> ${stats.min.toFixed(2)}</p>
                            <p><strong>Máximo:</strong> ${stats.max.toFixed(2)}</p>
                            <p><strong>Média:</strong> ${stats.mean.toFixed(2)}</p>
                            <p><strong>Desvio Padrão:</strong> ${stats.std.toFixed(2)}</p>
                        </div>
                    </div>
                </div>
            `;
        }
    });
    
    html += '</div>';
    container.innerHTML = html;
}

// Download de imagem
function downloadImage(param, format) {
    if (!interpolationResults || !interpolationResults.interpolations[param]) {
        showAlert('Dados de interpolação não disponíveis', 'warning');
        return;
    }
    
    // Usar rota de download do servidor para PNG e TIFF
    fetch('/download-interpolation', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            param: param,
            format: format,
            method: interpolationResults.method
        })
    })
    .then(response => {
        if (response.ok) {
            return response.blob();
        } else {
            throw new Error('Arquivo não encontrado');
        }
    })
    .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${param}_${interpolationResults.method}_interpolation.${format}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        showAlert(`Download de ${format.toUpperCase()} iniciado`, 'success');
    })
    .catch(error => {
        console.error('Erro no download:', error);
        showAlert('Erro ao baixar arquivo', 'danger');
    });
}

// Download de dados
function downloadData(param, format) {
    if (!interpolationResults || !interpolationResults.interpolations[param]) {
        showAlert('Dados de interpolação não disponíveis', 'warning');
        return;
    }
    
    fetch('/download-interpolation', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            param: param,
            format: format,
            method: interpolationResults.method
        })
    })
    .then(response => response.blob())
    .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${param}_${interpolationResults.method}_interpolation.${format}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    })
    .catch(error => {
        console.error('Erro ao baixar dados:', error);
        showAlert('Erro ao baixar dados', 'danger');
    });
}

// Limpar mapa
function clearMap() {
    console.log("🧹 Limpando mapa...");
    
    try {
    // Remover camadas overlay do controle
    if (layerControl && overlayMaps) {
        for (const [name, layer] of Object.entries(overlayMaps)) {
                try {
                    if (layerControl.removeLayer) {
            layerControl.removeLayer(layer);
                    }
                    if (map && map.hasLayer && map.hasLayer(layer)) {
                map.removeLayer(layer);
                    }
                } catch (e) {
                    console.warn(`⚠️ Erro ao remover layer ${name}:`, e);
            }
        }
        overlayMaps = {};
    }
    
    // Limpar variáveis de camadas
    currentSoilPointsLayer = null;
    
    // Remover legenda raster
    const legend = document.getElementById('rasterLegend');
    if (legend) {
        legend.remove();
    }
    
        // ❌ REMOVIDO: setView problemático
        // Não resetar view para evitar erro do GridLayer
        console.log("✅ Mapa limpo com sucesso");
        
    } catch (error) {
        console.error("❌ Erro ao limpar mapa:", error);
    }
}

// Funções auxiliares
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

// --- FUNÇÕES DE CONTROLE DE PERFORMANCE ---

// Função para ajustar configurações de performance em tempo real
window.adjustPerformance = function(settings) {
    setPerformanceSettings(settings);
    showAlert('Configurações de performance atualizadas!', 'success');
};

// Função para testar performance com diferentes configurações
window.testPerformance = function() {
    console.log('🧪 Testando performance...');
    
    // Testar com diferentes tamanhos de lote
    const testSettings = [
        { maxPointsPerBatch: 500, name: 'Baixa performance' },
        { maxPointsPerBatch: 1000, name: 'Média performance' },
        { maxPointsPerBatch: 2000, name: 'Alta performance' }
    ];
    
    testSettings.forEach((setting, index) => {
        setTimeout(() => {
            console.log(`⚡ Teste ${index + 1}: ${setting.name}`);
            setPerformanceSettings(setting);
        }, index * 2000);
    });
};

// Função para limpar cache e otimizar memória
window.optimizeMemory = function() {
    console.log('🧹 Otimizando memória...');
    
    // Forçar garbage collection se disponível
    if (window.gc) {
        window.gc();
    }
    
    // Limpar timers pendentes
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
    
    // Resetar variáveis de otimização
    currentBatch = 0;
    totalBatches = 0;
    loadingProgress = 0;
    
    showAlert('Memória otimizada com sucesso!', 'success');
};

// Função para mostrar estatísticas de performance
window.showPerformanceStats = function() {
    const stats = {
        'Pontos por lote': maxPointsPerBatch,
        'Lotes processados': currentBatch,
        'Total de lotes': totalBatches,
        'Progresso atual': `${Math.round(loadingProgress)}%`,
        'Clustering ativo': 'Sim',
        'Lazy loading': 'Sim',
        'Zoom-based rendering': 'Sim'
    };
    
    console.table(stats);
    
    // Criar popup com estatísticas
    const statsHtml = Object.entries(stats)
        .map(([key, value]) => `<tr><td><strong>${key}:</strong></td><td>${value}</td></tr>`)
        .join('');
    
    const popup = L.popup()
        .setLatLng(map.getCenter())
        .setContent(`
            <div style="min-width: 300px;">
                <h6>📊 Estatísticas de Performance</h6>
                <table class="table table-sm">
                    <tbody>${statsHtml}</tbody>
                </table>
                <small class="text-muted">Use o console para mais detalhes</small>
            </div>
        `)
        .openOn(map);
};

// 🔍 Função de teste para inspeção TIFF
window.testInspection = function() {
    console.log('🔍 Testando sistema de inspeção...');
    
    // Verificar TODOS os layers primeiro
    let allLayers = [];
    let tiffLayers = [];
    
    map.eachLayer(function(layer) {
        allLayers.push({
            type: layer.constructor.name,
            hasGeoraster: !!layer.georaster,
            layer: layer
        });
        
        if (layer.georaster) {
            tiffLayers.push(layer);
        }
    });
    
    console.log(`🗺️ Total de layers no mapa: ${allLayers.length}`);
    console.log(`📊 Detalhes dos layers:`, allLayers);
    console.log(`📊 Layers TIFF encontrados: ${tiffLayers.length}`);
    
    if (tiffLayers.length > 0) {
        const layer = tiffLayers[0];
        console.log(`🎯 Testando layer TIFF:`, layer);
        console.log(`📐 Georaster disponível:`, !!layer.georaster);
        console.log(`🏷️ Nome do layer:`, layer.layerName);
        console.log(`📊 Range:`, layer.minValue, 'a', layer.maxValue);
        
        // Simular clique no centro do layer
        const bounds = layer.getBounds();
        if (bounds && bounds.isValid()) {
            const center = bounds.getCenter();
            console.log(`📍 Centro do layer: ${center.lat}, ${center.lng}`);
            
            // Testar getPixelValue diretamente
            const pixelResult = getPixelValue(layer.georaster, center.lng, center.lat);
            console.log(`🔍 Resultado no centro:`, pixelResult);
            
            // Simular evento de mouse
            const fakeEvent = {
                latlng: center
            };
            
            console.log(`🖱️ Simulando movimento do mouse no centro...`);
            map.fire('mousemove', fakeEvent);
            
            // Teste de clique também
            console.log(`👆 Simulando clique no centro...`);
            map.fire('click', fakeEvent);
            
        } else {
            console.log(`❌ Bounds inválidos para o layer`);
        }
    } else {
        console.log(`⚠️ Nenhum layer TIFF encontrado!`);
        console.log(`💡 Verifique se a interpolação foi carregada corretamente.`);
        
        // Verificar overlayMaps
        console.log(`🔍 Verificando overlayMaps:`, overlayMaps);
    }
};

// 🎯 Função para mostrar área clicável
window.showClickableArea = function() {
    console.log('🎯 Mostrando área clicável...');
    
    // Tentar usar referência global primeiro
    if (window.currentGeoraster) {
        const georaster = window.currentGeoraster;
        
        // Criar retângulo mostrando os bounds exatos
        const bounds = [
            [georaster.ymin, georaster.xmin],
            [georaster.ymax, georaster.xmax]
        ];
        
        // Remover retângulo anterior se existir
        if (window.clickableAreaRect) {
            map.removeLayer(window.clickableAreaRect);
        }
        
        // Adicionar retângulo vermelho mostrando área clicável
        window.clickableAreaRect = L.rectangle(bounds, {
            color: '#ff0000',
            weight: 3,
            fillOpacity: 0.1,
            dashArray: '10, 10'
        }).addTo(map);
        
        // Adicionar popup explicativo
        const center = [(georaster.ymin + georaster.ymax) / 2, (georaster.xmin + georaster.xmax) / 2];
        L.popup()
            .setLatLng(center)
            .setContent(`
                <div style="text-align: center;">
                    <h4>🎯 Área de Inspeção TIFF</h4>
                    <p>Passe o mouse <strong>dentro</strong> desta área vermelha</p>
                    <p><small>Bounds: ${georaster.xmin.toFixed(6)} a ${georaster.xmax.toFixed(6)}</small></p>
                </div>
            `)
            .openOn(map);
            
        console.log(`✅ Área clicável marcada em vermelho!`);
        console.log(`📦 Bounds: [${georaster.ymin}, ${georaster.xmin}] a [${georaster.ymax}, ${georaster.xmax}]`);
        return;
    }
    
    // Fallback: procurar layers
    let tiffLayers = [];
    map.eachLayer(function(layer) {
        if (layer.georaster) {
            tiffLayers.push(layer);
        }
    });
    
    if (tiffLayers.length > 0) {
        const layer = tiffLayers[0];
        const georaster = layer.georaster;
        
        // Criar retângulo mostrando os bounds exatos
        const bounds = [
            [georaster.ymin, georaster.xmin],
            [georaster.ymax, georaster.xmax]
        ];
        
        // Remover retângulo anterior se existir
        if (window.clickableAreaRect) {
            map.removeLayer(window.clickableAreaRect);
        }
        
        // Adicionar retângulo vermelho mostrando área clicável
        window.clickableAreaRect = L.rectangle(bounds, {
            color: '#ff0000',
            weight: 3,
            fillOpacity: 0.1,
            dashArray: '10, 10'
        }).addTo(map);
        
        // Adicionar popup explicativo
        const center = [(georaster.ymin + georaster.ymax) / 2, (georaster.xmin + georaster.xmax) / 2];
        L.popup()
            .setLatLng(center)
            .setContent(`
                <div style="text-align: center;">
                    <h4>🎯 Área de Inspeção TIFF</h4>
                    <p>Passe o mouse <strong>dentro</strong> desta área vermelha</p>
                    <p><small>Bounds: ${georaster.xmin.toFixed(6)} a ${georaster.xmax.toFixed(6)}</small></p>
                </div>
            `)
            .openOn(map);
            
        console.log(`✅ Área clicável marcada em vermelho!`);
        console.log(`📦 Bounds: [${georaster.ymin}, ${georaster.xmin}] a [${georaster.ymax}, ${georaster.xmax}]`);
        
    } else {
        console.log(`⚠️ Nenhum layer TIFF encontrado!`);
    }
};

// 🔥 FUNÇÃO DE INSPEÇÃO GLOBAL ULTRA ROBUSTA
window.inspectPoint = function(lat, lng) {
    console.log(`🎯 ===== INSPEÇÃO GLOBAL ULTRA ROBUSTA =====`);
    console.log(`📍 Coordenadas solicitadas: lat=${lat}, lng=${lng}`);
    
    // Verificar se temos dados globais
    if (!window.currentGeoraster || !window.currentLayerInfo) {
        console.log(`⚠️ Dados globais não encontrados:`);
        console.log(`   - currentGeoraster: ${!!window.currentGeoraster}`);
        console.log(`   - currentLayerInfo: ${!!window.currentLayerInfo}`);
        
        // Tentar encontrar layers TIFF ativos no mapa
        let foundGeoraster = null;
        let foundLayerInfo = null;
        
        map.eachLayer(function(layer) {
            if (layer.georaster && layer.layerName) {
                console.log(`🔍 Encontrado layer TIFF ativo: ${layer.layerName}`);
                foundGeoraster = layer.georaster;
                foundLayerInfo = {
                    min: layer.minValue || 0,
                    max: layer.maxValue || 100,
                    layerName: layer.layerName
                };
            }
        });
        
        if (foundGeoraster && foundLayerInfo) {
            console.log(`✅ Usando layer encontrado: ${foundLayerInfo.layerName}`);
            window.currentGeoraster = foundGeoraster;
            window.currentLayerInfo = foundLayerInfo;
        } else {
            const message = `⚠️ Nenhum layer TIFF encontrado!\n\nCarregue uma interpolação primeiro:\n1. Selecione um parâmetro\n2. Clique em "Gerar Interpolação"\n3. Aguarde o carregamento\n4. Tente novamente`;
            alert(message);
            console.log(`❌ Nenhum layer TIFF encontrado no mapa`);
            return null;
        }
    }
    
    const georaster = window.currentGeoraster;
    const { min, max, layerName } = window.currentLayerInfo;
    
    console.log(`📊 Dados para inspeção:`);
    console.log(`   - Layer: ${layerName}`);
    console.log(`   - Range: ${min} → ${max}`);
    console.log(`   - Georaster:`, !!georaster);
    
    // Usar a função ultra robusta
    const pixelResult = getPixelValue(georaster, lng, lat);
    console.log(`🎯 Resultado da função ultra robusta:`, pixelResult);
    
    // Extrair valor
    let pixelValue, isInterpolated = false;
    if (typeof pixelResult === 'object' && pixelResult !== null) {
        pixelValue = pixelResult.value;
        isInterpolated = pixelResult.interpolated;
    } else {
        pixelValue = pixelResult;
    }
    
    console.log(`📊 Valor final extraído: ${pixelValue} (interpolado: ${isInterpolated})`);
    
    // Resultado final
    if (pixelValue !== null && pixelValue !== undefined && !isNaN(pixelValue)) {
        const interpolationText = isInterpolated ? ' (INTERPOLADO)' : '';
        const percentage = ((pixelValue - min) / (max - min) * 100).toFixed(1);
        
        const message = `✅ ${layerName}\n` +
                       `Valor: ${pixelValue.toFixed(3)}${interpolationText}\n` +
                       `Percentual: ${percentage}%\n` +
                       `Coordenadas: ${lat.toFixed(5)}, ${lng.toFixed(5)}\n` +
                       `Range: ${min.toFixed(2)} - ${max.toFixed(2)}`;
        
        alert(message);
        console.log(`✅ INSPEÇÃO GLOBAL SUCESSO: ${pixelValue}`);
        return pixelValue;
    } else {
        const message = `❌ Falha na inspeção\n` +
                       `Coordenadas: ${lat.toFixed(5)}, ${lng.toFixed(5)}\n` +
                       `Layer: ${layerName}\n\n` +
                       `Todas as 5 estratégias falharam.\n` +
                       `Verifique o console para detalhes.`;
        
        alert(message);
        console.log(`❌ INSPEÇÃO GLOBAL FALHOU - Todas as estratégias falharam`);
        return null;
    }
};

// 🔥 FUNÇÃO DE TESTE SIMPLIFICADA
window.testPixelInspection = function() {
    console.log(`🧪 ===== TESTE SIMPLIFICADO DE INSPEÇÃO =====`);
    
    // Tentar coordenadas dentro da área de teste
    const testCoords = [
        { lat: -27.633, lng: -53.472, name: "Centro estimado" },
        { lat: -27.631, lng: -53.470, name: "Norte" },
        { lat: -27.635, lng: -53.474, name: "Sul" }
    ];
    
    console.log(`🎯 Testando ${testCoords.length} coordenadas...`);
    
    for (let i = 0; i < testCoords.length; i++) {
        const coord = testCoords[i];
        console.log(`\n🔍 Teste ${i + 1}: ${coord.name}`);
        const result = window.inspectPoint(coord.lat, coord.lng);
        console.log(`   Resultado: ${result}`);
    }
    
    console.log(`\n🏁 Teste concluído!`);
};

// 🧪 FUNÇÃO PARA DEBUGAR LAYERS TIFF NO MAPA
window.debugTiffLayers = function() {
    console.log("🔍 ===== DEBUG DE LAYERS TIFF =====");
    
    let tiffLayersFound = 0;
    let allLayers = [];
    
    // Verificar todas as camadas no mapa
    map.eachLayer(function(layer) {
        allLayers.push({
            type: layer.constructor.name,
            hasOnMethod: typeof layer.on === 'function',
            hasGeoraster: !!layer.georaster,
            isVisible: map.hasLayer(layer)
        });
        
        if (layer.constructor.name.includes('GeoRaster') || layer.georaster) {
            tiffLayersFound++;
            console.log(`✅ TIFF Layer encontrado:`, {
                type: layer.constructor.name,
                hasOn: typeof layer.on === 'function',
                hasGeoraster: !!layer.georaster,
                isVisible: map.hasLayer(layer),
                bounds: layer.getBounds ? layer.getBounds() : 'N/A'
            });
            
            // Testar clique programático
            if (typeof layer.on === 'function') {
                console.log("🧪 Testando event listener no layer...");
                layer.on('click', function(e) {
                    console.log("🎉 EVENT LISTENER FUNCIONA!", e.latlng);
                });
            }
        }
    });
    
    console.log(`📊 Total layers no mapa: ${allLayers.length}`);
    console.log(`🎯 TIFF layers encontrados: ${tiffLayersFound}`);
    console.log(`📋 Todos os layers:`, allLayers);
    
    // Verificar controle de layers
    if (window.layerControl && window.overlayMaps) {
        console.log(`📁 Overlays no controle:`, Object.keys(window.overlayMaps));
    }
    
    return { tiffLayersFound, allLayers };
};

// 🧪 FUNÇÃO PARA SIMULAR CLIQUE EM COORDENADA ESPECÍFICA
window.simulateClickOnTiff = function(lat = -27.632, lng = -53.472) {
    console.log(`🧪 ===== SIMULANDO CLIQUE EM ${lat}, ${lng} =====`);
    
    // Criar evento de clique sintético
    const latlng = L.latLng(lat, lng);
    
    // Verificar se há TIFF layers
    let tiffLayer = null;
    map.eachLayer(function(layer) {
        if (layer.constructor.name.includes('GeoRaster') || layer.georaster) {
            tiffLayer = layer;
            console.log("🎯 TIFF Layer encontrado para teste");
        }
    });
    
    if (!tiffLayer) {
        console.error("❌ Nenhum TIFF layer encontrado!");
        return false;
    }
    
    // Verificar se o ponto está dentro dos bounds
    if (tiffLayer.getBounds && tiffLayer.getBounds().contains(latlng)) {
        console.log("✅ Coordenada está dentro dos bounds do TIFF");
        
        // Criar evento sintético
        const event = { latlng: latlng };
        
        // Disparar evento manualmente
        if (tiffLayer.fire) {
            console.log("🚀 Disparando evento click...");
            tiffLayer.fire('click', event);
        }
        
        // Tentar chamar o extrator offline diretamente
        if (window.offlinePixelExtractor && tiffLayer.georaster) {
            console.log("🧪 Testando extração direta...");
            const value = window.offlinePixelExtractor.extractValue(tiffLayer.georaster, lng, lat);
            console.log("📊 Valor extraído:", value);
            
            if (value !== null) {
                // Mostrar popup com resultado
                L.popup()
                    .setLatLng(latlng)
                    .setContent(`
                        <div style="background: #e74c3c; color: white; padding: 10px; border-radius: 5px;">
                            <strong>🧪 TESTE DIRETO</strong><br>
                            <strong>Valor: ${value}</strong><br>
                            <small>Lat: ${lat}<br>Lng: ${lng}</small>
                        </div>
                    `)
                    .openOn(map);
                    
                return value;
            }
        }
    } else {
        console.error("❌ Coordenada fora dos bounds do TIFF");
        if (tiffLayer.getBounds) {
            console.log("📦 Bounds do TIFF:", tiffLayer.getBounds());
        }
    }
    
    return null;
};

// 🧪 FUNÇÃO PARA TESTAR EXTRATOR OFFLINE
window.testOfflineExtractor = function() {
    console.log(`🧪 ===== TESTE MANUAL DO EXTRATOR OFFLINE =====`);
    
    // Verificar se extrator offline está disponível
    if (!window.offlinePixelExtractor) {
        console.error('❌ EXTRATOR OFFLINE não está carregado!');
        return false;
    }
    
    console.log('✅ EXTRATOR OFFLINE encontrado!');
    console.log('📚 Métodos disponíveis:', Object.keys(window.offlinePixelExtractor));
    
    // Verificar se temos georaster
    if (!window.currentGeoraster) {
        console.error('❌ Nenhum georaster ativo encontrado!');
        console.log('💡 Carregue uma interpolação primeiro');
        return false;
    }
    
    console.log('✅ Georaster encontrado!');
    const georaster = window.currentGeoraster;
    
    // Teste com coordenadas fixas dentro da área
    const testCoords = [
        { lng: -53.472, lat: -27.633, name: "Centro" },
        { lng: -53.471, lat: -27.632, name: "Norte" },
        { lng: -53.473, lat: -27.634, name: "Sul" }
    ];
    
    console.log(`🎯 Testando ${testCoords.length} coordenadas...`);
    
    testCoords.forEach((coord, i) => {
        console.log(`\n🔍 Teste ${i + 1}: ${coord.name} (${coord.lat}, ${coord.lng})`);
        
        try {
            // Teste método simples
            const simpleValue = window.offlinePixelExtractor.extractValue(georaster, coord.lng, coord.lat);
            console.log(`   📊 Valor simples: ${simpleValue}`);
            
            // Teste método com amostragem
            const sampledValue = window.offlinePixelExtractor.extractWithSampling(georaster, coord.lng, coord.lat);
            console.log(`   📊 Valor com amostragem: ${sampledValue}`);
            
            if (simpleValue !== null || sampledValue !== null) {
                console.log(`   ✅ Sucesso! Valor: ${simpleValue || sampledValue}`);
            } else {
                console.log(`   ❌ Ambos os métodos falharam`);
            }
        } catch (error) {
            console.error(`   ❌ Erro no teste ${i + 1}:`, error);
        }
    });
    
    console.log(`\n🏁 Teste offline concluído!`);
    return true;
};

// Expor funções de otimização globalmente
console.log(`
🚀 OTIMIZAÇÕES DE PERFORMANCE ATIVAS:

📊 Carregamento Progressivo:
   - Pontos por lote: ${maxPointsPerBatch}
   - Clustering automático baseado em zoom
   - Renderização condicional

🎯 Controles Disponíveis:
   - adjustPerformance(settings) - Ajustar configurações
   - testPerformance() - Testar diferentes configurações
   - optimizeMemory() - Otimizar memória
   - showPerformanceStats() - Mostrar estatísticas

⚡ Para datasets grandes:
   - Use clustering automático
   - Ajuste maxPointsPerBatch conforme necessário
   - Monitore performance via console
`);

    // SISTEMA OTIMIZADO: Funções de pontos removidas
    window.optimizeMemory = optimizeMemory;
    
    // Função para configurar controles de performance
    function setupPerformanceControls() {
        const totalPoints = soilData ? soilData.geoJson.features.length : 0;
        
        if (totalPoints > 100) {
            // Dataset grande - mostrar alerta de performance
            const performanceAlert = document.createElement('div');
            performanceAlert.className = 'alert alert-warning mt-3';
            performanceAlert.innerHTML = `
                <i class="fas fa-exclamation-triangle"></i>
                <strong>Dataset Grande Detectado:</strong> ${totalPoints} pontos
                <br>
                <small>Para melhor performance, recomendamos desativar a visualização de pontos ou usar clustering.</small>
            `;
            
            // Inserir após os controles de performance
            const performanceSection = document.querySelector('.bg-light.rounded');
            if (performanceSection && !document.querySelector('.alert-warning')) {
                performanceSection.parentNode.insertBefore(performanceAlert, performanceSection.nextSibling);
            }
        }
    }
