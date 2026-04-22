# Ariadne / AriadneSpecs

Arquitectura: **Ingest** (repos remotos + sync) + **PostgreSQL** (metadatos: repos, proyectos, **dominios de arquitectura**, whitelist proyecto→dominio) + **FalkorDB** (grafo particionado por proyecto/dominio; shadow SDD) + **Chat/Analysis** (NL→Cypher + diagnósticos) + **MCP** (herramientas para la IA) + **gobierno C4** (DSL PlantUML, preview en frontend).

## Deployment

- **ariadne.kreoint.mx** — Frontend + API (un solo dominio; rutas `/repositories`, `/graph/*` enrutadas internamente)

Ver [docs/notebooklm/DEPLOYMENT_DOKPLOY.md](docs/notebooklm/DEPLOYMENT_DOKPLOY.md).

## Servicios

- **falkordb** — Base de datos de grafos (puerto 6379).
- **ingest** — Sync repos, webhooks, shadow `POST /shadow`, índice FalkorDB (sin cartographer separado).
- **redis** — Cola BullMQ (sync) y caché (puerto 6380).
- **postgres** — Repos, sync_jobs, indexed_files, credentials (puerto 5432).
- **ingest** — NestJS: repos Bitbucket/GitHub, full sync, resync, webhook, **alcance de indexado por repo** (`index_include_rules` / UI editar repo), **Chat** (NL→Cypher), **Análisis** (diagnóstico, duplicados, reingeniería), embed-index automático (puerto 3002). Ver [docs/notebooklm/bitbucket_webhook.md](docs/notebooklm/bitbucket_webhook.md) y [MONOREPO_Y_LIMITACIONES_INDEXADO.md](docs/notebooklm/MONOREPO_Y_LIMITACIONES_INDEXADO.md).
- **api** — REST NestJS: impacto, componente, contrato, compare, shadow (puerto 3000).
- **orchestrator** — NestJS + LangGraph: validación SDD (puerto 3001).
- **mcp-ariadne** — MCP stdio: `get_component_graph`, `get_legacy_impact`, `get_contract_specs`, `semantic_search`, `get_file_content`, `validate_before_edit`, `get_project_analysis`.
- **frontend** — React+Vite: proyectos, repos, **dominios** (CRUD), detalle de proyecto (**pestaña Arquitectura**: dominio, dependencias cruzadas, **C4** vía Kroki), credenciales, **Chat con repo**, índice FalkorDB, resync (puerto 5173).

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

- [ariadne-common](packages/ariadne-common/README.md) — Paquete compartido (FalkorDB/Cypher) entre ingest y MCP; uso y **deployment**. (Notas largas: [docs/notebooklm/ariadne-common.md](docs/notebooklm/ariadne-common.md).)
- [Arquitectura](docs/notebooklm/architecture.md)
- [Motor de indexado](docs/notebooklm/indexing_engine.md)
- [Chat y Análisis](docs/notebooklm/CHAT_Y_ANALISIS.md) — Flujo NL→Cypher, diagnósticos, antipatrones, métricas (el retriever usa **cypherShardContexts** del ingest cuando hay whitelist de dominios)
- [Especificación MCP](docs/notebooklm/mcp_server_specs.md)
- [Esquema DB y Cypher](docs/notebooklm/db_schema.md)
- [Manual de uso](docs/manual/README.md) — Puesta en marcha, endpoints, troubleshooting
- [Caché de análisis en ingest](docs/notebooklm/plan-analyze-layer-cache.md) — LRU, Redis, capa extrínseca CALL
- [Capas del diagnóstico](docs/notebooklm/diagnostico-layer-dependencies.md) — intrínseca vs extrínseca
- [Tests (Vitest / Playwright)](docs/notebooklm/TESTING.md)

## Versionado (semver)

- Historial de producto: [CHANGELOG.md](CHANGELOG.md).
- En un **release**, alinear el campo `version` de `package.json` en la raíz, `packages/ariadne-common`, `services/ingest`, `services/api`, `services/mcp-ariadne` y `frontend` cuando el cambio forme parte del mismo entregable. Cada servicio sigue teniendo su propia imagen Docker; el número semver y el CHANGELOG documentan compatibilidad y notas de migración.

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
