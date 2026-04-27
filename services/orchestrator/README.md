# AriadneSpec Orchestrator (NestJS + LangGraph)

Orquestación de agentes: flujos SDD (refactor) y **ask_codebase** (chat NL sobre el grafo), con estado opcional en Redis.

## Flujo LangGraph — refactor (SDD)

- **Base:** `validate_impact` → `fetch_contracts` → **`contract_verifier`** (props grafo vs `proposedProps`).
- **Completo (`POST /workflow/refactor/full`):** … → `weaver` → **`shadow_index`** → condicional:
  - OK → `compare_graphs` → **`generate_tests`** → END.
  - Fallo indexación (error API/Cypher/Falkor en body) → **`revise_code_llm`** → vuelve a `shadow_index` (hasta `maxRevisions`, default 3) si hay LLM configurado (`OPENROUTER_API_KEY`); si no, END.
- **Shadow por sesión:** `shadow_index` guarda el `shadowSessionId` devuelto por la API/ingest y reutiliza el mismo id en reintentos; `compare_graphs` llama a `GET /graph/compare/:nodeId?shadowSessionId=…` contra el grafo `FalkorSpecsShadow:<sesión>` en FalkorDB (sin grafo shadow global compartido).

## Flujo LangGraph — ask_codebase (`codebase-chat`)

- **Nodo `retrieve`:** ReAct con tools (LLM vía **OpenRouter**) ejecutando **solo datos** vía ingest: `POST /internal/repositories/:id/retriever-tool` (Cypher, semantic, graph summary, file content). Prompt de **Coordinador/Validador**: priorizar Prisma, OpenAPI (`OpenApiOperation`), Nest, `package.json`, `.env.example`, tsconfig.
- **Nodo `synthesize`:** Si **`responseMode === 'evidence_first'`**, **no** se llama al LLM de prosa: se invoca **`POST /internal/repositories/:id/mdd-evidence`** (misma **`INTERNAL_API_KEY`**) y la respuesta es **JSON MDD** (7 secciones). Si es **`default`**, el LLM genera la respuesta final como antes.
- **Redis (opcional):** si el body incluye `threadId`, se guarda un snapshot post-retrieve en `codebase:chat:{threadId}` (TTL 3600s).
- **Legacy (The Forge):** módulo **`LegacyModule`** — `LegacyCoordinatorService` + `SemaphoreService` procesan el JSON MDD (Workshop, semáforo, gate `assertLegacyIndexSddGate`). Ver [src/legacy/README.md](src/legacy/README.md).

## HTTP

### Workflow (SDD)

- **GET /workflow/refactor/:nodeId** — Impacto + contrato + verificador.
- **POST /workflow/refactor/validate** — Igual con `proposedProps` en body.
- **POST /workflow/refactor/full** — Pipeline con shadow, bucle LLM y tests sugeridos.

### Codebase chat (centralizado)

- **POST /codebase/chat/repository/:repositoryId** — Mismo body que `POST /repositories/:id/chat` en ingest (`message`, `history?`, `scope?`, `twoPhase?`, `responseMode?`, `threadId?`).
- **POST /codebase/chat/project/:projectId** — Equivalente a `POST /projects/:projectId/chat`.

El **ingest** con `ORCHESTRATOR_URL` delega estos endpoints al orchestrator (el cliente sigue llamando al ingest como antes).

## Variables de entorno

- `PORT` — Default 3001.
- `ARIADNESPEC_API_URL` — API Ariadne (default `http://api:3000/api`).
- **`LLM_MODEL`**, **`LLM_API_KEY`**, **`LLM_TEMPERATURE`** — Config homologada (ver [src/llm/README.md](src/llm/README.md)).
- **OpenRouter:** `OPENROUTER_API_KEY` (obligatoria; alias `AI_API_KEY` / `OPENAI_API_KEY`), `OPENROUTER_BASE_URL`, `OPENROUTER_CHAT_MODEL`, `ORCHESTRATOR_LLM_MODEL`, `CHAT_MODEL`, etc.

Detalle: [src/llm/README.md](src/llm/README.md).

**Rate limits:** por defecto el throttle usa **`LLM_MAX_CONCURRENT=1`** y **`LLM_MIN_REQUEST_INTERVAL_MS=2000`**. Tras 429 del proveedor, `POST /codebase/chat/*` puede responder **HTTP 429**; el ingest con `ORCHESTRATOR_URL` repropaga el mismo código al cliente.

- `INGEST_URL` — URL del microservicio ingest (default `http://ingest:3002` en Docker).
- `INTERNAL_API_KEY` — Debe coincidir con la del ingest; protege `POST /internal/repositories/:id/retriever-tool` y **`POST /internal/repositories/:id/mdd-evidence`**.
- `REDIS_URL` — Estado de sesión y snapshots `codebase:chat:*` (default `redis://redis:6379` en compose).
- `CHAT_TWO_PHASE`, `CHAT_EVIDENCE_FIRST_MAX_CHARS`, `CHAT_TELEMETRY_LOG` — Mismo comportamiento que en ingest.

## Redis

- `refactor:state:*` — Flujos workflow.
- `codebase:chat:*` — Snapshots post-retrieve (observabilidad) cuando se envía `threadId`.
