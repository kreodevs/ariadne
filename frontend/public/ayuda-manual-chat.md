# Chat y Análisis — Ariadne

Documentación del sistema de chat con repositorios, diagnósticos, métricas de complejidad y detección de anti-patrones. Para mantener o extender estas funcionalidades.

---

## 1. API y Endpoints

| Endpoint | Descripción |
|----------|-------------|
| `POST /repositories/:id/chat` | Pregunta en NL por repo. Body: `{ message, history? }` |
| `POST /projects/:projectId/chat` | Pregunta en NL por proyecto (todos los repos del proyecto). Body: `{ message, history? }` |
| `POST /repositories/:id/analyze` | Análisis estructurado. Body: `{ mode: 'diagnostico'|'duplicados'|'reingenieria'|'codigo_muerto' }` |
| `GET /repositories/:id/graph-summary` | Conteos y muestras de nodos indexados |

**Requisitos:** `OPENAI_API_KEY` para chat y diagnósticos. Embeddings: `EMBEDDING_PROVIDER` + API key para modo duplicados.

---

## 2. Flujo del Chat (Pipeline unificado)

Todas las preguntas pasan por el mismo pipeline. No hay clasificación code vs knowledge.

1. **Fase Retriever** — ReAct con tools (máx 4 turnos):
   - `execute_cypher`: busca archivos, componentes, funciones, DomainConcept en FalkorDB.
   - `semantic_search`: búsqueda vectorial (RAG) si hay embed-index.
   - `get_graph_summary`: conteos y muestras del grafo.
   - `get_file_content`: lee el código de los paths relevantes.
   - El Retriever NO escribe la respuesta; solo reúne contexto.

2. **Fase Synthesizer** — Un solo LLM con el contexto reunido:
   - Recibe datos crudos (Cypher, archivos, búsquedas).
   - Responde SIEMPRE en prosa humana: procesos, flujos, impacto, explicaciones.
   - Prohibido devolver listas crudas de paths/funciones; siempre síntesis narrativa.
3. **Formato** — `formatResultsHuman()`: agrupa por path en los datos pasados al Synthesizer.

**Schema en prompt:** Nodos `File`, `Component`, `Function`, `Route`, `Hook`, `Prop`, `NestController`, etc. Relaciones `CONTAINS`, `IMPORTS`, `CALLS`, `RENDERS`, `HAS_PROP`. FalkorDB NO soporta `NOT EXISTS`; usar `OPTIONAL MATCH` + `count(x)=0`.

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
- Recibe datos crudos (top10Risk, antipatrones, duplicados) en JSON.
- Cada acción debe referenciar path/name concreto; prohibido consejos genéricos.
- Si no hay duplicados, prohibido recomendar "eliminar duplicados".

---

## 7.1 Código muerto (mode=codigo_muerto)

- **Propósito:** Análisis de uso de archivos — detalle completo por archivo.
- **Consultas:** `File IMPORTS`, `File CONTAINS`, `RENDERS`, `CALLS`, `Route`.
- **Por archivo:** (1) ruta exacta, (2) referencias (quién importa, quién renderiza componentes, quién llama funciones), (3) detalle funcional (Componentes/Funciones/Modelos), (4) conclusión (Sí se usa / No se usa).
- **Resumen:** Tabla final con Archivo | Ruta | Estado | Notas.
- **Entradas:** index.tsx, main.tsx, App.tsx y componentes en Route se consideran usados.

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

- **Rutas:** `/repos/:id/chat` (chat por repo) y `/projects/:id/chat` (chat por proyecto).
- **Layout:** Dos columnas: izquierda = botones (Diagnóstico, Duplicados, Reingeniería, Código muerto, Ver índice) + resultados; derecha = chat (mensajes + input).
- **API:** `api.chat()`, `api.analyze()`, `api.getGraphSummary()` en `frontend/src/api.ts`; para proyectos se usa el endpoint de proyecto cuando hay `projectId`.
