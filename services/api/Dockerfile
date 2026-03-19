FROM node:20-alpine

WORKDIR /app

COPY services/api/package.json ./
RUN npm install

COPY services/api/tsconfig.json services/api/nest-cli.json ./
COPY services/api/src ./src
RUN npm run build && npm prune --omit=dev

ENV PORT=3000
ENV NODE_ENV=production

CMD ["node", "dist/main.js"]
