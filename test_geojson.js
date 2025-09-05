#!/usr/bin/env node

// 🧪 Teste para validar exportação de GeoJSON

const fs = require('fs');
const path = require('path');

// Dados de exemplo para teste
const testFeatures = [
    {
        type: 'Feature',
        properties: {
            id: 1,
            gridSize: 2,
            latitude: -27.6321,
            longitude: -53.4701
        },
        geometry: {
            type: 'Point',
            coordinates: [-53.4701, -27.6321]
        }
    },
    {
        type: 'Feature',
        properties: {
            id: 2,
            gridSize: 2,
            latitude: -27.6341,
            longitude: -53.4721
        },
        geometry: {
            type: 'Point',
            coordinates: [-53.4721, -27.6341]
        }
    }
];

// Testar função de criação de GeoJSON
function createGeoJSON(features, filename) {
    const geoJson = {
        type: 'FeatureCollection',
        name: filename,
        crs: {
            type: 'name',
            properties: {
                name: 'urn:ogc:def:crs:OGC:1.3:CRS84'
            }
        },
        features: features
    };
    
    return geoJson;
}

// Validar GeoJSON
function validateGeoJSON(geoJson) {
    const errors = [];
    
    if (!geoJson.type || geoJson.type !== 'FeatureCollection') {
        errors.push('Tipo deve ser FeatureCollection');
    }
    
    if (!geoJson.features || !Array.isArray(geoJson.features)) {
        errors.push('Features deve ser um array');
    }
    
    if (geoJson.features && geoJson.features.length === 0) {
        errors.push('Features não pode estar vazio');
    }
    
    geoJson.features?.forEach((feature, index) => {
        if (!feature.type || feature.type !== 'Feature') {
            errors.push(`Feature ${index}: tipo deve ser Feature`);
        }
        
        if (!feature.geometry) {
            errors.push(`Feature ${index}: geometria obrigatória`);
        }
        
        if (!feature.properties) {
            errors.push(`Feature ${index}: propriedades obrigatórias`);
        }
        
        if (feature.geometry && !feature.geometry.type) {
            errors.push(`Feature ${index}: tipo de geometria obrigatório`);
        }
        
        if (feature.geometry && !feature.geometry.coordinates) {
            errors.push(`Feature ${index}: coordenadas obrigatórias`);
        }
    });
    
    return errors;
}

// Executar teste
function runTest() {
    console.log('🧪 === TESTE DE VALIDAÇÃO GEOJSON ===\n');
    
    console.log('📋 Dados de teste:');
    console.log(`   Features: ${testFeatures.length}`);
    console.log(`   Primeira feature: Point(${testFeatures[0].geometry.coordinates.join(', ')})`);
    console.log('');
    
    // Criar GeoJSON
    console.log('🔧 Criando GeoJSON...');
    const geoJson = createGeoJSON(testFeatures, 'teste_malha');
    console.log('   ✅ GeoJSON criado');
    console.log('');
    
    // Validar estrutura
    console.log('🔍 Validando estrutura...');
    const errors = validateGeoJSON(geoJson);
    
    if (errors.length === 0) {
        console.log('   ✅ Estrutura válida');
    } else {
        console.log('   ❌ Erros encontrados:');
        errors.forEach(error => console.log(`      - ${error}`));
    }
    console.log('');
    
    // Converter para string
    console.log('📝 Convertendo para string...');
    try {
        const geoJsonString = JSON.stringify(geoJson, null, 2);
        console.log(`   ✅ String criada: ${geoJsonString.length} caracteres`);
        
        // Salvar arquivo de teste
        const testFile = path.join(__dirname, 'test_output.geojson');
        fs.writeFileSync(testFile, geoJsonString);
        console.log(`   ✅ Arquivo salvo: ${testFile}`);
        
        // Tentar recarregar
        const reloaded = JSON.parse(fs.readFileSync(testFile, 'utf8'));
        console.log(`   ✅ Arquivo recarregado: ${reloaded.features.length} features`);
        
        // Limpar arquivo de teste
        fs.unlinkSync(testFile);
        console.log('   ✅ Arquivo de teste removido');
        
    } catch (error) {
        console.log(`   ❌ Erro na conversão: ${error.message}`);
    }
    console.log('');
    
    // Testar caso problemático
    console.log('🔥 Testando caso problemático...');
    const problematicFeatures = [
        {
            type: 'Feature',
            properties: {
                id: null, // propriedade nula
                gridSize: undefined // propriedade indefinida
            },
            geometry: {
                type: 'Point',
                coordinates: [NaN, -27.6321] // coordenada inválida
            }
        }
    ];
    
    try {
        const problematicGeoJson = createGeoJSON(problematicFeatures, 'teste_problematico');
        const problematicString = JSON.stringify(problematicGeoJson, null, 2);
        
        console.log('   ⚠️ GeoJSON problemático criado (pode causar corrupção)');
        console.log('   📝 Conteúdo problemático:');
        console.log('      - Propriedade null/undefined');
        console.log('      - Coordenada NaN');
        
        // Verificar se contém valores problemáticos
        if (problematicString.includes('null') || 
            problematicString.includes('undefined') || 
            problematicString.includes('NaN')) {
            console.log('   ❌ Contém valores que podem corromper o arquivo!');
        }
        
    } catch (error) {
        console.log(`   ❌ Erro esperado: ${error.message}`);
    }
    console.log('');
    
    console.log('🎯 Recomendações:');
    console.log('   1. Validar todas as propriedades antes de criar GeoJSON');
    console.log('   2. Remover/substituir valores null, undefined, NaN');
    console.log('   3. Verificar coordenadas válidas');
    console.log('   4. Testar encoding UTF-8 no servidor');
    console.log('   5. Verificar Content-Type correto no response');
    console.log('');
    
    console.log('✅ Teste concluído!');
}

// Executar se chamado diretamente
if (require.main === module) {
    runTest();
}

module.exports = { createGeoJSON, validateGeoJSON, runTest };
