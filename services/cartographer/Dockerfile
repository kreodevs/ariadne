# Build desde la raíz del repo: docker build -f services/cartographer/Dockerfile .
FROM node:20-alpine

WORKDIR /app

# tree-sitter y tree-sitter-* requieren compilación nativa
RUN apk add --no-cache python3 make g++

# ariadne-common: dependencia local file:../../packages/ariadne-common
COPY packages/ariadne-common/package.json packages/ariadne-common/tsconfig.json /packages/ariadne-common/
COPY packages/ariadne-common/src /packages/ariadne-common/src
RUN cd /packages/ariadne-common && npm install && npm run build

COPY services/cartographer/package.json ./
RUN npm install

COPY services/cartographer/tsconfig.json ./
COPY services/cartographer/src ./src
RUN npm run build && npm prune --omit=dev

ENV SCAN_PATH=/app/src-to-analyze
ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
