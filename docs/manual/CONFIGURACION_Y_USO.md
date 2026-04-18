# Manual de Configuración y Uso — Ariadne / AriadneSpecs

Guía completa para configurar y usar el sistema: variables de entorno, credenciales, puesta en marcha, flujos de trabajo y consultas.

---

## 1. Configuración

### 1.1 Requisitos

| Requisito      | Versión / Nota                                                           |
| -------------- | ------------------------------------------------------------------------ |
| Node.js        | ≥ 20                                                                     |
| Docker         | Para levantar el stack completo                                          |
| Colima (macOS) | Opcional; `scripts/ensure-docker.js` lo arranca si no hay Docker Desktop |

### 1.2 Variables de entorno

#### Servicio Ingest (puerto 3002)

| Variable                            | Obligatoria | Default                | Descripción                                                                                                      |
| ----------------------------------- | ----------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `PORT`                              | No          | 3002                   | Puerto HTTP                                                                                                      |
| `PGHOST`                            | Sí\*        | localhost              | PostgreSQL host                                                                                                  |
| `PGPORT`                            | Sí\*        | 5432                   | PostgreSQL puerto                                                                                                |
| `PGUSER`                            | Sí\*        | falkorspecs            | Usuario PostgreSQL                                                                                               |
| `PGPASSWORD`                        | Sí\*        | falkorspecs            | Contraseña PostgreSQL                                                                                            |
| `PGDATABASE`                        | Sí\*        | falkorspecs            | Base de datos                                                                                                    |
| `FALKORDB_HOST`                     | Sí\*        | localhost              | FalkorDB host                                                                                                    |
| `FALKORDB_PORT`                     | Sí\*        | 6379                   | FalkorDB puerto                                                                                                  |
| `REDIS_URL`                         | Sí\*        | redis://localhost:6380 | Redis para cola de sync (BullMQ)                                                                                 |
| `BITBUCKET_TOKEN`                   | Condicional | —                      | Token OAuth Bitbucket                                                                                            |
| `BITBUCKET_APP_PASSWORD`            | Condicional | —                      | App Password Bitbucket                                                                                           |
| `BITBUCKET_USER`                    | Condicional | —                      | Usuario Bitbucket (con App Password)                                                                             |
| `GITHUB_TOKEN`                      | Condicional | —                      | PAT GitHub (provider=github). Fallback si no hay credencial en BD.                                               |
| `BITBUCKET_WEBHOOK_SECRET`          | Condicional | —                      | Secret webhook. Fallback si no hay credencial en BD.                                                             |
| `CREDENTIALS_ENCRYPTION_KEY`        | Condicional | —                      | Clave para cifrar credenciales en BD. Base64 32 bytes o hex 64 chars. Ej: `openssl rand -base64 32`.             |
| `EMBEDDING_PROVIDER`                | Condicional | openai                 | RAG: `openai` o `google`                                                                                         |
| `OPENAI_API_KEY`                    | Condicional | —                      | API key OpenAI: chat, diagnósticos/analyze y (si provider=openai) embeddings. **Obligatorio** para chat/analyze. |
| `CHAT_MODEL`                        | Condicional | gpt-4o-mini            | Modelo OpenAI para chat                                                                                          |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | Condicional | —                      | API key Google AI (si provider=google). Para `gemini-embedding-001` (768 dims).                                  |
| `NODE_ENV`                          | No          | development            | Si ≠ production, TypeORM usa synchronize                                                                         |

\* En Docker las variables vienen del compose; en local hay que definirlas.

**Embeddings (RAG):** ejemplos de configuración:

```bash
# OpenAI (default, 1536 dims)
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=sk-xxx

# Google (768 dims)
EMBEDDING_PROVIDER=google
GOOGLE_API_KEY=xxx
# o GEMINI_API_KEY=xxx
```

**Importante:** Cada proveedor usa una dimensión distinta (OpenAI 1536, Google 768). Si cambias de proveedor, debes ejecutar de nuevo `POST /repositories/:id/embed-index` para reindexar con la nueva dimensión; los índices vectoriales de FalkorDB no son compatibles entre proveedores.

#### Servicio API (puerto 3000)

| Variable           | Obligatoria | Default                | Descripción                             |
| ------------------ | ----------- | ---------------------- | --------------------------------------- |
| `PORT`             | No          | 3000                   | Puerto HTTP                             |
| `FALKORDB_HOST`    | Sí          | localhost              | FalkorDB host                           |
| `FALKORDB_PORT`    | Sí          | 6379                   | FalkorDB puerto                         |
| `REDIS_URL`        | Sí          | redis://localhost:6380 | Redis (caché)                           |
| `INGEST_URL`       | No          | `http://localhost:3002` (Docker: `http://ingest:3002`) | URL del ingest: **proxy shadow** y reenvío de `/api/projects`, `/api/repositories`, `/api/credentials`, `/api/domains`, … (pathRewrite quita `/api`). |
| `CARTOGRAPHER_URL` | No          | —                      | Fallback shadow si ingest no disponible |

#### Orchestrator (puerto 3001)

| Variable             | Obligatoria | Default         | Descripción   |
| -------------------- | ----------- | --------------- | ------------- |
| `PORT`               | No          | 3001            | Puerto HTTP   |
| `FALKORSPEC_API_URL` | No          | http://api:3000 | URL de la API |

#### MCP AriadneSpecs (Streamable HTTP)

| Variable         | Obligatoria | Default               | Descripción                                         |
| ---------------- | ----------- | --------------------- | --------------------------------------------------- |
| `PORT`           | No          | 8080                  | Puerto del servidor HTTP                            |
| `FALKORDB_HOST`  | Sí          | localhost             | FalkorDB host                                       |
| `FALKORDB_PORT`  | Sí          | 6379                  | FalkorDB puerto                                     |
| `INGEST_URL`     | No          | http://localhost:3002 | **Obligatorio** para routing completo: `get_file_content`, listados, **`GET /projects/:id/graph-routing`** (`cypherShardContexts`, whitelist de dominios). Sin esto, el MCP cae a heurísticas locales. |
| `MCP_AUTH_TOKEN` | No          | —                     | Si está definido: exige Bearer token en peticiones  |

#### Frontend (puerto 5173)

| Variable       | Obligatoria | Default               | Descripción             |
| -------------- | ----------- | --------------------- | ----------------------- |
| `VITE_API_URL` | No          | `http://localhost:3000` o `http://localhost:3002` | Base URL del backend: **API :3000** (recomendado: rutas `/api/*` unificadas + OTP) o **ingest :3002** directo. |

---

### 1.3 Credenciales: BD (recomendado) o variables de entorno

Las credenciales pueden guardarse en la **base de datos** (cifradas) o en variables de entorno.

#### Opción A: Credenciales en BD (cifradas)

1. Definir la clave de cifrado:

   ```bash
   # Generar clave (32 bytes base64)
   openssl rand -base64 32
   # Añadir a .env o docker-compose
   CREDENTIALS_ENCRYPTION_KEY=<resultado>
   ```

2. En el frontend: **Credenciales** → **+ Nueva credencial**.
   - Provider: Bitbucket o GitHub.
   - Tipo: Token, App Password o Webhook Secret.
   - Valor: el token/password/secret (nunca se muestra después).
   - Para App Password: usuario de Bitbucket.

3. Al crear un repo, elegir la credencial en el desplegable.

4. Webhook secret: crear credencial tipo "Webhook Secret" para Bitbucket.

#### Permisos requeridos — Bitbucket (App Password o API Token)

Para que el formulario de alta de repositorio liste workspaces, repos y branches, y para sync y webhook incremental, la credencial de Bitbucket debe tener estos permisos (marcar al crear el App Password en Bitbucket → Personal settings → App passwords):

| Permiso                  | Nivel | Uso                                                      |
| ------------------------ | ----- | -------------------------------------------------------- |
| **Account**              | Read  | Listar workspaces del usuario                            |
| **Workspace membership** | Read  | Listar workspaces (desplegable en alta de repo)          |
| **Repositories**         | Read  | Listar repos, branches, archivos; clone; diff por commit |
| **Projects**             | Read  | Opcional; algunos planes lo incluyen con Repositories    |

Sin **Account: Read** y **Workspace membership: Read** obtendrás 403 al listar workspaces. **Repositories: Read** es obligatorio para sync y lectura de archivos.

#### Opción B: Variables de entorno (legacy)

- **Bitbucket:** `BITBUCKET_USER`, `BITBUCKET_APP_PASSWORD` o `BITBUCKET_TOKEN`
- **GitHub:** `GITHUB_TOKEN` o `GH_TOKEN`
- **Webhook:** `BITBUCKET_WEBHOOK_SECRET`

Si el repo tiene `credentialsRef` se usa la credencial de BD; si no, las variables de entorno.

---

### 1.4 Docker: puesta en marcha

```bash
# Levantar todo (Colima + compose)
npm run docker:up

# Sin chequeo de Colima
SKIP_ENSURE_DOCKER=1 npm run docker:up

# Bajar stack y Colima
npm run docker:down
```

**Puertos en host:**

| Servicio     | Puerto |
| ------------ | ------ |
| API          | 3000   |
| Ingest       | 3002   |
| Orchestrator | 3001   |
| Frontend     | 5173   |
| FalkorDB     | 6379   |
| PostgreSQL   | 5432   |
| Redis        | 6380   |

**Credenciales en Docker:** crear un `.env` en la raíz o usar override:

```yaml
# docker-compose.override.yml (ejemplo)
services:
  ingest:
    environment:
      - CREDENTIALS_ENCRYPTION_KEY=${CREDENTIALS_ENCRYPTION_KEY}
      - EMBEDDING_PROVIDER=${EMBEDDING_PROVIDER:-openai}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - GOOGLE_API_KEY=${GOOGLE_API_KEY}
      # O variables de entorno legacy:
      - BITBUCKET_USER=${BITBUCKET_USER}
      - BITBUCKET_APP_PASSWORD=${BITBUCKET_APP_PASSWORD}
      - BITBUCKET_WEBHOOK_SECRET=${BITBUCKET_WEBHOOK_SECRET}
```

Para credenciales en BD, solo necesitas `CREDENTIALS_ENCRYPTION_KEY`; el resto se gestiona desde el frontend. Para RAG con embeddings (`GET /embed`, `POST /repositories/:id/embed-index`), configura `EMBEDDING_PROVIDER=openai|google` y la API key correspondiente. Si cambias de proveedor, reejecuta `embed-index` (dimensiones distintas: OpenAI 1536, Google 768).

---

### 1.5 Entorno local (sin Docker)

1. Levantar PostgreSQL, FalkorDB y Redis (contenedores o binarios).
2. Crear base de datos:
   ```bash
   createdb -U postgres falkorspecs
   # o con usuario falkorspecs
   ```
3. Ejecutar migraciones del ingest:
   ```bash
   cd services/ingest
   PGHOST=localhost PGPORT=5432 PGUSER=falkorspecs PGPASSWORD=falkorspecs PGDATABASE=falkorspecs npm run migration:run
   ```
4. Arrancar servicios en orden:

   ```bash
   # Terminal 1 - Ingest
   cd services/ingest && npm run start

   # Terminal 2 - API
   cd services/api && npm run dev

   # Terminal 3 - Orchestrator
   cd services/orchestrator && npm run start

   # Terminal 4 - Frontend
   cd frontend && npm run dev
   ```

5. MCP: configurar en el IDE (ver 2.6).

---

### 1.6 Webhook Bitbucket

1. Bitbucket → Repository settings → Webhooks → Add webhook.
2. **Title:** p. ej. "Ariadne Ingest".
3. **URL:** `https://<tu-host>/webhooks/bitbucket`
   - Local: usar ngrok o similar: `https://xxxx.ngrok.io/webhooks/bitbucket`.
4. **Triggers:** Repository push.
5. **Secret:** mismo valor que `BITBUCKET_WEBHOOK_SECRET` en el ingest.

Ver [bitbucket_webhook.md](../notebooklm/bitbucket_webhook.md) para más detalle.

---

## 2. Uso

### 2.1 Registrar repositorios

**Bitbucket:**

```bash
curl -X POST http://localhost:3002/repositories \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "bitbucket",
    "projectKey": "TU_WORKSPACE",
    "repoSlug": "nombre-repo",
    "defaultBranch": "main"
  }'
```

**GitHub:**

```bash
curl -X POST http://localhost:3002/repositories \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "github",
    "projectKey": "owner-org",
    "repoSlug": "nombre-repo",
    "defaultBranch": "main"
  }'
```

| Campo      | Bitbucket       | GitHub               |
| ---------- | --------------- | -------------------- |
| projectKey | Workspace       | Owner o organización |
| repoSlug   | Nombre del repo | Nombre del repo      |

---

### 2.2 Full sync e ingesta

1. Listar repos:

   ```bash
   curl http://localhost:3002/repositories
   ```

2. Disparar sync (el job se encola en Redis):

   ```bash
   curl -X POST http://localhost:3002/repositories/<UUID>/sync
   ```

   Respuesta: `{ "jobId": "...", "queued": true }`

3. Ver jobs de un repo:

   ```bash
   curl http://localhost:3002/repositories/<UUID>/jobs
   ```

4. Estado del repo:
   ```bash
   curl http://localhost:3002/repositories/<UUID>
   ```

---

### 2.3 Chat y análisis (ingest)

| Recurso        | Método | Descripción |
| -------------- | ---------------------------------------- | ----------- |
| Chat           | `POST /repositories/:id/chat`            | NL → Cypher → FalkorDB. Body: `{ message, history?, scope?, twoPhase?, responseMode? }` |
| Chat proyecto  | `POST /projects/:projectId/chat`         | Igual; agrega todos los repos del proyecto en el contexto. |
| Análisis repo  | `POST /repositories/:id/analyze`         | `id` = repo. Body: `{ mode: 'diagnostico' \| 'duplicados' \| 'reingenieria' \| 'codigo_muerto' \| 'seguridad' }` |
| Análisis proyecto | `POST /projects/:projectId/analyze`   | Modos de código como arriba + opcional `idePath` / `repositoryId` si hay multi-root; o `mode: 'agents' \| 'skill'`. |
| Resumen grafo  | `GET /repositories/:id/graph-summary`    | Conteos y muestras de nodos indexados |

Requieren `OPENAI_API_KEY`. Ver [CHAT_Y_ANALISIS.md](../notebooklm/CHAT_Y_ANALISIS.md) para detalles.

#### Dominios, C4 y enrutamiento Falkor (ingest)

| Recurso | Método | Descripción |
| ------- | ------ | ----------- |
| Dominios | `GET /domains`, `POST /domains`, `GET /domains/:id`, `PATCH /domains/:id`, `DELETE /domains/:id` | Gobierno de arquitectura (nombre, color, `metadata`). |
| C4 PlantUML | `GET /projects/:id/architecture/c4?level=…&sessionId=` (`level` 1, 2 o 3) | DSL C4; `sessionId` opcional compara con grafo shadow. |
| Enrutamiento | `GET /projects/:id/graph-routing` | `cypherShardContexts`, `extendedGraphShardNames`, `shardMode`, `domainSegments`. |
| Whitelist | `GET /projects/:id/domain-dependencies`, `POST ...`, `DELETE .../:depId` | Proyecto → depende de dominio (`connection_type`, `description`). |

Esquema SQL: [db_schema.md](../notebooklm/db_schema.md) (tablas `domains`, `project_domain_dependencies`, columna `projects.domain_id`).

#### Monorepos: prefijos para muestreo estratificado

Si tu repo es un monorepo con `apps/admin`, `apps/api`, `apps/worker`, el chat usa muestreo estratificado para que las respuestas incluyan frontend y backend. Si usas otra estructura (ej. `packages/frontend`, `packages/backend`), amplía la lista de prefijos en `services/ingest/src/chat/chat-cypher.service.ts`:

```typescript
private static MONOREPO_PREFIXES = ['apps/admin', 'apps/api', 'apps/worker', 'apps/web', 'packages/', 'packages/frontend', 'packages/backend'];
```

Añade tus prefijos según la estructura de tu repo. Ver [services/ingest/src/chat/README.md](../../services/ingest/src/chat/README.md).

### 2.4 Consultas a la API (api service)

**Prefijo `/api` → ingest:** Con `INGEST_URL` configurado, la API reenvía al ingest (sin el prefijo `/api`) las rutas `/api/projects`, `/api/domains`, `/api/repositories`, `/api/credentials`, `/api/providers`, `/api/webhooks`. El health del servicio API sigue siendo `GET /health` (sin `/api`). Ejemplo dominios: `GET http://localhost:3000/api/domains`.

| Recurso    | Método                               | Descripción                        |
| ---------- | ------------------------------------ | ---------------------------------- |
| Health     | `GET /health`                        | Estado del servicio                |
| Impacto    | `GET /graph/impact/:nodeId`          | Dependientes del nodo              |
| Componente | `GET /graph/component/:name?depth=2` | Dependencias del componente        |
| Contrato   | `GET /graph/contract/:componentName` | Props del componente               |
| Compare    | `GET /graph/compare/:componentName`  | Props main vs shadow               |
| Shadow     | `POST /graph/shadow`                 | Indexar código propuesto en shadow |

**Ejemplos:**

```bash
# Health
curl http://localhost:3000/health

# Impacto de un componente
curl "http://localhost:3000/graph/impact/Header"

# Contrato de props
curl "http://localhost:3000/graph/contract/UserCard"

# Shadow (indexar código propuesto)
curl -X POST http://localhost:3000/graph/shadow \
  -H "Content-Type: application/json" \
  -d '{"files":[{"path":"src/Header.tsx","content":"..."}]}'
```

---

### 2.5 Orquestador (flujo SDD)

| Recurso  | Método                             | Descripción                       |
| -------- | ---------------------------------- | --------------------------------- |
| Refactor | `GET /workflow/refactor/:nodeId`   | Impacto + contratos + comparación |
| Validar  | `POST /workflow/refactor/validate` | Validar props propuestas          |
| Full     | `POST /workflow/refactor/full`     | Shadow + compare completo         |

**Ejemplo validación de props:**

```bash
curl -X POST http://localhost:3001/workflow/refactor/validate \
  -H "Content-Type: application/json" \
  -d '{
    "nodeId": "...",
    "proposedProps": [
      { "name": "title", "required": true },
      { "name": "onClick", "required": false }
    ]
  }'
```

---

### 2.6 Frontend

URL: `http://localhost:5173`

| Ruta              | Descripción                                                            |
| ----------------- | ---------------------------------------------------------------------- |
| `/`               | Lista de **proyectos** Ariadne                                         |
| `/domains`        | CRUD de dominios de arquitectura                                       |
| `/projects/:id`   | Detalle: General (repos, roles, sync) y **Arquitectura** (dominio, whitelist, C4) |
| `/projects/:id/chat` | Chat NL multi-repo del proyecto                                    |
| `/repos`          | Lista de repositorios                                                  |
| `/repos/new`      | Alta de repositorio                                                    |
| `/repos/:id`      | Detalle, Sync, Resync, tabla de jobs                                   |
| `/repos/:id/chat` | Chat con el repo (preguntas NL, Diagnóstico, Duplicados, Reingeniería) |
| `/credentials`    | Credenciales cifradas                                                  |

---

### 2.7 MCP AriadneSpecs en Cursor

1. Arrancar el MCP: `cd services/mcp-ariadne && npm run build && PORT=8080 node dist/index.js` (con FALKORDB_HOST, INGEST_URL).
2. Cursor → Settings → MCP.
3. Añadir servidor (local o producción):
   ```json
   {
     "mcpServers": {
       "ariadnespecs": {
         "url": "http://localhost:8080/mcp"
       }
     }
   }
   ```
   Producción: `url`: `https://ariadne.kreoint.mx/mcp`. Con auth: añadir `"headers": { "Authorization": "Bearer <token>" }`.
4. Herramientas: `get_component_graph`, `get_legacy_impact`, `get_contract_specs`, `validate_before_edit`, `semantic_search`, `get_project_analysis`, etc.

**Documentación completa:** [INSTALACION_MCP_CURSOR.md](../notebooklm/INSTALACION_MCP_CURSOR.md) — instalación paso a paso, escenarios local/producción (ariadne.kreoint.mx), troubleshooting.

---

## 3. Flujos de trabajo habituales

### 3.1 Ingesta inicial de un repo

1. Registrar repo (2.1).
2. Full sync (2.2).
3. Comprobar jobs hasta que `status === "completed"`.
4. (Opcional) Configurar webhook para actualizaciones incrementales.

### 3.2 Consultar impacto antes de cambiar código

1. Obtener `nodeId` del componente/función (grafo o `get_functions_in_file`).
2. `GET /graph/impact/:nodeId` o herramienta `get_legacy_impact`.
3. Revisar dependientes antes de modificar.

### 3.3 Validar props al refactorizar

1. Indexar código propuesto en shadow: `POST /graph/shadow`.
2. `GET /graph/compare/:componentName`.
3. O usar `POST /workflow/refactor/full` con `proposedCode`.

### 3.4 Múltiples repos (multi-proyecto)

1. Crear un **proyecto Ariadne** (`projects` en PostgreSQL) y asociar repos en `project_repositories` (opcional `role` para frontend/backend).
2. En FalkorDB, los nodos llevan `projectId` = **`projects.id`** del contexto de indexación; también `repoId` del repositorio.
3. Las consultas Cypher deben filtrar por `projectId` (y `repoId` si aplica). Si el proyecto tiene **whitelist de dominios** (`project_domain_dependencies`), el ingest/MCP pueden consultar **varios grafos**; usa `cypherShardContexts` de `GET /projects/:id/graph-routing` para el par `(graphName, cypherProjectId)` correcto en cada shard.

---

## 4. Troubleshooting

| Problema                      | Posible causa          | Solución                                 |
| ----------------------------- | ---------------------- | ---------------------------------------- |
| Sync no arranca / job falla   | Sin credenciales       | Definir `BITBUCKET_*` o `GITHUB_TOKEN`   |
| 401 en webhook                | Secret incorrecto      | Revisar `BITBUCKET_WEBHOOK_SECRET`       |
| Redis connection refused      | Redis no levantado     | Levantar Redis en 6380 (o `REDIS_URL`)   |
| FalkorDB no responde          | FalkorDB no levantado  | Verificar FalkorDB en 6379               |
| Migraciones fallan            | Postgres no accesible  | Revisar `PGHOST`, `PGPORT`, credenciales |
| Frontend no conecta al ingest | `VITE_API_URL` errónea | Ajustar en build o `.env` del frontend   |

---

## 5. Referencias

- [architecture.md](../notebooklm/architecture.md) — Stack y arquitectura.
- [db_schema.md](../notebooklm/db_schema.md) — Grafo Falkor y tablas PostgreSQL (incl. `domains`).
- [indexing_engine.md](../notebooklm/indexing_engine.md) — Pipeline de indexación.
- [ingestion_flow.md](../notebooklm/ingestion_flow.md) — Flujo de ingesta masiva.
- [bitbucket_webhook.md](../notebooklm/bitbucket_webhook.md) — Webhook Bitbucket.
