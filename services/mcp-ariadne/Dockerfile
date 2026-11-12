# syntax=docker/dockerfile:1.4
# AriadneSpecs MCP Server — Streamable HTTP para producción (Dokploy)
# Build desde la raíz del repo: docker build -f services/mcp-ariadne/Dockerfile .
# Export tarball (frontend dist/mcp): --target mcp-export

FROM node:20-alpine AS ariadne-common-local
WORKDIR /packages/ariadne-common
COPY packages/ariadne-common/package.json packages/ariadne-common/tsconfig.json ./
COPY packages/ariadne-common/src ./src
RUN --mount=type=cache,target=/root/.npm \
    npm install && npm run build

ARG ARIADNE_COMMON_IMAGE
FROM ${ARIADNE_COMMON_IMAGE:-ariadne-common-local} AS ariadne-common

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=ariadne-common /packages/ariadne-common /packages/ariadne-common
COPY services/mcp-ariadne/package.json services/mcp-ariadne/tsconfig.json ./
COPY services/mcp-ariadne/src ./src
COPY services/mcp-ariadne/scripts ./scripts
RUN --mount=type=cache,target=/root/.npm \
    npm install --ignore-scripts && npm run build

# Tarball estático para frontend (dist/mcp/) — evita recompilar MCP en frontend/Dockerfile
FROM builder AS mcp-export
RUN npm pack && mkdir -p /export && mv *.tgz /export/ariadne-mcp.tgz

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=builder /packages/ariadne-common /packages/ariadne-common
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm install --omit=dev --ignore-scripts
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

EXPOSE 8080
USER node
CMD ["node", "dist/index.js"]
