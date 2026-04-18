# FalkorSpecs API (NestJS + OpenAPI 3.1)

Módulo 3 de la constitución: API REST para consultar el grafo de impacto (FalkorDB) y **gateway** hacia el ingest para la UI (proyectos, repos, credenciales, **dominios**).

## Proxy al ingest (prefijo `/api`)

El `main.ts` enruta hacia **`INGEST_URL`** (default `http://localhost:3002`) con reescritura `^/api` → ``:

- `/api/projects`, `/api/repositories`, `/api/credentials`, `/api/providers`, `/api/webhooks`, **`/api/domains`**

Así el frontend usa un solo origen (`VITE_API_URL` → API :3000) y obtiene también `GET /api/projects/:id/architecture/c4`, `GET /api/projects/:id/graph-routing`, dependencias de dominio, etc.

## Endpoints (grafo Falkor / shadow)

- **GET /graph/impact/:nodeId** — Qué archivos/componentes se verían afectados al modificar el nodo.
- **GET /graph/component/:name?depth=2** — Dependencias directas e indirectas del componente.
- **GET /graph/contract/:componentName** — Props y firma del componente.
- **GET /graph/compare/:componentName** — Compara props main vs shadow. Query opcional `shadowSessionId` (mismo valor que devuelve POST /shadow); sin él se lee el grafo legacy `FalkorSpecsShadow`.
- **POST /graph/shadow** — Proxy al ingest: indexa en `FalkorSpecsShadow:<sesión>`. Body: `{ files: [{ path, content }], shadowSessionId?: string }`. Respuesta incluye `shadowSessionId` y `shadowGraphName`.
- **GET /openapi.json** — Especificación OpenAPI 3.1.
- **GET /health** — Health check.

## Autenticación

Este servicio **no implementa SSO ni OIDC**. Las rutas HTTP van sin login propio; en producción suele colocarse detrás de un reverse proxy o API gateway (Traefik, Cloudflare Access, etc.) si hace falta auth para usuarios. Las credenciales de Bitbucket/GitHub viven en **ingest** (cifrado en Postgres) para el worker de sync, no sustituyen auth en esta API REST.

## Variables de entorno

- `FALKORDB_HOST`, `FALKORDB_PORT` — Conexión a FalkorDB.
- `REDIS_URL` — Redis para caché (opcional).
- `INGEST_URL` — URL del microservicio ingest para POST /graph/shadow (default `http://ingest:3002` en Docker).
- `PORT` — Puerto HTTP (default 3000).
