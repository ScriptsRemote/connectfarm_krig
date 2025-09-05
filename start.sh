#!/bin/bash

# 🚀 ConnectFarm - Script de Inicialização para Produção

echo "🌱 Iniciando ConnectFarm em produção..."

# Criar diretórios necessários
mkdir -p uploads
mkdir -p output
mkdir -p logs

# Definir permissões
chmod 755 uploads
chmod 755 output
chmod 755 logs

# Verificar se Python está disponível
if command -v python3 &> /dev/null; then
    echo "✅ Python3 encontrado: $(python3 --version)"
else
    echo "❌ Python3 não encontrado! Tentando instalar..."
    apt-get update && apt-get install -y python3 python3-pip
fi

# Verificar dependências Python
echo "🔍 Verificando dependências Python..."
python3 -c "import geopandas, rasterio, numpy, scipy, sklearn, matplotlib, pykrige" 2>/dev/null
if [ $? -eq 0 ]; then
    echo "✅ Dependências Python OK"
else
    echo "⚠️ Instalando dependências Python..."
    pip3 install -r requirements.txt
fi

# Configurar variáveis de ambiente
export NODE_ENV=production
export PORT=${PORT:-3000}

echo "🚀 Iniciando servidor Node.js na porta $PORT..."
node server.js
