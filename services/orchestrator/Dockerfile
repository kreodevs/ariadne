FROM node:20-alpine

WORKDIR /app

# ariadne-common: file:../../packages/ariadne-common en package.json → debe existir en /packages/ariadne-common
COPY packages/ariadne-common/package.json packages/ariadne-common/tsconfig.json /packages/ariadne-common/
COPY packages/ariadne-common/src /packages/ariadne-common/src
RUN cd /packages/ariadne-common && npm install && npm run build

COPY services/orchestrator/package.json ./
RUN npm install

COPY services/orchestrator/tsconfig.json services/orchestrator/nest-cli.json ./
COPY services/orchestrator/src ./src
RUN npm run build && npm prune --omit=dev

ENV PORT=3001
ENV NODE_ENV=production
ENV FALKORSPEC_API_URL=http://api:3000

EXPOSE 3001
CMD ["node", "dist/main.js"]
