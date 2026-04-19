# AriadneSpec Orchestrator (NestJS + LangGraph)

Orquestación de agentes: flujos SDD (refactor) y **ask_codebase** (chat NL sobre el grafo), con estado opcional en Redis.

## Flujo LangGraph — refactor (SDD)

- **Base:** `validate_impact` → `fetch_contracts` → **`contract_verifier`** (props grafo vs `proposedProps`).
- **Completo (`POST /workflow/refactor/full`):** … → `weaver` → **`shadow_index`** → condicional:
  - OK → `compare_graphs` → **`generate_tests`** → END.
  - Fallo indexación (error API/Cypher/Falkor en body) → **`revise_code_llm`** → vuelve a `shadow_index` (hasta `maxRevisions`, default 3) si hay LLM configurado (`OPENAI_API_KEY` o `GOOGLE_API_KEY` según proveedor); si no, END.
- **Shadow por sesión:** `shadow_index` guarda el `shadowSessionId` devuelto por la API/ingest y reutiliza el mismo id en reintentos; `compare_graphs` llama a `GET /graph/compare/:nodeId?shadowSessionId=…` contra el grafo `FalkorSpecsShadow:<sesión>` en FalkorDB (sin grafo shadow global compartido).

## Flujo LangGraph — ask_codebase (`codebase-chat`)

- **Nodo `retrieve`:** ReAct con tools (LLM OpenAI o Gemini) ejecutando **solo datos** vía ingest: `POST /internal/repositories/:id/retriever-tool` (Cypher, semantic, graph summary, file content).
- **Nodo `synthesize`:** LLM genera la respuesta final (mismo contrato que el pipeline unificado histórico en ingest).
- **Redis (opcional):** si el body incluye `threadId`, se guarda un snapshot post-retrieve en `codebase:chat:{threadId}` (TTL 3600s).

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
- `ORCHESTRATOR_LLM_PROVIDER` — `openai`, `google` o `kimi`/`moonshot`. Auto: solo `GOOGLE_API_KEY` → Google; solo `MOONSHOT_API_KEY`/`KIMI_API_KEY` (sin OpenAI/Google) → Kimi.
- `OPENAI_API_KEY` — Proveedor OpenAI (chat + tools).
- `GOOGLE_API_KEY` — Proveedor Gemini.
- `MOONSHOT_API_KEY` / `KIMI_API_KEY` — Kimi Open Platform; `MOONSHOT_BASE_URL` opcional (default `https://api.moonshot.ai/v1`).
- `KIMI_LLM_MODEL` / `MOONSHOT_MODEL` — Modelo Kimi (default `kimi-k2.5` si no se define `ORCHESTRATOR_LLM_MODEL` / `CHAT_MODEL`).
- `GOOGLE_LLM_MODEL` — Opcional; modelo Gemini (p. ej. `gemini-2.0-flash`).
- `ORCHESTRATOR_LLM_MODEL` / `CHAT_MODEL` — Modelo según proveedor.

Detalle de la capa LLM: [src/llm/README.md](src/llm/README.md).
- `INGEST_URL` — URL del microservicio ingest (default `http://ingest:3002` en Docker).
- `INTERNAL_API_KEY` — Debe coincidir con la del ingest; protege `POST /internal/repositories/:id/retriever-tool`.
- `REDIS_URL` — Estado de sesión y snapshots `codebase:chat:*` (default `redis://redis:6379` en compose).
- `CHAT_TWO_PHASE`, `CHAT_EVIDENCE_FIRST_MAX_CHARS`, `CHAT_TELEMETRY_LOG` — Mismo comportamiento que en ingest.

## Redis

- `refactor:state:*` — Flujos workflow.
- `codebase:chat:*` — Snapshots post-retrieve (observabilidad) cuando se envía `threadId`.
