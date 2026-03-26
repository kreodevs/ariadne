# Servicios Ariadne

El **frontend** (UI admin del ingest) es un proyecto independiente en la raíz del repo: `./frontend`. El resto vive en esta carpeta `services/`.

| Servicio       | Puerto | Responsabilidad |
|----------------|--------|-----------------|
| **frontend**   | 5173 | UI admin del ingest: repos, sync, jobs. React + Vite. *(código en `../frontend`)* |
| **api**        | 3000 | API REST (OpenAPI 3.1): `/graph/impact`, `/graph/component`, `/graph/contract`, `/graph/compare`, proxy `POST /graph/shadow` → ingest. |
| **ingest**     | 3002 | Sync Bitbucket/GitHub, webhook, `POST /shadow`, Prisma/tsconfig en pipeline → FalkorDB. NestJS + TypeORM + PostgreSQL. |
| **orchestrator** | 3001 | Orquestador NestJS + LangGraph. |
| **mcp-ariadne** | — | Servidor MCP (stdio). Consultas al grafo para IA. |

Infra (docker-compose): **falkordb** (6379), **postgres** (5432), **redis** (6380 en host).

## Cómo levantar

- **Todo con Docker:** desde la raíz del repo: `npm run docker:up` (o `docker-compose up -d --build`).
- **Solo infra:** `docker-compose up -d falkordb postgres redis`.
- **Un servicio en local:** p. ej. `cd services/ingest && npm run start` (requiere Postgres y FalkorDB accesibles). Frontend: `cd frontend && npm run dev`.

Cada servicio tiene su propio `README.md` y `package.json` en su carpeta; el frontend en `frontend/`.
