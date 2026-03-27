# FalkorSpecs API (NestJS + OpenAPI 3.1)

Módulo 3 de la constitución: API REST para consultar el grafo de impacto. Migrado a NestJS.

## Endpoints

- **GET /graph/impact/:nodeId** — Qué archivos/componentes se verían afectados al modificar el nodo.
- **GET /graph/component/:name?depth=2** — Dependencias directas e indirectas del componente.
- **GET /graph/contract/:componentName** — Props y firma del componente.
- **GET /graph/compare/:componentName** — Compara props main vs shadow. Query opcional `shadowSessionId` (mismo valor que devuelve POST /shadow); sin él se lee el grafo legacy `FalkorSpecsShadow`.
- **POST /graph/shadow** — Proxy al ingest: indexa en `FalkorSpecsShadow:<sesión>`. Body: `{ files: [{ path, content }], shadowSessionId?: string }`. Respuesta incluye `shadowSessionId` y `shadowGraphName`.
- **GET /openapi.json** — Especificación OpenAPI 3.1.
- **GET /health** — Health check.

## Variables de entorno

- `FALKORDB_HOST`, `FALKORDB_PORT` — Conexión a FalkorDB.
- `REDIS_URL` — Redis para caché (opcional).
- `INGEST_URL` — URL del microservicio ingest para POST /graph/shadow (default `http://ingest:3002` en Docker).
- `PORT` — Puerto HTTP (default 3000).
