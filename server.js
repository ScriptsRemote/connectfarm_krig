const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const JSZip = require('jszip');
const shapefile = require('shapefile');
const toGeoJSON = require('@mapbox/togeojson');
const { XMLParser } = require('fast-xml-parser');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));
app.use('/output', express.static('output'));
app.use('/uploads', express.static('uploads'));

// 🎯 NOVO: Endpoint para extrair valor de pixel do TIFF
app.post('/extract-pixel-value', async (req, res) => {
    try {
        const { tiffPath, lat, lng } = req.body;
        
        console.log(`🔍 Extraindo pixel de ${tiffPath} em ${lat}, ${lng}`);
        
        if (!tiffPath || lat === undefined || lng === undefined) {
            return res.status(400).json({ 
                error: 'Parâmetros obrigatórios: tiffPath, lat, lng' 
            });
        }
        
        // Executar script Python para extrair valor
        // Usar python3 em produção (Render/Linux) ou python no Windows
        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
        const pythonProcess = spawn(pythonCmd, [
            'extract_pixel_value.py',
            '--tiff', tiffPath,
            '--lat', lat.toString(),
            '--lng', lng.toString()
        ], {
            cwd: __dirname
        });
        
        let output = '';
        let errorOutput = '';
        
        pythonProcess.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        pythonProcess.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });
        
        pythonProcess.on('close', (code) => {
            if (code === 0 && output.trim()) {
                try {
                    const result = JSON.parse(output.trim());
                    console.log(`✅ Valor extraído: ${result.value}`);
                    res.json(result);
                } catch (parseError) {
                    console.error('❌ Erro ao parsear resultado:', parseError);
                    res.status(500).json({ 
                        error: 'Erro ao processar resultado',
                        output: output.trim()
                    });
                }
            } else {
                console.error('❌ Erro na extração:', errorOutput);
                res.status(500).json({ 
                    error: 'Erro na extração de pixel',
                    details: errorOutput.trim()
                });
            }
        });
        
    } catch (error) {
        console.error('❌ Erro no endpoint:', error);
        res.status(500).json({ 
            error: 'Erro interno do servidor',
            details: error.message
        });
    }
});

// Configuração do multer para upload de arquivos
const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    // Aceitar mais formatos
    if (file.mimetype === 'application/zip' || 
        file.mimetype === 'application/vnd.google-earth.kml+xml' ||
        file.mimetype === 'text/xml' ||
        file.mimetype === 'application/geo+json' ||
        file.originalname.endsWith('.kml') ||
        file.originalname.endsWith('.kmz') ||
        file.originalname.endsWith('.zip') ||
        file.originalname.endsWith('.geojson') ||
        file.originalname.endsWith('.json')) {
      cb(null, true);
    } else {
      cb(new Error('Formato de arquivo não suportado'), false);
    }
  }
});

// Função para calcular área em hectares
function calculateArea(coordinates) {
  let area = 0;
  for (let i = 0; i < coordinates.length - 1; i++) {
    area += coordinates[i][0] * coordinates[i + 1][1];
    area -= coordinates[i + 1][0] * coordinates[i][1];
  }
  area = Math.abs(area) / 2;
  // Converter para hectares (aproximação)
  return area * 111.32 * 111.32 * Math.cos(coordinates[0][1] * Math.PI / 180) / 10000;
}

// Função para gerar grid que intersecta apenas a área de interesse
function generateGrid(bounds, gridSizeHa, areaPolygon) {
  const gridSizeMeters = Math.sqrt(gridSizeHa * 10000); // Converter hectares para metros quadrados
  
  // Calcular número de células baseado nos bounds
  const latDiff = bounds[1][0] - bounds[0][0];
  const lngDiff = bounds[1][1] - bounds[0][1];
  
  // Aproximação: 1 grau ≈ 111.32 km
  const latStep = gridSizeMeters / (111320 * Math.cos(bounds[0][1] * Math.PI / 180));
  const lngStep = gridSizeMeters / 111320;
  
  const numLatCells = Math.ceil(latDiff / latStep);
  const numLngCells = Math.ceil(lngDiff / lngStep);
  
  const grid = [];
  const points = [];
  let id = 1;
  
  for (let i = 0; i < numLatCells; i++) {
    for (let j = 0; j < numLngCells; j++) {
      const minLat = bounds[0][0] + i * latStep;
      const maxLat = bounds[0][0] + (i + 1) * latStep;
      const minLng = bounds[0][1] + j * lngStep;
      const maxLng = bounds[0][1] + (j + 1) * lngStep;
      
      // Criar polígono do grid
      const gridPolygon = {
        type: "Feature",
        properties: {
          id: id,
          gridSize: gridSizeHa,
          area: gridSizeHa
        },
        geometry: {
          type: "Polygon",
          coordinates: [[
            [minLng, minLat],
            [maxLng, minLat],
            [maxLng, maxLat],
            [minLng, maxLat],
            [minLng, minLat]
          ]]
        }
      };
      
      // Verificar se o grid intersecta com a área de interesse
      if (areaPolygon && intersectsPolygon(gridPolygon, areaPolygon)) {
        grid.push(gridPolygon);
        
        // Criar ponto central apenas para grids que intersectam
        const centroid = {
          type: "Feature",
          properties: {
            id: id,
            gridSize: gridSizeHa,
            latitude: (minLat + maxLat) / 2,
            longitude: (minLng + maxLng) / 2
          },
          geometry: {
            type: "Point",
            coordinates: [(minLng + maxLng) / 2, (minLat + maxLat) / 2]
          }
        };
        
        points.push(centroid);
        id++;
      }
    }
  }
  
  return { grid, points };
}

// Função para verificar se dois polígonos se intersectam
function intersectsPolygon(gridPolygon, areaPolygon) {
  // Implementação simples de interseção
  // Em produção, use uma biblioteca como turf.js para cálculos mais precisos
  
  const gridCoords = gridPolygon.geometry.coordinates[0];
  const areaCoords = areaPolygon.geometry.coordinates[0];
  
  // Verificar se pelo menos um ponto do grid está dentro da área
  for (let coord of gridCoords) {
    if (pointInPolygon(coord, areaCoords)) {
      return true;
    }
  }
  
  return false;
}

// Função para verificar se um ponto está dentro de um polígono
function pointInPolygon(point, polygon) {
  const x = point[0];
  const y = point[1];
  let inside = false;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  
  return inside;
}

// Função para processar arquivo KML usando fast-xml-parser
function processKMLFile(filePath, isKMZ = false) {
  try {
    let kmlContent;
    
    if (isKMZ) {
      // Para arquivos KMZ, extrair o KML do ZIP
      const zip = new JSZip();
      const zipContent = fs.readFileSync(filePath);
      
      return zip.loadAsync(zipContent).then(async (zipContent) => {
        // Procurar pelo arquivo .kml dentro do ZIP
        let kmlFile = null;
        for (const [filename, file] of Object.entries(zipContent.files)) {
          if (filename.endsWith('.kml')) {
            kmlFile = file;
            break;
          }
        }
        
        if (!kmlFile) {
          throw new Error('Arquivo .kml não encontrado dentro do KMZ');
        }
        
        // Ler o conteúdo do KML
        kmlContent = await kmlFile.async('string');
        console.log('Conteúdo KML extraído do KMZ (primeiros 200 chars):', kmlContent.substring(0, 200));
        
        return processKMLContent(kmlContent);
      });
    } else {
      // Para arquivos KML normais
      kmlContent = fs.readFileSync(filePath, 'utf8');
      console.log('Conteúdo KML recebido (primeiros 200 chars):', kmlContent.substring(0, 200));
      
      return processKMLContent(kmlContent);
    }
  } catch (error) {
    console.error('Erro ao processar arquivo KML:', error);
    throw error;
  }
}

// Função para processar o conteúdo KML
function processKMLContent(kmlContent) {
  try {
    // Configurar parser XML
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      textNodeName: "#text",
      parseAttributeValue: false,
      parseTagValue: false,
      trimValues: true
    });
    
    // Fazer parse do XML
    const kmlObj = parser.parse(kmlContent);
    console.log('Objeto KML parseado:', JSON.stringify(kmlObj, null, 2));
    
    // Converter para GeoJSON usando toGeoJSON
    // Como toGeoJSON espera um DOM, vamos criar um XML válido
    const cleanKML = kmlContent.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
    const domParser = new (require('@xmldom/xmldom').DOMParser)();
    const kmlDoc = domParser.parseFromString(cleanKML);
    
    const geoJson = toGeoJSON.kml(kmlDoc);
    console.log('GeoJSON gerado:', JSON.stringify(geoJson, null, 2));
    
    return geoJson;
  } catch (error) {
    console.error('Erro ao processar conteúdo KML:', error);
    throw error;
  }
}

// Rota para processar arquivo KML/KMZ
app.post('/upload/kml', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }
    
    console.log('Arquivo recebido:', req.file.originalname, 'Tamanho:', req.file.size, 'bytes');
    console.log('É KMZ?', req.file.originalname.endsWith('.kmz'));
    console.log('Caminho do arquivo:', req.file.path);
    
    // Processar arquivo KML
    console.log('Iniciando processamento do arquivo...');
    const geoJson = await processKMLFile(req.file.path, req.file.originalname.endsWith('.kmz'));
    console.log('GeoJSON processado com sucesso:', typeof geoJson);
    
    // Validar se o GeoJSON foi gerado corretamente
    if (!geoJson || !geoJson.features || geoJson.features.length === 0) {
      throw new Error('Nenhuma geometria válida encontrada no arquivo KML');
    }
    
    console.log('Número de features encontradas:', geoJson.features.length);
    
    // Encontrar a primeira feature com geometria válida
    let validFeature = null;
    for (let feature of geoJson.features) {
      if (feature.geometry && feature.geometry.coordinates && feature.geometry.coordinates.length > 0) {
        validFeature = feature;
        break;
      }
    }
    
    if (!validFeature) {
      throw new Error('Nenhuma geometria válida encontrada no arquivo KML');
    }
    
    console.log('Feature válida encontrada:', JSON.stringify(validFeature, null, 2));
    
    // Calcular bounds baseado no tipo de geometria
    let bounds, coordinates, area;
    
    if (validFeature.geometry.type === 'Polygon') {
      coordinates = validFeature.geometry.coordinates[0];
      bounds = [
        [Math.min(...coordinates.map(c => c[1])), Math.min(...coordinates.map(c => c[0]))],
        [Math.max(...coordinates.map(c => c[1])), Math.max(...coordinates.map(c => c[0]))]
      ];
      area = calculateArea(coordinates);
    } else if (validFeature.geometry.type === 'Point') {
      const coord = validFeature.geometry.coordinates;
      bounds = [
        [coord[1] - 0.001, coord[0] - 0.001],
        [coord[1] + 0.001, coord[0] + 0.001]
      ];
      area = 0.01; // Área mínima para pontos
    } else if (validFeature.geometry.type === 'LineString') {
      coordinates = validFeature.geometry.coordinates;
      bounds = [
        [Math.min(...coordinates.map(c => c[1])), Math.min(...coordinates.map(c => c[0]))],
        [Math.max(...coordinates.map(c => c[1])), Math.max(...coordinates.map(c => c[0]))]
      ];
      area = calculateArea(coordinates);
    } else {
      throw new Error(`Tipo de geometria não suportado: ${validFeature.geometry.type}`);
    }
    
    console.log('Bounds calculados:', bounds);
    console.log('Área calculada:', area);
    
    // Limpar arquivo temporário
    fs.unlinkSync(req.file.path);
    
    res.json({
      success: true,
      geoJson: geoJson,
      bounds: bounds,
      area: area,
      areaPolygon: validFeature.geometry.type === 'Polygon' ? validFeature : null
    });
    
  } catch (error) {
    console.error('Erro ao processar KML:', error);
    
    // Limpar arquivo temporário em caso de erro
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error('Erro ao limpar arquivo temporário:', cleanupError);
      }
    }
    
    res.status(500).json({ error: 'Erro ao processar arquivo KML: ' + error.message });
  }
});

// Rota para processar arquivo GeoJSON
app.post('/upload/geojson', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }
    
    const geoJsonContent = fs.readFileSync(req.file.path, 'utf8');
    const geoJson = JSON.parse(geoJsonContent);
    
    // Validar GeoJSON
    if (!geoJson || !geoJson.features || geoJson.features.length === 0) {
      throw new Error('GeoJSON inválido ou sem features');
    }
    
    // Encontrar primeira feature válida
    let validFeature = null;
    for (let feature of geoJson.features) {
      if (feature.geometry && feature.geometry.coordinates && feature.geometry.coordinates.length > 0) {
        validFeature = feature;
        break;
      }
    }
    
    if (!validFeature) {
      throw new Error('Nenhuma geometria válida encontrada no GeoJSON');
    }
    
    // Calcular bounds
    let bounds, coordinates, area;
    
    if (validFeature.geometry.type === 'Polygon') {
      coordinates = validFeature.geometry.coordinates[0];
      bounds = [
        [Math.min(...coordinates.map(c => c[1])), Math.min(...coordinates.map(c => c[0]))],
        [Math.max(...coordinates.map(c => c[1])), Math.max(...coordinates.map(c => c[0]))]
      ];
      area = calculateArea(coordinates);
    } else if (validFeature.geometry.type === 'Point') {
      const coord = validFeature.geometry.coordinates;
      bounds = [
        [coord[1] - 0.001, coord[0] - 0.001],
        [coord[1] + 0.001, coord[0] + 0.001]
      ];
      area = 0.01;
    } else {
      throw new Error(`Tipo de geometria não suportado: ${validFeature.geometry.type}`);
    }
    
    // Limpar arquivo temporário
    fs.unlinkSync(req.file.path);
    
    res.json({
      success: true,
      geoJson: geoJson,
      bounds: bounds,
      area: area,
      areaPolygon: validFeature.geometry.type === 'Polygon' ? validFeature : null
    });
    
  } catch (error) {
    console.error('Erro ao processar GeoJSON:', error);
    
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error('Erro ao limpar arquivo temporário:', cleanupError);
      }
    }
    
    res.status(500).json({ error: 'Erro ao processar arquivo GeoJSON: ' + error.message });
  }
});

// Rota para processar arquivo ZIP com shapefile
app.post('/upload/shapefile', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }
    
    const zip = new JSZip();
    const zipContent = await zip.loadAsync(fs.readFileSync(req.file.path));
    
    let shpBuffer, dbfBuffer;
    for (const [filename, file] of Object.entries(zipContent.files)) {
      if (filename.endsWith('.shp')) {
        shpBuffer = await file.async('nodebuffer');
      } else if (filename.endsWith('.dbf')) {
        dbfBuffer = await file.async('nodebuffer');
      }
    }
    
    if (!shpBuffer || !dbfBuffer) {
      throw new Error('Arquivos .shp ou .dbf não encontrados no ZIP');
    }
    
    const source = await shapefile.open(shpBuffer, dbfBuffer);
    const features = [];
    
    let result;
    while ((result = await source.read()) && !result.done) {
      features.push(result.value);
    }
    
    if (features.length === 0) {
      throw new Error('Nenhuma feature encontrada no shapefile');
    }
    
    console.log('📊 Features encontradas:', features.length);
    console.log('🎯 Primeira feature:', JSON.stringify(features[0], null, 2));
    
    // 🛡️ Verificação de segurança para geometria
    const firstFeature = features[0];
    if (!firstFeature.geometry) {
      throw new Error('Feature sem geometria encontrada no shapefile');
    }
    
    // Calcular bounds baseado no tipo de geometria
    let bounds, coordinates, area;
    
    if (firstFeature.geometry.type === 'Polygon') {
      if (!firstFeature.geometry.coordinates || !firstFeature.geometry.coordinates[0]) {
        throw new Error('Coordenadas de polígono inválidas no shapefile');
      }
      coordinates = firstFeature.geometry.coordinates[0];
      bounds = [
        [Math.min(...coordinates.map(c => c[1])), Math.min(...coordinates.map(c => c[0]))],
        [Math.max(...coordinates.map(c => c[1])), Math.max(...coordinates.map(c => c[0]))]
      ];
      area = calculateArea(coordinates);
    } else if (firstFeature.geometry.type === 'Point') {
      const coord = firstFeature.geometry.coordinates;
      bounds = [
        [coord[1] - 0.001, coord[0] - 0.001],
        [coord[1] + 0.001, coord[0] + 0.001]
      ];
      coordinates = [coord];
      area = 0.01;
    } else if (firstFeature.geometry.type === 'MultiPolygon') {
      if (!firstFeature.geometry.coordinates || !firstFeature.geometry.coordinates[0] || !firstFeature.geometry.coordinates[0][0]) {
        throw new Error('Coordenadas de multipolígono inválidas no shapefile');
      }
      coordinates = firstFeature.geometry.coordinates[0][0];
      bounds = [
        [Math.min(...coordinates.map(c => c[1])), Math.min(...coordinates.map(c => c[0]))],
        [Math.max(...coordinates.map(c => c[1])), Math.max(...coordinates.map(c => c[0]))]
      ];
      area = calculateArea(coordinates);
    } else {
      throw new Error(`Tipo de geometria não suportado no shapefile: ${firstFeature.geometry.type}`);
    }
    
    console.log('✅ Bounds calculados:', bounds);
    console.log('📐 Área calculada:', area);
    
    // Limpar arquivo temporário
    fs.unlinkSync(req.file.path);
    
    res.json({
      success: true,
      geoJson: { type: 'FeatureCollection', features: features },
      bounds: bounds,
      area: area,
      areaPolygon: firstFeature
    });
    
  } catch (error) {
    console.error('Erro ao processar shapefile:', error);
    
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error('Erro ao limpar arquivo temporário:', cleanupError);
      }
    }
    
    res.status(500).json({ error: 'Erro ao processar arquivo shapefile: ' + error.message });
  }
});

// Rota para gerar grid
app.post('/generate-grid', (req, res) => {
  try {
    const { bounds, gridSize, areaPolygon } = req.body;
    
    if (!bounds || !gridSize) {
      return res.status(400).json({ error: 'Bounds e gridSize são obrigatórios' });
    }
    
    const gridData = generateGrid(bounds, gridSize, areaPolygon);
    
    res.json({
      success: true,
      grid: gridData.grid,
      points: gridData.points
    });
    
  } catch (error) {
    console.error('Erro ao gerar grid:', error);
    res.status(500).json({ error: 'Erro ao gerar grid: ' + error.message });
  }
});

// Rota para exportar como KML
app.post('/export/kml', (req, res) => {
  try {
    const { features, filename } = req.body;
    
    if (!features || !filename) {
      return res.status(400).json({ error: 'Features e filename são obrigatórios' });
    }
    
    let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${filename}</name>`;
    
    features.forEach(feature => {
      if (feature.geometry.type === 'Polygon') {
        const coords = feature.geometry.coordinates[0].map(coord => 
          `${coord[0]},${coord[1]},0`
        ).join(' ');
        
        kml += `
    <Placemark>
      <name>Grid ${feature.properties.id}</name>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${coords}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>`;
      } else if (feature.geometry.type === 'Point') {
                 const coord = feature.geometry.coordinates;
         const lat = coord[1];
         const lng = coord[0];
         
         kml += `
     <Placemark>
       <name>Ponto ${feature.properties.id}</name>
       <description>
         Grid: ${feature.properties.gridSize} ha
         Latitude: ${lat.toFixed(6)}
         Longitude: ${lng.toFixed(6)}
       </description>
       <ExtendedData>
         <Data name="latitude">
           <value>${lat.toFixed(6)}</value>
         </Data>
         <Data name="longitude">
           <value>${lng.toFixed(6)}</value>
         </Data>
         <Data name="gridSize">
           <value>${feature.properties.gridSize}</value>
         </Data>
       </ExtendedData>
       <Point>
         <coordinates>${lng},${lat},0</coordinates>
       </Point>
     </Placemark>`;
      }
    });
    
    kml += `
  </Document>
</kml>`;
    
    res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.kml"`);
    res.send(kml);
    
  } catch (error) {
    console.error('Erro ao exportar KML:', error);
    res.status(500).json({ error: 'Erro ao exportar KML' });
  }
});

// Rota para exportar como shapefile (ZIP)
app.post('/export/shapefile', (req, res) => {
  try {
    const { features, filename, type } = req.body;
    
    if (!features || !filename || !type) {
      return res.status(400).json({ error: 'Features, filename e type são obrigatórios' });
    }
    
    // Criar arquivo ZIP com shapefile
    const zip = new JSZip();
    
    // Calcular bounding box global
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    features.forEach(feature => {
      if (feature.geometry.type === 'Polygon') {
        feature.geometry.coordinates[0].forEach(coord => {
          minX = Math.min(minX, coord[0]);
          minY = Math.min(minY, coord[1]);
          maxX = Math.max(maxX, coord[0]);
          maxY = Math.max(maxY, coord[1]);
        });
      } else if (feature.geometry.type === 'Point') {
        minX = Math.min(minX, feature.geometry.coordinates[0]);
        minY = Math.min(minY, feature.geometry.coordinates[1]);
        maxX = Math.max(maxX, feature.geometry.coordinates[0]);
        maxY = Math.max(maxY, feature.geometry.coordinates[1]);
      }
    });
    
    // Criar arquivo .shp
    const shpBuffer = createShapefileBuffer(features, type, minX, minY, maxX, maxY);
    
    // Criar arquivo .dbf
    const dbfBuffer = createDBFBuffer(features);
    
    // Criar arquivo .shx
    const shxBuffer = createSHXBuffer(features, type, minX, minY, maxX, maxY);
    
    // Adicionar arquivos ao ZIP
    zip.file(`${filename}.shp`, shpBuffer);
    zip.file(`${filename}.dbf`, dbfBuffer);
    zip.file(`${filename}.shx`, shxBuffer);
    zip.file(`${filename}.prj`, 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]');
    
    // Gerar ZIP
    zip.generateAsync({ type: 'nodebuffer' }).then(content => {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.zip"`);
      res.send(content);
    });
    
  } catch (error) {
    console.error('Erro ao exportar shapefile:', error);
    res.status(500).json({ error: 'Erro ao exportar shapefile: ' + error.message });
  }
});

// Função para criar buffer do arquivo .shp
function createShapefileBuffer(features, type, minX, minY, maxX, maxY) {
  let buffer = Buffer.alloc(100); // Header inicial
  
  // File code (9994)
  buffer.writeInt32BE(9994, 0);
  
  // File length (será calculado depois)
  const fileLength = 50 + (features.length * 28);
  buffer.writeInt32BE(fileLength, 24);
  
  // Version (1000)
  buffer.writeInt32LE(1000, 28);
  
  // Shape type (1 = Point, 5 = Polygon)
  const shapeType = type === 'points' ? 1 : 5;
  buffer.writeInt32LE(shapeType, 32);
  
  // Bounding box
  buffer.writeDoubleLE(minX, 36);
  buffer.writeDoubleLE(minY, 44);
  buffer.writeDoubleLE(maxX, 52);
  buffer.writeDoubleLE(maxY, 60);
  
  // Z range (0, 0)
  buffer.writeDoubleLE(0, 68);
  buffer.writeDoubleLE(0, 76);
  
  // M range (0, 0)
  buffer.writeDoubleLE(0, 84);
  buffer.writeDoubleLE(0, 92);
  
  // Records
  features.forEach((feature, index) => {
    const recordHeader = Buffer.alloc(8);
    recordHeader.writeInt32BE(index + 1, 0); // Record number
    recordHeader.writeInt32BE(28, 4); // Content length
    
    const recordBuffer = Buffer.alloc(28);
    
    if (feature.geometry.type === 'Point') {
      // Shape type
      recordBuffer.writeInt32LE(1, 0);
      // X coordinate
      recordBuffer.writeDoubleLE(feature.geometry.coordinates[0], 4);
      // Y coordinate
      recordBuffer.writeDoubleLE(feature.geometry.coordinates[1], 12);
    } else if (feature.geometry.type === 'Polygon') {
      // Shape type
      recordBuffer.writeInt32LE(5, 0);
      // Bounding box
      recordBuffer.writeDoubleLE(minX, 4);
      recordBuffer.writeDoubleLE(minY, 12);
      recordBuffer.writeDoubleLE(maxX, 20);
      recordBuffer.writeDoubleLE(maxY, 28);
      // Number of parts
      recordBuffer.writeInt32LE(1, 36);
      // Number of points
      const numPoints = feature.geometry.coordinates[0].length;
      recordBuffer.writeInt32LE(numPoints, 40);
      // Parts array
      recordBuffer.writeInt32LE(0, 44);
      // Points array
      let pointOffset = 48;
      feature.geometry.coordinates[0].forEach(coord => {
        recordBuffer.writeDoubleLE(coord[0], pointOffset);
        recordBuffer.writeDoubleLE(coord[1], pointOffset + 8);
        pointOffset += 16;
      });
    }
    
    // Concatenar tudo
    const fullRecord = Buffer.concat([recordHeader, recordBuffer]);
    buffer = Buffer.concat([buffer, fullRecord]);
  });
  
  return buffer;
}

// Função para criar buffer do arquivo .dbf
function createDBFBuffer(features) {
  let buffer = Buffer.alloc(32); // Header inicial
  
  // Version (3)
  buffer.writeUInt8(3, 0);
  
  // Date (today)
  const today = new Date();
  buffer.writeUInt8(today.getFullYear() - 1900, 1);
  buffer.writeUInt8(today.getMonth() + 1, 2);
  buffer.writeUInt8(today.getDate(), 3);
  
  // Number of records
  buffer.writeUInt32LE(features.length, 4);
  
  // Header length (32 + field descriptors)
  const headerLength = 32 + (4 * 32) + 1; // 4 fields + terminator
  buffer.writeUInt16LE(headerLength, 8);
  
  // Record length
  buffer.writeUInt16LE(32, 10);
  
  // Field descriptors
  const fields = [
    { name: 'ID', type: 'N', length: 10, decimal: 0 },
    { name: 'GRIDSIZE', type: 'N', length: 10, decimal: 0 },
    { name: 'LATITUDE', type: 'N', length: 15, decimal: 6 },
    { name: 'LONGITUDE', type: 'N', length: 15, decimal: 6 }
  ];
  
  fields.forEach(field => {
    const fieldDesc = Buffer.alloc(32);
    fieldDesc.write(field.name.padEnd(11, '\0'), 0, 11, 'ascii');
    fieldDesc.writeUInt8(field.type.charCodeAt(0), 11);
    fieldDesc.writeUInt32LE(0, 12);
    fieldDesc.writeUInt8(field.length, 16);
    fieldDesc.writeUInt8(field.decimal, 17);
    
    buffer = Buffer.concat([buffer, fieldDesc]);
  });
  
  // Field terminator
  buffer.writeUInt8(0x0D, buffer.length);
  
  // Records
  features.forEach(feature => {
    const record = Buffer.alloc(32);
    record.writeUInt8(0x20, 0); // Deletion flag
    
    // ID
    const id = feature.properties.id.toString().padStart(10, ' ');
    record.write(id, 1, 10, 'ascii');
    
    // Grid Size
    const gridSize = feature.properties.gridSize.toString().padStart(10, ' ');
    record.write(gridSize, 11, 10, 'ascii');
    
    // Latitude
    const lat = feature.properties.latitude || feature.geometry.coordinates[1];
    const latStr = lat.toFixed(6).padStart(15, ' ');
    record.write(latStr, 21, 15, 'ascii');
    
    // Longitude
    const lng = feature.properties.longitude || feature.geometry.coordinates[0];
    const lngStr = lng.toFixed(6).padStart(15, ' ');
    record.write(lngStr, 21, 15, 'ascii');
    
    buffer = Buffer.concat([buffer, record]);
  });
  
  // End of file
  buffer.writeUInt8(0x1A, buffer.length);
  
  return buffer;
}

// Função para criar buffer do arquivo .shx
function createSHXBuffer(features, type, minX, minY, maxX, maxY) {
  let buffer = Buffer.alloc(100); // Header inicial
  
  // File code (9994)
  buffer.writeInt32BE(9994, 0);
  
  // File length
  const fileLength = 50 + (features.length * 4);
  buffer.writeInt32BE(fileLength, 24);
  
  // Version (1000)
  buffer.writeInt32LE(1000, 28);
  
  // Shape type
  const shapeType = type === 'points' ? 1 : 5;
  buffer.writeInt32LE(shapeType, 32);
  
  // Bounding box
  buffer.writeDoubleLE(minX, 36);
  buffer.writeDoubleLE(minY, 44);
  buffer.writeDoubleLE(maxX, 52);
  buffer.writeDoubleLE(maxY, 60);
  
  // Z range (0, 0)
  buffer.writeDoubleLE(0, 68);
  buffer.writeDoubleLE(0, 76);
  
  // M range (0, 0)
  buffer.writeDoubleLE(0, 84);
  buffer.writeDoubleLE(0, 92);
  
  // Index records
  let offset = 50;
  features.forEach((feature, index) => {
    const indexRecord = Buffer.alloc(8);
    indexRecord.writeInt32BE(offset / 2, 0);
    indexRecord.writeInt32BE(28, 4);
    
    buffer = Buffer.concat([buffer, indexRecord]);
    offset += 36; // 8 + 28
  });
  
  return buffer;
}

// Rota para gerar interpolação
app.post('/generate-interpolation', (req, res) => {
  try {
    const { soilData, config } = req.body;
    
    if (!soilData || !config) {
      return res.status(400).json({ error: 'Dados de solo e configuração são obrigatórios' });
    }
    
    console.log('📊 Gerando interpolação:', {
      method: config.method,
      parameters: config.parameters,
      resolution: config.resolution,
      searchRadius: config.searchRadius,
      totalPoints: soilData.geoJson.features.length
    });
    
    // Criar arquivo temporário com os dados GeoJSON
    const tempFile = path.join(__dirname, 'uploads', 'temp_soil_data.geojson');
    fs.writeFileSync(tempFile, JSON.stringify(soilData.geoJson));
    
    // O script Python processa um parâmetro por vez
    // Vamos processar todos os parâmetros sequencialmente
    
    const results = {
      success: true,
      method: config.method,
      bounds: soilData.bounds,
      interpolations: {}
    };
    
    let processedCount = 0;
    
    // Função para processar um parâmetro
    const processParameter = (paramIndex) => {
      if (paramIndex >= config.parameters.length) {
        // Todos os parâmetros foram processados
        console.log('✅ Todas as interpolações concluídas');
        
        // Limpar arquivo temporário
        try {
          fs.unlinkSync(tempFile);
        } catch (e) {
          console.warn('Aviso: não foi possível limpar arquivo temporário');
        }
        
        res.json(results);
        return;
      }
      
      const param = config.parameters[paramIndex];
      console.log(`📊 Processando parâmetro ${paramIndex + 1}/${config.parameters.length}: ${param}`);
      
      const args = [
        'soil_interpolation.py',
        '--input', tempFile,
        '--method', config.method,
        '--parameter', param,
        '--resolution', config.resolution.toString(),
        '--search-radius', config.searchRadius.toString(),
        '--output-dir', 'output'
        // Máscara reativada para evitar extrapolação excessiva
      ];
      
      console.log('🐍 Executando script Python:', args.join(' '));
      console.log('🔍 Plataforma:', process.platform);
      
      // Usar python3 em produção (Render/Linux) ou python no Windows
      const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
      console.log('🐍 Comando Python:', pythonCmd);
      const pythonProcess = spawn(pythonCmd, args, {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
        console.log(`Python stdout (${param}):`, data.toString().trim());
      });
      
      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
        console.log(`Python stderr (${param}):`, data.toString().trim());
      });
      
      pythonProcess.on('error', (error) => {
        console.error(`❌ Erro ao executar Python (${param}):`, error);
        console.error('💡 Verifique se Python3 está instalado no sistema');
        results.interpolations[param] = {
          success: false,
          error: `Erro ao executar Python: ${error.message}`,
          files: { png: false, tiff: false }
        };
        processedCount++;
        processParameter(paramIndex + 1);
      });
      
      pythonProcess.on('close', (code) => {
        console.log(`🏁 Processo Python finalizado (${param}): código ${code}`);
        if (code === 0) {
          console.log(`✅ Interpolação concluída para ${param}`);
          
          // Verificar se os arquivos foram gerados
          const baseFilename = `${param}_${config.method.toLowerCase()}_interpolation`;
          const pngFile = path.join(__dirname, 'output', `${baseFilename}.png`);
          const tiffFile = path.join(__dirname, 'output', `${baseFilename}.tif`);
          
          console.log(`🔍 Verificando arquivos para ${param}:`);
          console.log(`  PNG: ${pngFile} - ${fs.existsSync(pngFile) ? 'EXISTS' : 'NOT FOUND'}`);
          console.log(`  TIFF: ${tiffFile} - ${fs.existsSync(tiffFile) ? 'EXISTS' : 'NOT FOUND'}`);
          
          // Tentar extrair valores reais do output do Python
          let realMin = 0, realMax = 1;
          
          // Procurar por linhas que contenham os valores min/max no output
          const minMatch = stdout.match(/min[=:]\s*([\d\.-]+)/i) || stderr.match(/min[=:]\s*([\d\.-]+)/i);
          const maxMatch = stdout.match(/max[=:]\s*([\d\.-]+)/i) || stderr.match(/max[=:]\s*([\d\.-]+)/i);
          
          if (minMatch) realMin = parseFloat(minMatch[1]);
          if (maxMatch) realMax = parseFloat(maxMatch[1]);
          
          // Se não encontrou nos outputs, tentar extrair das mensagens específicas
          const rangeMatch = (stdout + stderr).match(/valores[^:]*:\s*min[=:]?\s*([\d\.-]+)[^,]*max[=:]?\s*([\d\.-]+)/i);
          if (rangeMatch) {
            realMin = parseFloat(rangeMatch[1]);
            realMax = parseFloat(rangeMatch[2]);
          }
          
          console.log(`📊 Valores extraídos para ${param}: min=${realMin}, max=${realMax}`);
          
          results.interpolations[param] = {
            hasFiles: {
              png: fs.existsSync(pngFile),
              tiff: fs.existsSync(tiffFile)
            },
            statistics: {
              min: realMin,
              max: realMax,
              mean: (realMin + realMax) / 2,
              std: (realMax - realMin) / 4
            },
            min: realMin,
            max: realMax
          };
          
          console.log(`📁 Arquivos para ${param}:`, results.interpolations[param].hasFiles);
          
          // Processar próximo parâmetro
          processParameter(paramIndex + 1);
          
        } else {
          console.error(`❌ Erro na interpolação para ${param}. Código de saída:`, code);
          console.error(`stderr (${param}):`, stderr);
          
          // Limpar arquivo temporário
          try {
            fs.unlinkSync(tempFile);
          } catch (e) {
            console.warn('Aviso: não foi possível limpar arquivo temporário');
          }
          
          res.status(500).json({ 
            error: `Erro ao executar interpolação para ${param}`, 
            details: stderr || 'Erro desconhecido',
            code: code
          });
          return;
        }
      });
      
      pythonProcess.on('error', (err) => {
        console.error(`❌ Erro ao executar Python para ${param}:`, err);
        
        // Limpar arquivo temporário
        try {
          fs.unlinkSync(tempFile);
        } catch (e) {
          console.warn('Aviso: não foi possível limpar arquivo temporário');
        }
        
        res.status(500).json({ 
          error: `Erro ao executar script Python para ${param}`, 
          details: err.message 
        });
      });
    };
    
    // Iniciar processamento do primeiro parâmetro
    processParameter(0);
    
  } catch (error) {
    console.error('❌ Erro na rota de interpolação:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Rota para download de arquivos de interpolação
app.post('/download-interpolation', (req, res) => {
  try {
    const { param, format, method } = req.body;
    
    if (!param || !format || !method) {
      return res.status(400).json({ error: 'Parâmetro, formato e método são obrigatórios' });
    }
    
    const filename = `${param}_${method.toLowerCase()}_interpolation.${format}`;
    
    console.log('📥 Download solicitado:', filename);
    
    // Ajustar extensão - o Python gera .tif, não .tiff
    let actualFormat = format;
    if (format.toLowerCase() === 'tiff') {
      actualFormat = 'tif';
    }
    
    const actualFilename = `${param}_${method.toLowerCase()}_interpolation.${actualFormat}`;
    const actualFilePath = path.join(__dirname, 'output', actualFilename);
    
    console.log('📁 Procurando arquivo:', actualFilePath);
    
    // Definir tipo de conteúdo baseado no formato
    let contentType;
    switch (format.toLowerCase()) {
      case 'png':
        contentType = 'image/png';
        break;
      case 'tiff':
      case 'tif':
        contentType = 'image/tiff';
        break;
      case 'geojson':
        contentType = 'application/geo+json';
        break;
      default:
        contentType = 'application/octet-stream';
    }
    
    if (!fs.existsSync(actualFilePath)) {
      console.error('❌ Arquivo não encontrado:', actualFilePath);
      return res.status(404).json({ error: 'Arquivo não encontrado' });
    }
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    const fileStream = fs.createReadStream(actualFilePath);
    fileStream.pipe(res);
    
    fileStream.on('error', (err) => {
      console.error('❌ Erro ao ler arquivo:', err);
      res.status(500).json({ error: 'Erro ao ler arquivo' });
    });
    
    console.log('✅ Download iniciado:', actualFilename);
    
  } catch (error) {
    console.error('❌ Erro na rota de download:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 📁 Rota para exportar GeoJSON (FALTAVA!)
app.post('/export/geojson', (req, res) => {
  try {
    const { features, filename } = req.body;
    
    if (!features || !filename) {
      return res.status(400).json({ error: 'Features e filename são obrigatórios' });
    }
    
    if (!Array.isArray(features) || features.length === 0) {
      return res.status(400).json({ error: 'Features deve ser um array não vazio' });
    }
    
    console.log('📁 Exportando GeoJSON:', filename, '- Features:', features.length);
    
    // 🔧 Limpar e validar features para evitar corrupção
    const cleanFeatures = features.map((feature, index) => {
      try {
        // Criar feature limpa
        const cleanFeature = {
          type: 'Feature',
          properties: {},
          geometry: null
        };
        
        // Limpar propriedades (remover null, undefined, NaN)
        if (feature.properties && typeof feature.properties === 'object') {
          Object.keys(feature.properties).forEach(key => {
            const value = feature.properties[key];
            if (value !== null && value !== undefined && !Number.isNaN(value)) {
              cleanFeature.properties[key] = value;
            } else {
              // Substituir valores problemáticos
              if (typeof value === 'number' && Number.isNaN(value)) {
                cleanFeature.properties[key] = 0;
              } else if (value === null || value === undefined) {
                cleanFeature.properties[key] = '';
              }
            }
          });
        }
        
        // Limpar geometria
        if (feature.geometry && feature.geometry.type && feature.geometry.coordinates) {
          cleanFeature.geometry = {
            type: feature.geometry.type,
            coordinates: feature.geometry.coordinates
          };
          
          // Validar coordenadas para evitar NaN
          if (Array.isArray(feature.geometry.coordinates)) {
            const validateCoords = (coords) => {
              if (Array.isArray(coords[0])) {
                return coords.map(validateCoords);
              } else {
                return coords.map(coord => {
                  if (typeof coord === 'number' && !Number.isNaN(coord)) {
                    return coord;
                  } else {
                    console.warn(`⚠️ Coordenada inválida corrigida: ${coord} → 0`);
                    return 0;
                  }
                });
              }
            };
            
            cleanFeature.geometry.coordinates = validateCoords(feature.geometry.coordinates);
          }
        }
        
        return cleanFeature;
      } catch (cleanError) {
        console.warn(`⚠️ Erro ao limpar feature ${index}:`, cleanError.message);
        // Retornar feature mínima válida
        return {
          type: 'Feature',
          properties: { id: index },
          geometry: {
            type: 'Point',
            coordinates: [0, 0]
          }
        };
      }
    });
    
    // Criar GeoJSON válido
    const geoJson = {
      type: 'FeatureCollection',
      name: filename,
      crs: {
        type: 'name',
        properties: {
          name: 'urn:ogc:def:crs:OGC:1.3:CRS84'
        }
      },
      features: cleanFeatures
    };
    
    // Converter para string JSON com formatação
    const geoJsonString = JSON.stringify(geoJson, null, 2);
    
    // Verificar se a string foi criada corretamente
    if (!geoJsonString || geoJsonString.length === 0) {
      throw new Error('Falha ao serializar GeoJSON');
    }
    
    // Verificar se contém valores problemáticos
    if (geoJsonString.includes('null') && geoJsonString.includes('"null"')) {
      console.warn('⚠️ GeoJSON contém valores null - pode estar corrompido');
    }
    
    console.log('📏 Tamanho do arquivo:', geoJsonString.length, 'caracteres');
    
    // Configurar headers para download
    res.setHeader('Content-Type', 'application/geo+json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.geojson"`);
    res.setHeader('Content-Length', Buffer.byteLength(geoJsonString, 'utf8'));
    
    // Enviar o arquivo
    res.send(geoJsonString);
    
    console.log('✅ GeoJSON exportado com sucesso:', filename);
    
  } catch (error) {
    console.error('❌ Erro ao exportar GeoJSON:', error);
    res.status(500).json({ error: 'Erro ao exportar GeoJSON: ' + error.message });
  }
});

// Rota principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Acesse: http://localhost:3000`);
});
