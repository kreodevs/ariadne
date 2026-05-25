# build — contexto: repo root para tener access a frontend + services/mcp-ariadne + docs
FROM node:20-alpine AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

# Debe apuntar al API Nest (3000), no a ingest (3002). En Compose se pasa build-arg desde .env.
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL

# Copiar todo el repo (incluye docs/ para ayuda-mcp.md)
COPY . .

# Forzar fresh build cada deploy: escribe fecha + nano siempre único
RUN echo $(date +%s%N) > /tmp/buildstamp.$(uname -n) && head -c 16 /dev/urandom | base64 > /tmp/buildstamp

# 1. Build frontend
RUN cd frontend && pnpm install --frozen-lockfile && pnpm run build

# 2. ariadne-common debe estar construido para que mcp-ariadne resuelva file:../../packages/ariadne-common
RUN cd packages/ariadne-common && npm install && npm run build

# 3. Build MCP y generar tarball para npx desde ariadne.kreoint.mx/mcp/ariadne-mcp.tgz
RUN cd services/mcp-ariadne && npm install && npm run build && npm pack

# 4. Copiar tarball al dist estático del frontend
RUN mkdir -p frontend/dist/mcp && mv services/mcp-ariadne/ariadne-mcp-*.tgz frontend/dist/mcp/ariadne-mcp.tgz

# serve
FROM nginx:alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
