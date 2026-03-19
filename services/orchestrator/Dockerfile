FROM node:20-alpine

WORKDIR /app

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
