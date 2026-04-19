# Chat y Análisis — Ariadne

Documentación del sistema de chat con repositorios, diagnósticos, métricas de complejidad y detección de anti-patrones. Para mantener o extender estas funcionalidades.

---

## 1. API y Endpoints

| Endpoint | Descripción |
|----------|-------------|
| `POST /repositories/:id/chat` | Pregunta en NL por repo. Body: `{ message, history?, scope?, twoPhase?, responseMode? }` — `scope`: `repoIds`, `includePathPrefixes`, `excludePathGlobs`. **`responseMode: 'evidence_first'`** → respuesta **JSON MDD** (7 secciones) en ingest local, o vía orchestrator + `mdd-evidence` (ver `services/ingest/src/chat/README.md`). |
| `POST /projects/:projectId/chat` | Chat por proyecto (todos los repos). Mismo body. |
| `POST /repositories/:id/analyze` | Análisis estructurado sobre **un repo** (`:id` = `roots[].id`). Body: `{ mode }` con `mode` ∈ `diagnostico` \| `duplicados` \| `reingenieria` \| `codigo_muerto` \| `seguridad` (mismo pipeline que por proyecto una vez resuelto el repo). |
| `POST /projects/:projectId/analyze` | Mismo handler unificado: `mode`: `agents` \| `skill` (AGENTS.md / SKILL.md) **o** modos de código anteriores. Para modos de código en proyecto **multi-root**, body opcional: `idePath` (ruta IDE absoluta o bajo un root) y/o `repositoryId` para fijar el root; si hay varios repos y faltan ambos → **400**. Resolución en `AnalyticsService` → `ChatService.analyze`. |
| `GET /repositories/:id/graph-summary` | Conteos y muestras de nodos indexados |
| `GET /projects/:id/graph-routing` | Enrutamiento Falkor; **`cypherShardContexts`** (`graphName`, `cypherProjectId`) cuando el proyecto tiene whitelist de dominios — el retriever/`execute_cypher` unen consultas sobre varios grafos con el `projectId` correcto por nodo. |

**Requisitos:** LLM (`LLM_*` o claves legacy) para chat y diagnósticos; embeddings: `EMBEDDING_PROVIDER` + API key para modo duplicados.

---

## 2. Flujo del Chat (Pipeline unificado)

Todas las preguntas pasan por el mismo pipeline. No hay clasificación code vs knowledge.

1. **Fase Retriever** — ReAct con tools (máx 4 turnos):
   - `execute_cypher`: busca archivos, componentes, funciones, DomainConcept en FalkorDB; con dominios permitidos recorre los pares de **`getCypherShardContexts`** (varios grafos / `projectId` por shard).
   - `semantic_search`: búsqueda vectorial (RAG) sobre Function, Component, Document, StorybookDoc y MarkdownDoc si hay embed-index.
   - `get_graph_summary`: conteos y muestras del grafo.
   - `get_file_content`: lee el código de los paths relevantes.
   - El Retriever NO escribe la respuesta; solo reúne contexto.

2. **Fase Synthesizer** — Depende de **`responseMode`**:
   - **`default`:** Un solo LLM con el contexto reunido. Opcionalmente precedido por **JSON `retrieval_summary`** cuando `twoPhase` está activo (`CHAT_TWO_PHASE` en ingest). Responde en prosa (procesos, flujos, impacto).
   - **`evidence_first` (ingest local):** Tras el Retriever, si el contexto está vacío se aplica **`injectPhysicalEvidenceFallback`** (paths `File` + lectura de `package.json`, prisma, env, openapi, etc.). Luego **no** se usa el LLM de prosa: se genera **`buildMddEvidenceDocument`** → **`answer`** = JSON MDD (7 claves) y **`mddDocument`** en la respuesta HTTP.
   - **`evidence_first` (con `ORCHESTRATOR_URL`):** El cliente pega al orchestrator; tras retrieve, **`nodeSynthesize`** llama **`POST /internal/repositories/:id/mdd-evidence`** en ingest y devuelve el mismo JSON (más **`mddDocument`** parseado en el orchestrator).
3. **Formato** — `formatResultsHuman()`: agrupa por path en los datos pasados al Synthesizer (solo aplica al modo **`default`**).

**Schema en prompt:** Nodos `File`, `Component`, `Function`, `StorybookDoc`, `MarkdownDoc`, `Route`, `Hook`, `Prop`, `NestController`, **`Model`**, **`OpenApiOperation`**, etc. Relaciones `CONTAINS`, `IMPORTS`, `CALLS`, `RENDERS`, `HAS_PROP`, **`DEFINES_OP`**. FalkorDB NO soporta `NOT EXISTS`; usar `OPTIONAL MATCH` + `count(x)=0`.

---

## 3. Métricas y Propiedades en el Grafo

### Function (nodo)

| Propiedad | Origen | Descripción |
|-----------|--------|-------------|
| `path`, `name`, `projectId` | Parser | Identidad |
| `startLine`, `endLine` | Parser | Rango de líneas |
| `loc` | Computado | `endLine - startLine + 1` |
| `complexity` | Parser | Complejidad ciclomática (McCabe): 1 + if/for/while/switch_case/ternary/catch |
| `nestingDepth` | Parser | Profundidad máxima de `statement_block` (>4 = spaguetti) |
| `description` | Parser | JSDoc extraído |
| `embedding` | embed-index | Vector para RAG (FalkorDB 4.0+) |

### Cálculo en el Parser (services/ingest/src/pipeline/parser.ts)

- **computeCyclomaticComplexity(bodyNode)** — Recorre AST, cuenta nodos `if_statement`, `for_statement`, `while_statement`, `do_while_statement`, `for_in_statement`, `for_of_statement`, `switch_case`, `ternary_expression`, `conditional_expression`, `catch_clause`.
- **computeNestingDepth(bodyNode)** — Recorre AST, incrementa depth en `statement_block`, `block`, `arrow_function`, `function`.

---

## 4. Diagnóstico (mode=diagnostico)

**Consultas Cypher ejecutadas:**
- Top 10 por riesgo: funciones con `outCalls`, `complexity`, `loc`, `description` → score compuesto en JS.
- Alto acoplamiento: `(a)-[:CALLS]->(b)` con `count(b) > 5`.
- Sin JSDoc: `description IS NULL OR = ''`.
- Componentes con muchas props: `(c)-[:HAS_PROP]->(p)` con `count(p) > 5`.
- **Anti-patrones:** `detectAntipatterns()` (ver sección 5).

**Score de riesgo:** `outCalls*3 + complexity*2 + (noDesc?5:0) + (loc>100?3 : loc>50?1 : 0)`.

**Output:** LLM genera informe markdown. Restricción: todo debe derivarse de los datos JSON (top10Risk, antipatrones, etc.); prohibido inventar problemas genéricos (tests, CI/CD).

---

## 5. Anti-Patrones y Malas Prácticas

**detectAntipatterns(repositoryId)** en `chat.service.ts`:

| Patrón | Query / Lógica | Umbral |
|--------|----------------|--------|
| Código spaguetti | `nestingDepth > 4` | Anidamiento excesivo |
| God function | `outCalls > 8` | Acoplamiento alto |
| Shotgun surgery | `inCalls > 5` (fan-in) | Función llamada desde muchos lugares |
| Imports circulares | Pares A→B y B→A en IMPORTS | Ciclo directo |
| Componentes sobrecargados | `(c)-[:RENDERS]->(child)` con `count > 8` | Prop drilling / complejidad |

---

## 6. Duplicados (mode=duplicados)

- **Requisito:** `embed-index` ejecutado (embeddings en Function).
- **Método:** Para cada función con embedding, `db.idx.vector.queryNodes` → vecinos con `score >= threshold` (default 0.85), excluir `score >= 0.999` (consigo misma).
- **Output:** Lista de pares `{ a, b, score }`.

---

## 7. Reingeniería (mode=reingenieria)

- Orquesta `analyzeDiagnostico` + `analyzeDuplicados`.
- Recibe datos crudos (riskRanked, highCoupling, noDescription, componentProps, antipatrones, duplicados) en JSON.
- **Alineación con el diagnóstico:** El plan generado sigue la misma estructura que el diagnóstico (Riesgo con path/name/riskScore, Anti-patrones con path/name y métrica, Funciones sin JSDoc, Quick wins) para que un agente pueda ejecutar cada acción 1:1 sin omitir ítems.
- Cada acción debe referenciar path/name concreto; prohibido consejos genéricos. Si no hay duplicados, prohibido recomendar "eliminar duplicados".

---

## 7.1 Código muerto (mode=codigo_muerto)

- **Propósito:** Análisis de uso de archivos — detalle completo por archivo.
- **Consultas:** `File IMPORTS`, `File CONTAINS`, `RENDERS`, `CALLS`, `Route`.
- **Por archivo:** (1) ruta exacta, (2) referencias (quién importa, quién renderiza componentes, quién llama funciones), (3) detalle funcional (Componentes/Funciones/Modelos), (4) conclusión (Sí se usa / No se usa).
- **Resumen:** Tabla final con Archivo | Ruta | Estado | Notas.
- **Entradas:** index.tsx, main.tsx, App.tsx y componentes en Route se consideran usados.
- **Normalización de paths:** Para reducir falsos positivos (archivos usados pero marcados como muertos), al construir y consultar IMPORTS se usa una forma canónica: barras unificadas (`/`), extensión de módulo quitada (`.ts`/`.tsx`/`.js`/`.jsx`). Así, si el grafo tiene la arista con un path y el archivo se guarda con otro (por extensión o barras), se considera que tiene importers. La verificación por contenido (import/require en otros archivos) usa además términos derivados del path (baseName, pathTail, pathSeg) para detectar referencias aunque el grafo no tenga la arista.

---

## 7.2 Seguridad (mode=seguridad)

- **Propósito:** Auditoría **heurística** sobre fuentes indexadas (p. ej. posibles secretos / higiene); la síntesis final pasa por LLM. **No** sustituye SAST ni pentest.
- **Requisitos:** `OPENAI_API_KEY` (mismo pipeline que otros modos con informe markdown).
- **Multi-root:** igual que el resto de modos de código: usar `POST /projects/:projectId/analyze` con `idePath` o `repositoryId` cuando el proyecto tenga varios repos.

---

## 8. Extensión y Modificación

### Añadir una nueva métrica al parser
1. En `parser.ts`: añadir cálculo (ej. `computeX(node)`), añadir a `FunctionInfo`.
2. En `producer.ts`: añadir a `onCreateSets`/`onMatchSets` para el nodo Function.
3. Tras cambio: **re-sync** necesario para nodos existentes.

### Añadir un nuevo anti-patrón
1. En `chat.service.ts` → `detectAntipatterns()`: nueva query Cypher o lógica en JS.
2. Añadir al objeto retornado y al contexto del prompt de diagnostico.

### Modificar el comportamiento del chat
1. En `chat.service.ts` → `runUnifiedPipeline`: ajustar prompts del Retriever o Synthesizer.
2. Retriever: instruir qué tools usar para tipos de preguntas concretas.
3. Synthesizer: ajustar restricciones de formato (prosa, longitud, estilo).

### Añadir un ejemplo Cypher para el LLM
1. En `chat.service.ts` → constante `EXAMPLES`: añadir bloque con "Pregunta: ..." y "```cypher ... ```".
2. Incluir nota si FalkorDB tiene limitaciones (ej. no NOT EXISTS).

---

## 9. Variables de Entorno (Chat/Analysis)

| Variable | Uso |
|----------|-----|
| `OPENAI_API_KEY` | Chat, diagnósticos, reingeniería (obligatorio) |
| `CHAT_MODEL` | Modelo OpenAI (default `gpt-4o-mini`) |
| `EMBEDDING_PROVIDER` | openai \| google (para duplicados) |
| `OPENAI_API_KEY` / `GOOGLE_API_KEY` | Embeddings (para duplicados) |

---

## 10. Frontend (Chat UI)

- **Ruta:** `/repos/:id/chat`
- **Layout:** Dos columnas: izquierda = botones (Diagnóstico, Duplicados, Reingeniería, Ver índice) + resultados; derecha = chat (mensajes + input).
- **API:** `api.chat()`, `api.analyze()`, `api.getGraphSummary()` en `frontend/src/api.ts`.
