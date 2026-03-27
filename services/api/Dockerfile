# Build desde la raíz del repo: docker build -f services/api/Dockerfile .
FROM node:20-alpine

WORKDIR /app

# ariadne-common: file:../../packages/ariadne-common en package.json → debe existir en /packages/ariadne-common
COPY packages/ariadne-common/package.json packages/ariadne-common/tsconfig.json /packages/ariadne-common/
COPY packages/ariadne-common/src /packages/ariadne-common/src
RUN cd /packages/ariadne-common && npm install && npm run build

COPY services/api/package.json ./
RUN npm install

COPY services/api/tsconfig.json services/api/nest-cli.json ./
COPY services/api/src ./src
RUN npm run build && npm prune --omit=dev

ENV PORT=3000
ENV NODE_ENV=production

CMD ["node", "dist/main.js"]
