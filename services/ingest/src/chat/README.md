# Chat con Repositorio

Arquitectura de agentes: **Coordinator** (clasificación LLM) → **CodeAnalysis** | **KnowledgeExtraction**.

## Módulos de soporte (refactor por complejidad)

- **`analytics.service.ts`** — Fachada Fase 6: `resolveRepositoryIdForAnalysis` (proyecto + `idePath` / `repositoryId`) y `analyzeByProjectId` → `ChatService.analyze`.
- **`chat.constants.ts`** — SCHEMA, EXAMPLES, GENERIC_FUNCTION_NAMES, MAX_*, SEARCH_SYNONYMS, FULL_AUDIT_SECRET_PATTERNS, EXPLORER_TOOLS_ALL, getExplorerToolsKnowledge(), truncateAntipatterns()
- **`chat-analysis.utils.ts`** — Funciones puras: computeRiskScore, groupDuplicates, formatDuplicatesSummary, findImportCycles, normalizeOptions, extractSearchTerms, getSearchTermsWithSynonyms
- **`resolve-chat-scope-from-message.util.ts`** — Inferencia de `repoId` desde mensaje + `project_repositories.role` (`CHAT_INFER_SCOPE_FROM_ROLES`).
- **`chat-preflight-scope.util.ts`** — Paths en el mensaje; filtrado de filas/bloques por `repoId` antes del sintetizador (`CHAT_PREFLIGHT_PATH_REPO`).
- **`chat-cypher.service.ts`** — Ejecución Cypher y formateo: **executeCypher** recorre **`ProjectsService.getCypherShardContexts`** (proyecto + dominios whitelist) y deduplica filas; **executeCypherRaw**(cypher, shardProjectId?), formatResultsHuman, getGraphSummary. Con sharding, cada nombre de grafo se combina con el **cypherProjectId** correcto para los nodos en ese shard.
- **`llm-unified.ts`** — `LLM_PROVIDER` / `LLM_MODEL` / `LLM_API_KEY` (y legacy `INGEST_LLM_PROVIDER`, etc.).
- **`chat-llm-config.ts`** — Reexporta resolución ingest (openai | kimi).
- **`kimi-chat.adapter.ts`** — Kimi Open Platform (`/v1/chat/completions` compatible OpenAI).
- **`chat-llm.service.ts`** — callLlm, callLlmWithTools (OpenAI o Kimi según config).
- **`chat-antipatterns.service.ts`** — Detección de anti-patrones: detectAntipatterns (spaghetti, god functions, circularImports, etc.)
- **`chat-handlers.service.ts`** — Handlers: answer*, `semanticSearchFallback`, `getSemanticSearchDiagnostics` (por qué semantic devolvió 0 filas)

## Arquitectura de Prompts (Arquitectura de Prompts y Patrones)

Todos los prompts siguen el **Structured System Prompt**:
- **Rol** — quién es el modelo
- **Instrucciones** — qué hacer
- **Restricciones** — qué NO hacer (negativas explícitas)
- **Formato** — estructura de salida esperada

Patrones usados: **ReAct** (Thought→Action→Observation), **CoT** (análisis paso a paso en Explorer), **meta-prompting** (Coordinator clasifica → delega).

## Arquitectura (Architecting Agentic Systems)

- **Coordinator**: Clasifica con LLM (`code_analysis` | `knowledge_extraction` | `explorer`) — reemplaza parser de strings
- **CodeAnalysis**: Respuestas de ESTRUCTURA — paths, funciones, Cypher, métricas, diagnóstico
- **KnowledgeExtraction**: Respuestas en LENGUAJE NATURAL — tipos, opciones, algoritmos extraídos del código
- **ReAct**: Explorer con tools (Cypher, semantic_search, get_file_content) — CoT, Self-Refine

## Control plane agéntico (orchestrator)

Si **`ORCHESTRATOR_URL`** está definido (p. ej. `http://orchestrator:3001` en Docker), **`POST .../chat`** **no ejecuta LLM en ingest**: hace proxy a **`POST /codebase/chat/repository|project/...`** del orchestrator (LangGraph: retrieve → synthesize). Con **`responseMode: evidence_first`**, el orchestrator pide el JSON MDD a **`POST /internal/repositories/:repoId/mdd-evidence`** (mismas cabeceras internas). El ingest sigue exponiendo **`POST /internal/repositories/:repoId/retriever-tool`** (header **`X-Internal-API-Key`** = **`INTERNAL_API_KEY`**) para que el orchestrator ejecute Cypher/RAG/archivos sin duplicar la capa de datos.

Sin `ORCHESTRATOR_URL`, el pipeline unificado legacy sigue en este servicio (`runUnifiedPipeline` + `ChatRetrieverToolsService`).

## API

- **`POST /repositories/:id/chat`** — Body: `{ message, history?, scope?, twoPhase?, responseMode?, threadId?, clientMeta?, strictChatScope? }` (`scope`: `repoIds`, `includePathPrefixes`, `excludePathGlobs`; `twoPhase` alinea con `CHAT_TWO_PHASE` en ingest). **`responseMode: 'evidence_first'`** — sin **`ORCHESTRATOR_URL`**: tras el retrieve se devuelve **`answer`** como **JSON MDD** (7 secciones: `summary`, `openapi_spec`, `entities`, `api_contracts`, `business_logic`, `infrastructure`, `risk_report`, `evidence_paths`) y **`mddDocument`** en el cuerpo; se usa `CHAT_EVIDENCE_FIRST_MAX_CHARS` al preparar contexto; si el retriever no trae texto, **`injectPhysicalEvidenceFallback`** añade paths del grafo + lecturas de manifiestos. Con **orchestrator**, el ingest hace proxy al LangGraph y el MDD lo genera el orchestrator vía **`mdd-evidence`**. `threadId` opcional → Redis en orchestrator.
- **`POST /projects/:projectId/chat`** — Mismo body. **Multi-root (varios repos):** por defecto (`strictChatScope` omitido o `true`) exige `scope` explícito o inferencia por **roles** en `project_repositories`; si no, respuesta `[AMBIGUOUS_SCOPE]` con candidatos. `strictChatScope: false` permite chat amplio sobre todos los roots. **Preflight:** si el retrieval mezcla `repoId` y el mensaje incluye una ruta que resuelve a un único repo (`resolveRepositoryForWorkspacePath`), se recorta contexto antes del sintetizador (ver `CHAT_PREFLIGHT_PATH_REPO`). **Listados íntegros:** si el mensaje pide volcado completo de componentes o inventario indexado, respuesta temprana con tablas Markdown (límites `CHAT_COMPONENT_FULL_MAX`, `CHAT_GRAPH_INVENTORY_FULL_MAX`; detectores en `chat.constants.ts`).
- **`POST .../modification-plan`** — Body: `{ userDescription, scope?, currentFilePath?, questionsMode?: 'business'|'technical'|'both' }`. Multi-root: ancla con un solo `scope.repoIds`, `currentFilePath` absoluto bajo el clone, o `MODIFICATION_PLAN_LEGACY_FIRST_REPO=true`. Utilidades: `modification-plan-*.util.ts`, exclusiones por env `MODIFICATION_PLAN_*`.
- **`POST /repositories/:id/analyze`** — Body: `{ mode, scope?, crossPackageDuplicates? }` (`scope`: `repoIds`, `includePathPrefixes`, `excludePathGlobs`; `crossPackageDuplicates` solo aplica en `duplicados`). Modos: `diagnostico`|`duplicados`|`reingenieria`|`codigo_muerto`|`seguridad`|`agents`|`skill`. **`:id` = UUID del repositorio** (mismo grafo/embeddings que el sync). La respuesta puede incluir **`reportMeta`** (caché, foco, cobertura del grafo).
- **`GET /projects/:projectId/jobs/:jobId/analysis`** — Análisis de job **incremental** (misma respuesta que `GET /repositories/:repoId/jobs/:jobId/analysis`); comprueba que el job pertenezca a un repositorio enlazado al proyecto (`project_repositories`).
- **`POST /projects/:projectId/analyze`** — Body:
  - `{ mode: 'agents'|'skill' }` — AGENTS.md / SKILL.md (multi-root; comportamiento previo).
  - `{ mode: 'diagnostico'|'duplicados'|… , idePath?, repositoryId?, scope?, crossPackageDuplicates? }` — Resolución multi-root vía **`AnalyticsService`**: mono-repo → único root; varios roots → **`repositoryId`** (`roots[].id`) o **`idePath`** (ruta absoluta/local del IDE) para inferir el repo; luego mismo pipeline que `POST /repositories/:id/analyze` (mismas opciones de alcance).
- **`POST /internal/repositories/:repoId/analyze-prep`** — Body: `{ mode, scope?, crossPackageDuplicates? }` — preparación orchestrator (sin LLM en ingest cuando aplica).
- **`POST /internal/repositories/:repoId/mdd-evidence`** — Body: `{ message, gatheredContext, collectedResults, projectScope?, projectId? }` — JSON **MDD** (7 secciones) para `ask_codebase` / LegacyCoordinator; inyecta lecturas mínimas si el contexto está vacío pero hay archivos en índice.
- **`GET /repositories/:id/graph-summary`** — Query: `full=1` (muestras completas), `repoScoped=1` (solo nodos con `repoId` = `:id` dentro del proyecto Falkor). Útil en multi-root para listar componentes de un repo sin mezclar el resto. El ingest usa `repoScoped` de forma interna en diagnóstico, overview, herramienta `get_graph_summary` (chat/ReAct y retriever) y el plan de modificación acota por `repositoryId` salvo `scope.repoIds` explícito.

**Requisitos LLM:** **`LLM_API_KEY`** + **`LLM_PROVIDER`** (o claves legacy `OPENAI_*` / `MOONSHOT_*`); **`LLM_MODEL`** opcional (defaults `gpt-4o-mini` / `kimi-k2.5`). Con `ORCHESTRATOR_URL`, ask_codebase usa el orchestrator (mismas `LLM_*`).

**Grounding (pipeline unificado `runUnifiedPipeline`):** el Synthesizer exige sección **## Evidencia** cuando se citan rutas; sin datos en contexto → mensaje **sin datos en índice para este alcance**. Fase 1→2: bloque JSON `retrieval_summary` antes del contexto bruto (`CHAT_TWO_PHASE`, desactivar con `0|false|off`). Filtros multi-root: `chat-scope.util.ts` (`hasExplicitChatScopeNarrowing`). Telemetría: `CHAT_TELEMETRY_LOG=1` o `true` — log JSON por request con `pathGroundingRatio`, `chat_scope_effective` (`preflightPathRepoApplied`, `inferred`, `scopeFilterActive`, etc.); ver **`docs/notebooklm/metricas-alcance-chat.md`**. Plan de modificación: tope `MODIFICATION_PLAN_MAX_FILES` (default 150).

**Monorepos (apps/admin, apps/api, apps/worker):** `get_graph_summary` usa muestreo estratificado por prefijo; el prompt del retriever indica explorar NestController, NestService y todas las apps.

**Otra estructura de monorepo:** Si no usas `apps/` sino, por ejemplo, `packages/frontend` y `packages/backend`, se puede ampliar la lista de prefijos en `chat-cypher.service.ts`:

```typescript
private static MONOREPO_PREFIXES = ['apps/admin', 'apps/api', 'apps/worker', 'apps/web', 'packages/', 'packages/frontend', 'packages/backend'];
```

Añade tus prefijos según la estructura de tu repo.

## Flujo del Chat

1. **Coordinator** clasifica con LLM → `code_analysis` | `knowledge_extraction` | `explorer`
2. **CodeAnalysis:** overview, how implemented, diagnóstico, reingeniería, imports, antipatrones, Explorer ReAct (tools: `execute_cypher`, `semantic_search`, `get_graph_summary`, `get_file_content`)
3. **KnowledgeExtraction:** tipos/opciones, resumen de algoritmos — consulta **DomainConcept** (grafo de dominio) primero; si hay suficientes, enriquece con LLM; si no, fallback a componentes + archivos + LLM
4. **ReAct:** Thought → Tool → Observation (máx 3 ciclos); Self-Refine cuando Cypher devuelve 0
5. **Formato:** `formatResultsHuman()` agrupa por path

**FalkorDB:** No soporta `NOT EXISTS`; usar `OPTIONAL MATCH` + `count(x)=0`.

## Diagnóstico (mode=diagnostico)

- Top 10 por riesgo (score: outCalls*3 + complexity*2 + noDesc + loc penalty)
- Anti-patrones: spaghetti (nestingDepth>4), God function (outCalls>8), fan-in alto (inCalls>5), imports circulares, componentes sobrecargados (RENDERS>8)
- Alto acoplamiento, sin JSDoc, componentes con muchas props

## Duplicados (mode=duplicados)

- Requiere `embed-index` previo
- `db.idx.vector.queryNodes` en Function, threshold 0.85

## Reingeniería (mode=reingenieria)

- Orquesta diagnóstico + duplicados → plan priorizado (documentar, refactorizar, estándares, pruebas)

## MDD (`mdd-document.builder` / The Forge)

Volcado **casi completo** por defecto (OpenAPI ops, Model, NestService, `evidence_paths`, texto de consulta en `summary`). Acota con env si Falkor o el payload JSON son demasiado grandes:

**`openapi_spec`:** además de `found` / `path` (`File.openApiTruth`) / `trust_level`, el builder puede rellenar **`swagger_dependencies`** (manifest agregado del proyecto incluye paquetes swagger/openapi), **`swagger_related_paths`** (nodos `File` cuyo path contiene `swagger` u `openapi`), **`supplementary_doc_paths`** (Markdown en `evidence_paths` que parecen inventario de endpoints, p. ej. `docs/inventario-endpoints-*.md`) y **`notes`** cuando hay Swagger en código pero no hay spec OpenAPI indexada o faltan nodos `OpenApiOperation`/`NestController`.

| Variable | Uso |
|----------|-----|
| `MDD_MAX_OPENAPI_OPERATIONS` | Límite Cypher `OpenApiOperation` (default 100000) |
| `MDD_MAX_NEST_CONTROLLERS` | `NestController` fallback AST (default 10000) |
| `MDD_MAX_MODELS` | Nodos `Model` (default 50000) |
| `MDD_MAX_NEST_SERVICES` | `NestService` en business_logic (default 20000) |
| `MDD_MAX_EVIDENCE_PATHS` | Recorte final de `evidence_paths` (default 50000) |
| `MDD_SUMMARY_MESSAGE_CHARS` | Prefijo de consulta en `summary` (default 16000) |
| `MDD_MAX_OPENAPI_FILE_CANDIDATES` | Ficheros `File` con `openApiTruth` (default 25) |
| `MDD_MAX_SWAGGER_RELATED_PATHS` | `File` con path que sugiere Swagger/OpenAPI (default 40) |
| `MDD_FALLBACK_GRAPH_FILE_PATHS` | Muestra de paths File si el retriever va vacío (default 2000) |
| `MDD_FALLBACK_FILE_SNIPPET_CHARS` | Lectura de manifiestos en fallback (default 100000) |

Implementación: `mdd-limits.ts`, `mdd-document.builder.ts`, `mdd-document.types.ts`.

## Seguridad (mode=seguridad)

- Reutiliza el escaneo heurístico de `FULL_AUDIT_SECRET_PATTERNS` sobre una muestra ampliada de archivos `.ts/.tsx/.js/.json/.env` del índice → `details.leakedSecrets` + informe markdown vía LLM.
- Distinto de **Full Audit** (`POST .../full-audit`): aquí solo seguridad + narrativa; Full Audit sigue siendo el informe integral (arquitectura, salud, secretos, etc.).

## Métricas en el grafo (Function)

- `loc`, `complexity` (McCabe), `nestingDepth` — usadas en diagnóstico y antipatrones

Ver [docs/notebooklm/CHAT_Y_ANALISIS.md](../../../docs/notebooklm/CHAT_Y_ANALISIS.md) para detalles de extensión y modificación.
