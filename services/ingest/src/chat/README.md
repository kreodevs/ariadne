# Chat con Repositorio

Arquitectura de agentes: **Coordinator** (clasificación LLM) → **CodeAnalysis** | **KnowledgeExtraction**.

## Módulos de soporte (refactor por complejidad)

- **`chat.constants.ts`** — SCHEMA, EXAMPLES, GENERIC_FUNCTION_NAMES, MAX_*, SEARCH_SYNONYMS, FULL_AUDIT_SECRET_PATTERNS, EXPLORER_TOOLS_ALL, getExplorerToolsKnowledge(), truncateAntipatterns()
- **`chat-analysis.utils.ts`** — Funciones puras: computeRiskScore, groupDuplicates, formatDuplicatesSummary, findImportCycles, normalizeOptions, extractSearchTerms, getSearchTermsWithSynonyms
- **`chat-cypher.service.ts`** — Ejecución Cypher y formateo: executeCypher, executeCypherRaw, formatResultsHuman, getGraphSummary (inyectado en ChatService)
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

## API

- **`POST /repositories/:id/chat`** — Body: `{ message, history?, scope?, twoPhase? }` (`scope`: `repoIds`, `includePathPrefixes`, `excludePathGlobs`; `twoPhase` alinea con `CHAT_TWO_PHASE` en ingest)
- **`POST /projects/:projectId/chat`** — Igual body (multi-root)
- **`POST .../modification-plan`** — Body: `{ userDescription, scope? }`
- **`POST /repositories/:id/analyze`** — Body: `{ mode: 'diagnostico'|'duplicados'|'reingenieria' }`
- **`GET /repositories/:id/graph-summary`** — Conteos y muestras de nodos

**Requisitos:** `OPENAI_API_KEY`, `CHAT_MODEL` opcional (default `gpt-4o-mini`).

**Grounding (pipeline unificado `runUnifiedPipeline`):** el Synthesizer exige sección **## Evidencia** cuando se citan rutas; sin datos en contexto → mensaje **sin datos en índice para este alcance**. Fase 1→2: bloque JSON `retrieval_summary` antes del contexto bruto (`CHAT_TWO_PHASE`, desactivar con `0|false|off`). Filtros multi-root: `chat-scope.util.ts`. Telemetría: `CHAT_TELEMETRY_LOG=1` (incluye ratio de paths en respuesta presentes en retrieval). Plan de modificación: tope `MODIFICATION_PLAN_MAX_FILES` (default 150).

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

## Métricas en el grafo (Function)

- `loc`, `complexity` (McCabe), `nestingDepth` — usadas en diagnóstico y antipatrones

Ver [docs/CHAT_Y_ANALISIS.md](../../../docs/CHAT_Y_ANALISIS.md) para detalles de extensión y modificación.
