# 🌱 ConnectFarm - Dockerfile para Produção

# Usar imagem base com Node.js e Python
FROM node:18-bullseye

# Definir diretório de trabalho
WORKDIR /app

# Instalar dependências do sistema e Python
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-dev \
    python3-venv \
    gdal-bin \
    libgdal-dev \
    proj-bin \
    libproj-dev \
    libgeos-dev \
    libspatialindex-dev \
    && rm -rf /var/lib/apt/lists/*

# Copiar arquivos de dependências
COPY package*.json ./
COPY requirements.txt ./

# Instalar dependências Node.js
RUN npm ci --only=production

# Instalar dependências Python
RUN pip3 install --no-cache-dir -r requirements.txt

# Copiar código fonte
COPY . .

# Criar diretórios necessários
RUN mkdir -p uploads output logs && \
    chmod 755 uploads output logs

# Definir variáveis de ambiente
ENV NODE_ENV=production
ENV PORT=3000

# Expor porta
EXPOSE 3000

# Comando de inicialização
CMD ["node", "server.js"]

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/ || exit 1
