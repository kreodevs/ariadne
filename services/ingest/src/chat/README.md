# Chat con Repositorio

Arquitectura de agentes: **Coordinator** (clasificación LLM) → **CodeAnalysis** | **KnowledgeExtraction**.

## Módulos de soporte (refactor por complejidad)

- **`chat.constants.ts`** — SCHEMA, EXAMPLES, GENERIC_FUNCTION_NAMES, MAX_*, SEARCH_SYNONYMS, FULL_AUDIT_SECRET_PATTERNS, EXPLORER_TOOLS_ALL, getExplorerToolsKnowledge(), truncateAntipatterns()
- **`chat-analysis.utils.ts`** — Funciones puras: computeRiskScore, groupDuplicates, formatDuplicatesSummary, findImportCycles, normalizeOptions, extractSearchTerms, getSearchTermsWithSynonyms
- **`chat-cypher.service.ts`** — Ejecución Cypher y formateo: executeCypher, executeCypherRaw(cypher, shardProjectId?), formatResultsHuman, getGraphSummary (inyectado en ChatService). Con `FALKOR_SHARD_BY_PROJECT`, los shards usan `graphNameForProject(projectId)`.
- **`chat-llm.service.ts`** — Llamadas OpenAI: callLlm, callLlmWithTools
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

Si **`ORCHESTRATOR_URL`** está definido (p. ej. `http://orchestrator:3001` en Docker), **`POST .../chat`** **no ejecuta LLM en ingest**: hace proxy a **`POST /codebase/chat/repository|project/...`** del orchestrator (LangGraph: retrieve → synthesize). El ingest sigue exponiendo **`POST /internal/repositories/:repoId/retriever-tool`** (header **`X-Internal-API-Key`** = **`INTERNAL_API_KEY`**) para que el orchestrator ejecute Cypher/RAG/archivos sin duplicar la capa de datos.

Sin `ORCHESTRATOR_URL`, el pipeline unificado legacy sigue en este servicio (`runUnifiedPipeline` + `ChatRetrieverToolsService`).

## API

- **`POST /repositories/:id/chat`** — Body: `{ message, history?, scope?, twoPhase?, responseMode?, threadId? }` (`scope`: `repoIds`, `includePathPrefixes`, `excludePathGlobs`; `twoPhase` alinea con `CHAT_TWO_PHASE` en ingest). **`responseMode: 'evidence_first'`** — fuerza two-phase, amplía el recorte de contexto hacia el sintetizador (`CHAT_EVIDENCE_FIRST_MAX_CHARS`, default 18000) y aplica prompt SDD (## Evidencia primero, listados anclados). Expuesto en MCP `ask_codebase` para The Forge legacy. Con orchestrator, `threadId` opcional se usa en el servicio remoto para Redis.
- **`POST /projects/:projectId/chat`** — Igual body (multi-root)
- **`POST .../modification-plan`** — Body: `{ userDescription, scope? }`
- **`POST /repositories/:id/analyze`** — Body: `{ mode: 'diagnostico'|'duplicados'|'reingenieria'|'codigo_muerto'|'seguridad'|'agents'|'skill' }`
- **`POST /projects/:projectId/analyze`** — Body: `{ mode: 'agents'|'skill' }` — Genera AGENTS.md y SKILL.md por proyecto (multi-root)
- **`GET /repositories/:id/graph-summary`** — Query: `full=1` (muestras completas), `repoScoped=1` (solo nodos con `repoId` = `:id` dentro del proyecto Falkor). Útil en multi-root para listar componentes de un repo sin mezclar el resto. El ingest usa `repoScoped` de forma interna en diagnóstico, overview, herramienta `get_graph_summary` (chat/ReAct y retriever) y el plan de modificación acota por `repositoryId` salvo `scope.repoIds` explícito.

**Requisitos:** `OPENAI_API_KEY`, `CHAT_MODEL` opcional (default `gpt-4o-mini`).

**Grounding (pipeline unificado `runUnifiedPipeline`):** el Synthesizer exige sección **## Evidencia** cuando se citan rutas; sin datos en contexto → mensaje **sin datos en índice para este alcance**. Fase 1→2: bloque JSON `retrieval_summary` antes del contexto bruto (`CHAT_TWO_PHASE`, desactivar con `0|false|off`). Filtros multi-root: `chat-scope.util.ts`. Telemetría: `CHAT_TELEMETRY_LOG=1` (incluye ratio de paths en respuesta presentes en retrieval). Plan de modificación: tope `MODIFICATION_PLAN_MAX_FILES` (default 150).

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

## Seguridad (mode=seguridad)

- Reutiliza el escaneo heurístico de `FULL_AUDIT_SECRET_PATTERNS` sobre una muestra ampliada de archivos `.ts/.tsx/.js/.json/.env` del índice → `details.leakedSecrets` + informe markdown vía LLM.
- Distinto de **Full Audit** (`POST .../full-audit`): aquí solo seguridad + narrativa; Full Audit sigue siendo el informe integral (arquitectura, salud, secretos, etc.).

## Métricas en el grafo (Function)

- `loc`, `complexity` (McCabe), `nestingDepth` — usadas en diagnóstico y antipatrones

Ver [docs/CHAT_Y_ANALISIS.md](../../../docs/CHAT_Y_ANALISIS.md) para detalles de extensión y modificación.
