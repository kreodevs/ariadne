# FalkorSpecs MCP Server — Streamable HTTP para producción (Dokploy)
# Build desde la raíz del repo: docker build -f services/mcp-falkorspec/Dockerfile .

FROM node:20-alpine AS builder

WORKDIR /app

# ariadne-common: dependencia local file:../../packages/ariadne-common
COPY packages/ariadne-common/package.json packages/ariadne-common/tsconfig.json /packages/ariadne-common/
COPY packages/ariadne-common/src /packages/ariadne-common/src
RUN cd /packages/ariadne-common && npm install && npm run build

# package-lock.json está en .gitignore; no se copia para no fallar en deploy
COPY services/mcp-falkorspec/package.json ./
COPY services/mcp-falkorspec/tsconfig.json ./
COPY services/mcp-falkorspec/src ./src

# npm install (no ci) para que funcione aunque package-lock.json no esté en el contexto de build
RUN npm install --ignore-scripts && npm run build

# Imagen final — solo prod
FROM node:20-alpine

WORKDIR /app

# ariadne-common debe existir para que npm install resuelva file:../../packages/ariadne-common
COPY --from=builder /packages/ariadne-common /packages/ariadne-common
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
RUN npm install --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=8080

# Obligatorio para Docker: bind 0.0.0.0 para recibir tráfico externo
EXPOSE 8080

USER node

CMD ["node", "dist/index.js"]
