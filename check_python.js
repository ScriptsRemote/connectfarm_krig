#!/usr/bin/env node

// 🔍 Script para verificar configuração Python em produção

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔍 === DIAGNÓSTICO PYTHON CONNECTFARM ===\n');

// 1. Verificar informações do sistema
console.log('📋 Informações do Sistema:');
console.log(`   Plataforma: ${process.platform}`);
console.log(`   Arquitetura: ${process.arch}`);
console.log(`   Node.js: ${process.version}`);
console.log(`   Diretório: ${process.cwd()}\n`);

// 2. Verificar comandos Python disponíveis
const pythonCommands = ['python', 'python3', 'py'];

async function checkPythonCommand(cmd) {
    return new Promise((resolve) => {
        const proc = spawn(cmd, ['--version'], { stdio: 'pipe' });
        let output = '';
        
        proc.stdout.on('data', (data) => output += data.toString());
        proc.stderr.on('data', (data) => output += data.toString());
        
        proc.on('close', (code) => {
            if (code === 0) {
                resolve({ cmd, version: output.trim(), available: true });
            } else {
                resolve({ cmd, available: false });
            }
        });
        
        proc.on('error', () => {
            resolve({ cmd, available: false });
        });
    });
}

async function checkPythonAvailability() {
    console.log('🐍 Verificando comandos Python disponíveis:');
    
    for (const cmd of pythonCommands) {
        const result = await checkPythonCommand(cmd);
        if (result.available) {
            console.log(`   ✅ ${cmd}: ${result.version}`);
        } else {
            console.log(`   ❌ ${cmd}: não disponível`);
        }
    }
    console.log('');
}

// 3. Verificar arquivos Python
function checkPythonFiles() {
    console.log('📁 Verificando scripts Python:');
    
    const pythonFiles = [
        'soil_interpolation.py',
        'extract_pixel_value.py',
        'requirements.txt'
    ];
    
    pythonFiles.forEach(file => {
        if (fs.existsSync(file)) {
            const stats = fs.statSync(file);
            console.log(`   ✅ ${file} (${Math.round(stats.size / 1024)}KB)`);
        } else {
            console.log(`   ❌ ${file}: não encontrado`);
        }
    });
    console.log('');
}

// 4. Verificar diretórios necessários
function checkDirectories() {
    console.log('📂 Verificando diretórios:');
    
    const dirs = ['uploads', 'output', 'public'];
    
    dirs.forEach(dir => {
        if (fs.existsSync(dir)) {
            console.log(`   ✅ ${dir}/`);
        } else {
            console.log(`   ❌ ${dir}/: não encontrado`);
            try {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`   🔧 ${dir}/: criado`);
            } catch (e) {
                console.log(`   ❌ ${dir}/: erro ao criar - ${e.message}`);
            }
        }
    });
    console.log('');
}

// 5. Testar importação de bibliotecas Python
async function testPythonImports() {
    console.log('📚 Testando importação de bibliotecas Python:');
    
    const libs = [
        'numpy', 'pandas', 'geopandas', 'rasterio', 
        'scipy', 'sklearn', 'matplotlib', 'pykrige'
    ];
    
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    
    for (const lib of libs) {
        try {
            const result = await new Promise((resolve) => {
                const proc = spawn(pythonCmd, ['-c', `import ${lib}; print('${lib} OK')`], { stdio: 'pipe' });
                let output = '';
                let error = '';
                
                proc.stdout.on('data', (data) => output += data.toString());
                proc.stderr.on('data', (data) => error += data.toString());
                
                proc.on('close', (code) => {
                    resolve({ success: code === 0, output, error });
                });
                
                proc.on('error', (err) => {
                    resolve({ success: false, error: err.message });
                });
            });
            
            if (result.success) {
                console.log(`   ✅ ${lib}`);
            } else {
                console.log(`   ❌ ${lib}: ${result.error || 'erro de importação'}`);
            }
        } catch (e) {
            console.log(`   ❌ ${lib}: ${e.message}`);
        }
    }
    console.log('');
}

// 6. Executar diagnóstico completo
async function runDiagnosis() {
    await checkPythonAvailability();
    checkPythonFiles();
    checkDirectories();
    await testPythonImports();
    
    console.log('🎯 Recomendações:');
    console.log('   1. Use python3 em produção (Linux/Render)');
    console.log('   2. Verifique se requirements.txt está atualizado');
    console.log('   3. Certifique-se que os diretórios existem');
    console.log('   4. Monitore logs do servidor para erros Python\n');
    
    console.log('✅ Diagnóstico concluído!');
}

// Executar se chamado diretamente
if (require.main === module) {
    runDiagnosis().catch(console.error);
}

module.exports = { checkPythonAvailability, checkPythonFiles, checkDirectories, testPythonImports };
