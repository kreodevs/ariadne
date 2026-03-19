# build — contexto: repo root para tener access a frontend + services/mcp-falkorspec + docs
FROM node:20-alpine AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

ARG VITE_API_URL=http://localhost:3002
ARG VITE_SSO_BASE_URL=
ARG VITE_SSO_APPLICATION_ID=
ARG VITE_SSO_FRONTEND_URL=
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SSO_BASE_URL=$VITE_SSO_BASE_URL
ENV VITE_SSO_APPLICATION_ID=$VITE_SSO_APPLICATION_ID
ENV VITE_SSO_FRONTEND_URL=$VITE_SSO_FRONTEND_URL

# Copiar todo el repo
COPY . .

# 1. Build frontend (usa ../docs para ayuda-mcp.md)
RUN cd frontend && pnpm install --frozen-lockfile && pnpm run build

# 2. ariadne-common debe estar construido para que mcp-falkorspec resuelva file:../../packages/ariadne-common
RUN cd packages/ariadne-common && npm install && npm run build

# 3. Build MCP y generar tarball para npx desde ariadne.kreoint.mx/mcp/ariadne-mcp.tgz
RUN cd services/mcp-falkorspec && npm install && npm run build && npm pack

# 4. Copiar tarball al dist estático del frontend
RUN mkdir -p frontend/dist/mcp && mv services/mcp-falkorspec/ariadne-mcp-*.tgz frontend/dist/mcp/ariadne-mcp.tgz

# serve
FROM nginx:alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
