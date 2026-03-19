# Manual de Configuración y Uso — Ariadne / FalkorSpecs

Guía completa para configurar y usar el sistema: variables de entorno, credenciales, puesta en marcha, flujos de trabajo y consultas.

---

## 1. Configuración

### 1.1 Requisitos

| Requisito | Versión / Nota |
|-----------|----------------|
| Node.js | ≥ 20 |
| Docker | Para levantar el stack completo |
| Colima (macOS) | Opcional; `scripts/ensure-docker.js` lo arranca si no hay Docker Desktop |

### 1.2 Variables de entorno

#### Servicio Ingest (puerto 3002)

| Variable | Obligatoria | Default | Descripción |
|----------|------------|---------|-------------|
| `PORT` | No | 3002 | Puerto HTTP |
| `PGHOST` | Sí* | localhost | PostgreSQL host |
| `PGPORT` | Sí* | 5432 | PostgreSQL puerto |
| `PGUSER` | Sí* | falkorspecs | Usuario PostgreSQL |
| `PGPASSWORD` | Sí* | falkorspecs | Contraseña PostgreSQL |
| `PGDATABASE` | Sí* | falkorspecs | Base de datos |
| `FALKORDB_HOST` | Sí* | localhost | FalkorDB host |
| `FALKORDB_PORT` | Sí* | 6379 | FalkorDB puerto |
| `REDIS_URL` | Sí* | redis://localhost:6380 | Redis para cola de sync (BullMQ) |
| `BITBUCKET_TOKEN` | Condicional | — | Token OAuth Bitbucket |
| `BITBUCKET_APP_PASSWORD` | Condicional | — | App Password Bitbucket |
| `BITBUCKET_USER` | Condicional | — | Usuario Bitbucket (con App Password) |
| `GITHUB_TOKEN` | Condicional | — | PAT GitHub (provider=github). Fallback si no hay credencial en BD. |
| `BITBUCKET_WEBHOOK_SECRET` | Condicional | — | Secret webhook. Fallback si no hay credencial en BD. |
| `CREDENTIALS_ENCRYPTION_KEY` | Condicional | — | Clave para cifrar credenciales en BD. Base64 32 bytes o hex 64 chars. Ej: `openssl rand -base64 32`. |
| `EMBEDDING_PROVIDER` | Condicional | openai | RAG: `openai` o `google` |
| `OPENAI_API_KEY` | Condicional | — | API key OpenAI: chat, diagnósticos/analyze y (si provider=openai) embeddings. **Obligatorio** para chat/analyze. |
| `CHAT_MODEL` | Condicional | gpt-4o-mini | Modelo OpenAI para chat |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | Condicional | — | API key Google AI (si provider=google). Para `gemini-embedding-001` (768 dims). |
| `NODE_ENV` | No | development | Si ≠ production, TypeORM usa synchronize |

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

| Variable | Obligatoria | Default | Descripción |
|----------|------------|---------|-------------|
| `PORT` | No | 3000 | Puerto HTTP |
| `FALKORDB_HOST` | Sí | localhost | FalkorDB host |
| `FALKORDB_PORT` | Sí | 6379 | FalkorDB puerto |
| `REDIS_URL` | Sí | redis://localhost:6380 | Redis (caché) |
| `INGEST_URL` | No | — | URL del ingest para proxy shadow |
| `CARTOGRAPHER_URL` | No | — | Fallback shadow si ingest no disponible |

#### Orchestrator (puerto 3001)

| Variable | Obligatoria | Default | Descripción |
|----------|------------|---------|-------------|
| `PORT` | No | 3001 | Puerto HTTP |
| `FALKORSPEC_API_URL` | No | http://api:3000 | URL de la API |

#### MCP FalkorSpecs (Streamable HTTP)

| Variable | Obligatoria | Default | Descripción |
|----------|------------|---------|-------------|
| `PORT` | No | 8080 | Puerto del servidor HTTP |
| `FALKORDB_HOST` | Sí | localhost | FalkorDB host |
| `FALKORDB_PORT` | Sí | 6379 | FalkorDB puerto |
| `INGEST_URL` | No | http://localhost:3002 | Para `get_file_content` y `semantic_search` (embed) |
| `MCP_AUTH_TOKEN` | No | — | Si está definido: exige Bearer token en peticiones |

#### Frontend (puerto 5173)

| Variable | Obligatoria | Default | Descripción |
|----------|------------|---------|-------------|
| `VITE_API_URL` | No | http://localhost:3002 | URL del servicio ingest |

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

| Permiso | Nivel | Uso |
|---------|-------|-----|
| **Account** | Read | Listar workspaces del usuario |
| **Workspace membership** | Read | Listar workspaces (desplegable en alta de repo) |
| **Repositories** | Read | Listar repos, branches, archivos; clone; diff por commit |
| **Projects** | Read | Opcional; algunos planes lo incluyen con Repositories |

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

| Servicio | Puerto |
|----------|--------|
| API | 3000 |
| Ingest | 3002 |
| Orchestrator | 3001 |
| Frontend | 5173 |
| FalkorDB | 6379 |
| PostgreSQL | 5432 |
| Redis | 6380 |

**Credenciales en Docker:** crear un `.env` en la raíz o usar override:

```yaml
# docker-compose.override.yml (ejemplo)
services:
  ingest:
    environment:
      - CREDENTIALS_ENCRYPTION_KEY=${CREDENTIALS_ENCRYPTION_KEY}
      - EMBEDDING_PROVIDER=${EMBEDDING_PROVIDER:-openai}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - CHAT_MODEL=${CHAT_MODEL:-gpt-4o-mini}
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

Ver [bitbucket_webhook.md](../bitbucket_webhook.md) para más detalle.

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

| Campo | Bitbucket | GitHub |
|-------|-----------|--------|
| projectKey | Workspace | Owner o organización |
| repoSlug | Nombre del repo | Nombre del repo |

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

| Recurso | Método | Descripción |
|---------|--------|-------------|
| Chat (repo) | `POST /repositories/:id/chat` | Preguntas NL por repo. Body: `{ message, history? }` |
| Chat (proyecto) | `POST /projects/:projectId/chat` | Preguntas NL por proyecto (todos los repos). Body: `{ message, history? }` |
| Plan modificación | `POST /projects/:projectId/modification-plan` | Body: `{ userDescription }` → `{ filesToModify: [{ path, repoId }], questionsToRefine }` |
| Análisis | `POST /repositories/:id/analyze` | Diagnóstico, duplicados, reingeniería, código muerto. Body: `{ mode: 'diagnostico'|'duplicados'|'reingenieria'|'codigo_muerto' }` |
| Resumen grafo | `GET /repositories/:id/graph-summary` | Conteos y muestras de nodos indexados |

Requieren `OPENAI_API_KEY`. Ver [CHAT_Y_ANALISIS.md](../CHAT_Y_ANALISIS.md) para detalles.

### 2.4 Consultas a la API (api service)

| Recurso | Método | Descripción |
|---------|--------|-------------|
| Health | `GET /health` | Estado del servicio |
| Impacto | `GET /graph/impact/:nodeId` | Dependientes del nodo |
| Componente | `GET /graph/component/:name?depth=2` | Dependencias del componente |
| Contrato | `GET /graph/contract/:componentName` | Props del componente |
| Compare | `GET /graph/compare/:componentName` | Props main vs shadow |
| Shadow | `POST /graph/shadow` | Indexar código propuesto en shadow |

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

| Recurso | Método | Descripción |
|---------|--------|-------------|
| Refactor | `GET /workflow/refactor/:nodeId` | Impacto + contratos + comparación |
| Validar | `POST /workflow/refactor/validate` | Validar props propuestas |
| Full | `POST /workflow/refactor/full` | Shadow + compare completo |

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

| Ruta | Descripción |
|------|-------------|
| `/` | Lista de repositorios |
| `/projects` | Lista de proyectos (multi-root) |
| `/projects/new` | Crear proyecto |
| `/projects/:id` | Detalle de proyecto (nombre editable, resync por repo, asociar repo, eliminar, "Repositorio nuevo" con ?projectId=) |
| `/projects/:id/chat` | Chat por proyecto |
| `/repos/new` | Alta de repositorio |
| `/repos/:id` | Detalle, Sync, Resync (desde repo), tabla de jobs |
| `/repos/:id/chat` | Chat con el repo (preguntas NL, Diagnóstico, Duplicados, Reingeniería, Código muerto) |

---

### 2.7 MCP FalkorSpecs en Cursor

1. Arrancar el MCP: `cd services/mcp-falkorspec && npm run build && PORT=8080 node dist/index.js` (con FALKORDB_HOST, INGEST_URL).
2. Cursor → Settings → MCP.
3. Añadir servidor (local o producción):
   ```json
   {
     "mcpServers": {
       "falkorspecs": {
         "url": "http://localhost:8080/mcp"
       }
     }
   }
   ```
   Producción: `url`: `https://ariadne.kreoint.mx/mcp`. Con auth: añadir `"headers": { "Authorization": "Bearer <token>" }`.
4. Herramientas: `list_known_projects` (al inicio; respuesta `[{ id, name, roots: [{ id, name, branch? }] }]`), `get_component_graph`, `get_legacy_impact`, `get_contract_specs`, `validate_before_edit`, `semantic_search`, `get_project_analysis`, `get_modification_plan`. **File/chat:** proyecto o `roots[].id` con resolución en ingest. **`get_project_analysis`:** endpoint por **repositorio** → usar **`roots[].id`**. **`get_modification_plan`:** en multi-root, preferir **`roots[].id`** del repo objetivo (también acepta UUID de proyecto Ariadne).

**Documentación completa:** [INSTALACION_MCP_CURSOR.md](../INSTALACION_MCP_CURSOR.md) — instalación paso a paso, escenarios local/producción (ariadne.kreoint.mx), troubleshooting.

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

### 3.4 Proyectos y múltiples repos (multi-root)

1. **Proyectos:** `GET /projects`, `POST /projects`, `PATCH /projects/:id`, `DELETE /projects/:id`. Un proyecto puede tener varios repos (asociar desde detalle del proyecto).
2. Tabla `project_repositories` (repo_id, project_id): un repo puede estar en varios proyectos.
3. **Resync:** `POST /repositories/:id/resync` borra ámbito standalone del repo y reindexa todo; `POST /repositories/:id/resync-for-project` con body `{ projectId }` borra solo el slice (projectId, repoId) y reindexa solo ese proyecto para ese repo.
4. Grafo / herramientas MCP: muchas aceptan UUID de proyecto Ariadne o de repo (`roots[].id`). **`get_project_analysis`** (MCP → `POST /repositories/:id/analyze`) requiere **id de repositorio**. **`get_modification_plan`:** preferir `roots[].id` en multi-root.

---

## 4. Troubleshooting

| Problema | Posible causa | Solución |
|----------|---------------|----------|
| Sync no arranca / job falla | Sin credenciales | Definir `BITBUCKET_*` o `GITHUB_TOKEN` |
| 401 en webhook | Secret incorrecto | Revisar `BITBUCKET_WEBHOOK_SECRET` |
| Redis connection refused | Redis no levantado | Levantar Redis en 6380 (o `REDIS_URL`) |
| FalkorDB no responde | FalkorDB no levantado | Verificar FalkorDB en 6379 |
| Migraciones fallan | Postgres no accesible | Revisar `PGHOST`, `PGPORT`, credenciales |
| Frontend no conecta al ingest | `VITE_API_URL` errónea | Ajustar en build o `.env` del frontend |

---

## 5. Referencias

- [architecture.md](../architecture.md) — Stack y arquitectura.
- [indexing_engine.md](../indexing_engine.md) — Pipeline de indexación.
- [ingestion_flow.md](../ingestion_flow.md) — Flujo de ingesta masiva.
- [bitbucket_webhook.md](../bitbucket_webhook.md) — Webhook Bitbucket.
