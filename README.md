# Ariadne / AriadneSpecs

Arquitectura: **Ingest** (repos remotos + sync) + **FalkorDB** (grafo) + **Chat/Analysis** (NL→Cypher + diagnósticos) + **MCP** (herramientas para la IA).

## Deployment

- **ariadne.kreoint.mx** — Frontend + API (un solo dominio; rutas `/repositories`, `/graph/*` enrutadas internamente)

Ver [docs/DEPLOYMENT_DOKPLOY.md](docs/DEPLOYMENT_DOKPLOY.md).

## Servicios

- **falkordb** — Base de datos de grafos (puerto 6379).
- **ingest** — Sync repos, webhooks, shadow `POST /shadow`, índice FalkorDB (sin cartographer separado).
- **redis** — Cola BullMQ (sync) y caché (puerto 6380).
- **postgres** — Repos, sync_jobs, indexed_files, credentials (puerto 5432).
- **ingest** — NestJS: repos Bitbucket/GitHub, full sync, resync, webhook, **Chat** (NL→Cypher), **Análisis** (diagnóstico, duplicados, reingeniería), embed-index automático (puerto 3002). Ver [docs/bitbucket_webhook.md](docs/bitbucket_webhook.md).
- **api** — REST NestJS: impacto, componente, contrato, compare, shadow (puerto 3000).
- **orchestrator** — NestJS + LangGraph: validación SDD (puerto 3001).
- **mcp-ariadne** — MCP stdio: `get_component_graph`, `get_legacy_impact`, `get_contract_specs`, `semantic_search`, `get_file_content`, `validate_before_edit`, `get_project_analysis`.
- **frontend** — React+Vite: repos, credenciales, detalle, **Chat con repo** (preguntas NL, diagnósticos, índice FalkorDB), resync (puerto 5173).

## Uso con Docker

1. Coloca el código a analizar en `./src` (o monta otro directorio).
2. Levanta el stack:
   - **Con Colima (local):** `pnpm run docker:up` o `pnpm run dev:infra` — usa `docker-compose.yml` + `docker-compose.dev.yml` (expone puertos para conectar desde el host).
   - **Sin script (local):** `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`.
   - **Producción (sin puertos expuestos):** `docker compose -f docker-compose.yml up -d`.
   - Para omitir el script: `SKIP_ENSURE_DOCKER=1 <comando>`.
   - Para bajar el stack y parar Colima: `pnpm run docker:down` o `npm run docker:down`.
3. El Cartographer corre al iniciar e indexa una vez. mcp-ariadne se ejecuta con stdio (para Cursor, configura el MCP apuntando al `node dist/index.js` del servicio mcp-ariadne).

## Documentación

- [ariadne-common](docs/ariadne-common.md) — Paquete compartido (FalkorDB/Cypher) entre ingest y MCP; uso y **deployment**.
- [Arquitectura](docs/architecture.md)
- [Motor de indexado](docs/indexing_engine.md)
- [Chat y Análisis](docs/CHAT_Y_ANALISIS.md) — Flujo NL→Cypher, diagnósticos, antipatrones, métricas
- [Especificación MCP](docs/mcp_server_specs.md)
- [Esquema DB y Cypher](docs/db_schema.md)
- [Manual de uso](docs/manual/README.md) — Puesta en marcha, endpoints, troubleshooting

## Flujo para desarrollo local

Infraestructura (una vez): pnpm run dev:infra

- Inicia Colima si hace falta
- Sube falkordb, postgres, redis en Docker (ingest/API en el mismo compose)
- No arranca api, ingest ni orchestrator
- Servicios en local (una terminal por servicio):
  - pnpm run dev:api — API (puerto 3000) con watch
  - pnpm run dev:ingest — Ingest (puerto 3002) con watch
  - pnpm run dev:orchestrator — Orchestrator (puerto 3001) con watch
- Orden sugerido
  - pnpm run dev:infra
  - pnpm run dev:ingest (en otra terminal)
  - pnpm run dev:api (en otra terminal)
  - pnpm run dev:orchestrator (en otra terminal)
  - pnpm run dev:front (en otra terminal)
