# Manual de uso y validación — Ariadne / FalkorSpecs

Este manual describe cómo poner en marcha, usar y validar el monorepo Ariadne (FalkorSpecs): ingesta de repositorios, API de grafo, orquestador, servidor MCP y frontend de administración.

> **Configuración detallada:** Para variables de entorno, credenciales (Bitbucket/GitHub), webhook, MCP y troubleshooting, ver [CONFIGURACION_Y_USO.md](CONFIGURACION_Y_USO.md).

## 1. Introducción y arquitectura mínima

**Ariadne / FalkorSpecs** mantiene un grafo de conocimiento del código (FalkorDB) a partir de análisis estático (Tree-sitter): dependencias entre archivos, componentes, props, hooks y llamadas entre funciones. La ingesta se hace desde repositorios remotos (Bitbucket/GitHub) con full sync y webhooks; credenciales en BD (cifradas) o variables de entorno; la API y el servidor MCP exponen impacto, contratos y contexto para la IA; el orquestador ejecuta flujos de validación (SDD) para refactors.

| Componente | Función |
|------------|--------|
| **Ingest** | Registro de repos, credenciales cifradas en BD, full sync (cola Redis), webhook Bitbucket, índice shadow. NestJS + TypeORM + PostgreSQL + FalkorDB + Redis. |
| **API** | REST OpenAPI: impacto, componente, contrato, compare, proxy shadow. NestJS + FalkorDB + Redis (caché). |
| **Orchestrator** | Flujos LangGraph: refactor por `nodeId`, validación con props propuestas, pipeline completo (shadow + compare). NestJS. |
| **MCP FalkorSpecs** | Servidor MCP por Streamable HTTP (puerto 8080): herramientas de grafo para la IA (get_component_graph, get_legacy_impact, etc.). |
| **Frontend** | UI para ingest: listado de repos, alta (Bitbucket/GitHub), credenciales, detalle, sync manual, jobs, **Chat** (preguntas NL, diagnósticos), **resync**. React + Vite. |
| **Cartographer** | Legacy: vigilancia de directorio local y `POST /shadow`; el ingest asume full sync + webhook. |

Diagrama y detalle en [architecture.md](../architecture.md).

## 2. Requisitos

- **Node.js** >= 20 (todos los servicios).
- **Docker** (y opcionalmente **Colima** en macOS para los scripts de la raíz).
- Servicios de datos: **FalkorDB** (puerto 6379), **PostgreSQL** (5432), **Redis** (6379). En Docker Compose ya están definidos en [docker-compose.yml](../../docker-compose.yml).

## 3. Puesta en marcha

### Con Docker (recomendado)

Desde la raíz del repo:

```bash
npm run docker:up
```

Esto ejecuta [scripts/ensure-docker.js](../../scripts/ensure-docker.js): arranca Colima (si aplica) y luego `docker-compose up -d --build`. Para omitir el chequeo de Colima: `SKIP_ENSURE_DOCKER=1 npm run docker:up` (o levantar tú mismo los contenedores).

Para bajar el stack y Colima:

```bash
npm run docker:down
```

Usa [scripts/colima-stop.js](../../scripts/colima-stop.js) (`docker-compose down` + `colima stop`).

**Puertos expuestos (host):**

| Servicio | Puerto |
|----------|--------|
| API | 3000 |
| Ingest | 3002 |
| Orchestrator | 3001 |
| Frontend | 5173 |
| FalkorDB | 6379 |
| Postgres | 5432 |
| Redis | 6380 |

### Sin Docker (local)

Levantar FalkorDB, PostgreSQL y Redis por tu cuenta (binarios o contenedores sueltos). Luego, en cada carpeta de servicio, usar las variables de entorno necesarias y:

- **Ingest:** `cd services/ingest && npm run build && npm run start` (o `nest start --watch` en dev).
- **API:** `cd services/api && npm run dev` (o `npm run start`).
- **Orchestrator:** `cd services/orchestrator && npm run start` (o `nest start --watch`).
- **MCP:** `cd services/mcp-falkorspec && npm run build && PORT=8080 node dist/index.js` (Streamable HTTP).
- **Frontend:** `cd frontend && npm run dev`.

#### Variables de entorno por servicio

- **Ingest:** `PORT` (3002), `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `FALKORDB_HOST`, `FALKORDB_PORT`, `REDIS_URL` (cola sync). Opcional: `CREDENTIALS_ENCRYPTION_KEY` (si usas credenciales en BD), `BITBUCKET_*`, `GITHUB_TOKEN` (fallback).
- **API:** `PORT` (3000), `FALKORDB_HOST`, `FALKORDB_PORT`, `REDIS_URL`. Opcional: `INGEST_URL`, `CARTOGRAPHER_URL` para el proxy de shadow (default ingest, fallback cartographer).
- **Orchestrator:** `PORT` (3001), `FALKORSPEC_API_URL` (default `http://api:3000` en Docker).
- **MCP:** `FALKORDB_HOST`, `FALKORDB_PORT`.
- **Frontend:** `VITE_API_URL` (default `http://localhost:3002`, URL del ingest).

## 4. Uso por componente

### Ingest (puerto 3002)

- **Registrar repositorio:** `POST /repositories`  
  Body: `{ "provider": "bitbucket"|"github", "projectKey": "<workspace|owner>", "repoSlug": "<repo>", "defaultBranch": "main", "credentialsRef": "<uuid>" }` (opcional).
- **Contenido de archivo:** `GET /repositories/:id/file?path=src/App.tsx&ref=main` — devuelve `{ content }` desde Bitbucket/GitHub.
- **Embedding para RAG:** `GET /embed?text=` — devuelve `{ embedding }` (requiere EMBEDDING_PROVIDER + OPENAI_API_KEY o GOOGLE_API_KEY).
- **Indexar embeddings:** `POST /repositories/:id/embed-index` — indexa Function y Component con vectores (FalkorDB 4.0+). Si cambias de proveedor (OpenAI ↔ Google), reejecuta este endpoint: las dimensiones son distintas (1536 vs 768).
- **Credenciales:** `GET /credentials`, `POST /credentials`, `DELETE /credentials/:id`. Tokens cifrados en BD.
- **Listar:** `GET /repositories`.
- **Detalle:** `GET /repositories/:id`.
- **Jobs de sync:** `GET /repositories/:id/jobs`.
- **Full sync:** `POST /repositories/:id/sync` → `{ jobId, queued: true }`. El job se procesa en cola Redis; el grafo se actualiza en FalkorDB al completar.
- **Re-sincronizar todo:** `POST /repositories/:id/resync` → borra el grafo e índice del proyecto y encola un sync completo. Útil para empezar de cero.

Tras cada sync (normal o resync), se ejecuta automáticamente el indexado de embeddings si EMBEDDING_PROVIDER está configurado; si no, se omite sin error.

**Chat y análisis:** `POST /repositories/:id/chat` con `{ message, history? }` — preguntas NL → Cypher → FalkorDB. `POST /repositories/:id/analyze` con `{ mode: 'diagnostico'|'duplicados'|'reingenieria' }` — diagnóstico (top riesgo, antipatrones), duplicados (embeddings), plan de reingeniería. Requiere `OPENAI_API_KEY`.
**Métricas y anti-patrones:** El parser calcula complejidad ciclomática (McCabe), LOC, anidamiento (nestingDepth) y acoplamiento. El diagnóstico detecta: código spaguetti (nesting>4), God functions (acoplamiento>8), alto fan-in (shotgun surgery), imports circulares, componentes sobrecargados.
- **Webhook Bitbucket:** `POST /webhooks/bitbucket`. Evento esperado: `repo:push`. Secret desde credencial en BD (kind=webhook_secret) o `BITBUCKET_WEBHOOK_SECRET`. Ver [bitbucket_webhook.md](../bitbucket_webhook.md).
- **Shadow (índice en grafo shadow):** `POST /shadow` con body `{ "files": [ { "path": "ruta/archivo.ts", "content": "código..." } ] }`.

### API (puerto 3000)

- **Impacto:** `GET /graph/impact/:nodeId` — dependientes del nodo (quién lo llama o lo renderiza).
- **Componente:** `GET /graph/component/:name?depth=2` — dependencias del componente hasta `depth` (1–10).
- **Contrato:** `GET /graph/contract/:componentName` — props del componente (HAS_PROP).
- **Compare:** `GET /graph/compare/:componentName` — comparación props grafo principal vs shadow (tras indexar código propuesto).
- **Manual:** `GET /graph/manual?projectId=` — genera markdown con proyectos, componentes, descripciones (JSDoc) y props.
- **Shadow (proxy):** `POST /graph/shadow` con body `{ "files": [ { "path", "content" } ] }` — reenvía al ingest o cartographer.
- **Health:** `GET /health` → `{ "status": "ok" }`.

### Orchestrator (puerto 3001)

- **Flujo refactor por nodeId:** `GET /workflow/refactor/:nodeId` — ejecuta impacto + contratos + comparación de props; devuelve estado (approved, impactDependents, contractProps, etc.).
- **Validar con props propuestas:** `POST /workflow/refactor/validate` con body `{ "nodeId": "...", "proposedProps": [ { "name": "...", "required": true } ] }`.
- **Pipeline completo (shadow + compare):** `POST /workflow/refactor/full` con body `{ "nodeId", "filePath?", "currentCode?", "proposedProps?", "proposedCode?" }`.

### MCP FalkorSpecs

Servidor por **Streamable HTTP** (puerto 8080, path /mcp). Para usarlo en Cursor: arranca `PORT=8080 node dist/index.js` (tras `npm run build`) con `FALKORDB_HOST`, `FALKORDB_PORT`, `INGEST_URL`, y configura `url`: `http://localhost:8080/mcp` en el cliente MCP.

Herramientas expuestas:

- **get_component_graph** — Árbol de dependencias de un componente (`componentName`, `depth` opcional).
- **get_legacy_impact** — Qué componentes/funciones se ven afectados si se modifica el nodo (`nodeName`).
- **get_contract_specs** — Props y firma del componente (`componentName`, `projectId`, `currentFilePath` opcionales).
- **get_functions_in_file** — Funciones y componentes en un archivo (`path`, `projectId`, `currentFilePath` opcionales).
- **get_import_graph** — Imports y contenido del archivo (`filePath`, `projectId`, `currentFilePath` opcionales).
- **get_file_content** — Contenido de un archivo del repo (`path`, `projectId`, `currentFilePath`, `ref`). Requiere INGEST_URL.
- **validate_before_edit** — OBLIGATORIO antes de editar: devuelve impacto + contrato en un solo llamado.
- **semantic_search** — Búsqueda por palabra clave en componentes, funciones y archivos (`query`, `projectId`, `limit`).

### Frontend

En `frontend/`: `npm run dev` (puerto 5173 por defecto). Asegura que `VITE_API_URL` apunte al ingest (por defecto `http://localhost:3002`; en producción la URL pública del ingest).

- **Rutas:** `/` lista de repos; `/repos/new` alta (Bitbucket/GitHub, selector de credencial); `/repos/:id` detalle, Sync, Resync, jobs; `/repos/:id/chat` Chat (preguntas NL, diagnósticos, duplicados, reingeniería); `/credentials` y `/credentials/new` gestión de credenciales.
- **Build:** `npm run build`; **preview:** `npm run preview` para servir `dist/` localmente.

## 5. Validación

### Tests automáticos

- **API:** En `services/api`: `npm run test` (Vitest). Incluye smoke de rutas graph ([services/api/src/routes/graph.test.ts](../../services/api/src/routes/graph.test.ts)).
- **Orchestrator:** En `services/orchestrator`: `npm run test` (Vitest). Tests de [WorkflowService](../../services/orchestrator/src/workflow/workflow.service.spec.ts) con mocks de `fetch` (impacto, contratos, approved/not approved).

No hay tests E2E en el repo; la validación completa es manual.

### Comprobación rápida tras Docker

1. **Health API:** `curl http://localhost:3000/health` → `{"status":"ok"}`.
2. **Ingest:** Crear un repo desde el frontend (`/repos/new`) o con `curl -X POST http://localhost:3002/repositories -H "Content-Type: application/json" -d '{"provider":"bitbucket","projectKey":"TU_WORKSPACE","repoSlug":"tu-repo","defaultBranch":"main"}'`.
3. **Sync:** Desde la UI en `/repos/:id` pulsar Sync o `POST http://localhost:3002/repositories/:id/sync`.
4. **Grafo:** Si hay datos indexados, probar `GET http://localhost:3000/graph/impact/AlgunComponente` o `GET http://localhost:3000/graph/component/AlgunComponente`.
5. **MCP:** Configurar el servidor MCP en el IDE y llamar a una herramienta (p. ej. `get_legacy_impact` con un `nodeName` existente en el grafo).

## 6. Referencias

- [CONFIGURACION_Y_USO.md](CONFIGURACION_Y_USO.md) — Configuración detallada, credenciales, troubleshooting.
- [docs/README.md](../README.md) — Índice de documentación.
- [architecture.md](../architecture.md) — Stack y flujos del sistema.
- [bitbucket_webhook.md](../bitbucket_webhook.md) — Configuración del webhook Bitbucket.
- [db_schema.md](../db_schema.md) — Esquema del grafo FalkorDB (nodos, relaciones).
- [indexing_engine.md](../indexing_engine.md) — Pipeline de indexación y fuentes.
