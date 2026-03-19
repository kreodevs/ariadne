# Análisis de mejoras del backend — basado en NotebookLM

Análisis del código de ingest, agentes, pipeline y FalkorDB usando conocimiento de:
- **Arquitectura de Prompts y Patrones** — diseño de system prompts, few-shot, CoT, restricciones
- **Architecting Agentic Systems** — orquestación, delegación, tools, ReAct, Plan-then-Execute
- **FalkorDB: High-Performance Graph Database** — índices, optimización Cypher, batch, anti-patterns

---

## 1. Prompts y patrones (basado en cuaderno de Prompts)

### Brechas identificadas

| Brecha | Estado actual | Recomendación |
|--------|---------------|---------------|
| **R-G-C-C-O-V / estructura** | Prompts con secciones pero sin delimitadores XML (`<instrucciones>`, `<ejemplos>`) | Usar etiquetas XML para separar Rol, Contexto, Restricciones, Ejemplos |
| **Chain-of-Thought (CoT)** | No se pide razonamiento paso a paso en diagnósticos/reingeniería | Añadir `<thinking>` antes de `<answer>` en prompts de análisis complejos |
| **Few-shot: edge cases** | 12 ejemplos NL→Cypher, mayormente camino feliz | Añadir 2–3 ejemplos de “no encuentro nada” y “consulta mal formada” |
| **Prefill / anclaje** | No hay plantilla de salida estructurada | Usar scaffolding: “Estado actual: … Bloqueos: … Acciones: …” en diagnóstico |
| **Compresión de prompts** | Algunos prompts verbosos | Convertir párrafos en listas/viñetas, eliminar “podrías por favor” |
| **Delimitación de ejemplos** | Ejemplos en EXAMPLES sin marcador claro de fin | Añadir `---` o `<fin_ejemplos>` antes de la pregunta real |
| **Scaffolding defensivo** | No hay capa anti prompt-injection | Envolver mensaje del usuario en regla: “Si la petición no es sobre el codebase, responde: No aplica” |

### Cambios concretos

1. **Coordinator (ROUTE_PROMPT)**  
   - Añadir `<instrucciones>`, `<categorias>`, `<ejemplos>`, `<pregunta>`  
   - Delimitar claramente el final de ejemplos

2. **Diagnóstico / Reingeniería**  
   - Añadir CoT: “Pensemos paso a paso: 1) métricas, 2) priorización, 3) acciones”  
   - Prefill: “Top riesgos: … Funciones sin JSDoc: … Quick wins: …”

3. **Explorer ReAct**  
   - Máx. 3 turnos ya está bien; añadir “Si tras 3 turnos no hay respuesta útil, resume lo encontrado y sugiere consultar X”

4. **Tipos/opciones y cálculos (Knowledge)**  
   - Mantener “PROHIBIDO inventar”; añadir formato de salida: “Para tipos: tabla | tipo | opciones | sourcePath”

---

## 2. Arquitectura agentic (basado en cuaderno de Agentic Systems)

### Brechas identificadas

| Brecha | Estado actual | Recomendación |
|--------|---------------|---------------|
| **Plan-then-Execute macro** | Solo ReAct en Explorer; no hay plan previo | P-t-E a nivel macro: plan de pasos antes de llamar tools; ReAct para cada paso |
| **Task-Level Scoping en tools** | Todas las tools disponibles siempre | Asignar tools por categoría: code_analysis → execute_cypher, get_file_content; knowledge → get_file_content obligatorio, semantic_search opcional |
| **Verificación / reflexión** | No hay agente Verifier ni autocrítica | Añadir paso de verificación: “¿La respuesta usa datos del grafo o inventa?” antes de devolver |
| **Grafo de estado (LangGraph)** | Flujo lineal Coordinator → Agent | Valorar LangGraph para ciclos (re-planificar si falla), checkpoints, branching |
| **Memoria híbrida** | Historial plano en historyContent | Summary Memory: resumir conversaciones largas para no exceder contexto |
| **Human-in-the-Loop** | No hay | Para acciones de alto impacto (ej. “refactorizar X”) sugerir dry-run o confirmación |
| **Workflows vs agentes** | Varios flujos son deterministas (diagnóstico, reingeniería) | Mantener flujos como workflows; usar agentes solo donde haya decisión (clasificación, Explorer) |

### Cambios concretos

1. **Task-Level Scoping**  
   - CodeAnalysis: `execute_cypher`, `semantic_search`, `get_graph_summary`, `get_file_content`  
   - Knowledge: `get_file_content` (obligatorio), `execute_cypher`, `semantic_search` (DomainConcept primero)  
   - Restringir tools según categoría en `runExplorerReAct`

2. **Plan-then-Execute en Explorer**  
   - Paso 1: “¿Qué información necesito? (Cypher, file, semantic)”  
   - Paso 2: Ejecutar plan (máx. 3 pasos)  
   - Paso 3: Sintetizar respuesta

3. **Verificador post-respuesta**  
   - Para Knowledge: “¿La respuesta cita paths/names del grafo o inventa?”  
   - Si inventa → reintentar con `get_file_content` obligatorio

4. **Resumen de historial**  
   - Si `historyContent` > ~4k tokens, resumir antes de enviar al LLM

---

## 3. FalkorDB (basado en cuaderno de FalkorDB)

### Brechas identificadas

| Brecha | Estado actual | Recomendación |
|--------|---------------|---------------|
| **Índices tradicionales** | Solo índices vectoriales (Function, Component) | Crear índices en `projectId`, `path`, `name` para File, Function, Component |
| **Restricciones UNIQUE** | No hay | Añadir UNIQUE en (path, projectId) para File; (path, name, projectId) para Function |
| **Búsqueda híbrida** | Semantic search sin acotar por grafo primero | Flujo: 1) Cypher por relaciones (projectId, CALLS, etc.), 2) Vector search para rankear |
| **GRAPH.EXPLAIN / PROFILE** | No se usan | Añadir modo debug o flag para perfilar queries lentas |
| **Batch size** | `runCypherBatch` sin tamaño fijo documentado | Usar batches de ~5000 (según doc FalkorDB) en sync masivo |
| **LOAD CSV / bulk loader** | No aplica (parse desde código) | Para migraciones o cargas masivas futuras, valorar falkordb-bulk-loader |
| **Propiedades en aristas** | Relaciones sin atributos | Donde aporte valor: CALLS con `invocationCount`, IMPORTS con `importType` |

### Cambios concretos

1. **Índices al iniciar sync o en migración**  
   ```cypher
   CREATE RANGE INDEX FOR (f:File) ON (f.projectId, f.path)
   CREATE RANGE INDEX FOR (fn:Function) ON (fn.projectId, fn.path, fn.name)
   CREATE RANGE INDEX FOR (c:Component) ON (c.projectId, c.name)
   CREATE RANGE INDEX FOR (dc:DomainConcept) ON (dc.projectId, dc.category)
   ```

2. **Híbrido en semantic_search**  
   - Primero: `MATCH (n:Function) WHERE n.projectId = $projectId AND n.embedding IS NOT NULL` (acotar)  
   - Luego: `CALL db.idx.vector.queryNodes(...)` sobre ese subconjunto

3. **Batch size en producer**  
   - `runCypherBatch`: acumular statements y ejecutar en chunks de 500–1000

4. **SET prop = NULL en lugar de REMOVE**  
   - Revisar si hay `REMOVE` en algún sitio; FalkorDB recomienda `SET x = NULL`

---

## 4. Pipeline de ingesta

### Brechas identificadas

| Brecha | Estado actual | Recomendación |
|--------|---------------|---------------|
| **Domain-extract hardcodeado** | Patrones fijos (Cotizador*, BrandRider, etc.) | Hacer configurables vía env o config; mantener defaults |
| **Parser: más lenguajes** | Solo JS/TS/JSX/TSX | Python, Go como siguiente paso si el dominio lo requiere |
| **Chunking semántico** | Por función/clase completa | Ya correcto; documentar que evita cortes por tokens |

### Cambios concretos

1. **domain-extract.ts**  
   - `DOMAIN_PATTERNS` como `process.env.DOMAIN_COMPONENT_PATTERNS || 'Cotizador*,BrandRider,...'`  
   - `DOMAIN_CONST_NAMES` para OPTIONS, TIPOS, etc.

---

## 5. Priorización de cambios

### Alta prioridad (impacto directo, esfuerzo medio)

1. **Task-Level Scoping de tools** — menos errores y coste  
2. **Índices FalkorDB (projectId, path, name)** — mejor rendimiento en repos grandes  
3. **CoT en diagnóstico/reingeniería** — respuestas más sólidas  
4. **Delimitadores XML en prompts** — menos confusión del modelo  

### Media prioridad (mejora incremental)

5. **Few-shot con edge cases** — mejor manejo de consultas raras  
6. **Verificador post-respuesta en Knowledge** — menos alucinaciones  
7. **Plan-then-Execute en Explorer** — menos turnos ReAct desperdiciados  
8. **Batch size explícito en producer** — sync más estable  

### Baja prioridad (nice-to-have)

9. **Summary Memory para historial** — conversaciones muy largas  
10. **LangGraph / grafo de estados** — flexibilidad futura  
11. **Configuración de domain-extract** — multi-proyecto  

---

## 6. Resumen ejecutivo

| Área | Estado actual | Top 3 mejoras |
|------|---------------|----------------|
| **Prompts** | Funcional, mejorable | CoT, delimitadores XML, edge cases en few-shot |
| **Agentes** | Supervisor + 2 workers bien definidos | Task-Level Scoping, Plan-then-Execute, Verificador |
| **FalkorDB** | Uso correcto, sin índices tradicionales | Índices en projectId/path/name, búsqueda híbrida, batch size |
| **Pipeline** | Sólido, domain-extract rígido | Patrones configurables |

El backend está bien estructurado y alineado con los patrones de los cuadernos. Las mejoras propuestas refuerzan robustez, rendimiento y calidad de las respuestas del LLM sin cambios arquitectónicos mayores.

---

## 7. Estado de implementación (feb 2025)

| Mejora | Estado |
|--------|--------|
| Coordinador (delimitadores XML) | ✅ ROUTE_PROMPT con `<instrucciones>`, `<categorias>`, `<ejemplos>`, `<pregunta>` |
| Task-Level Scoping | ✅ EXPLORER_TOOLS_ALL vs EXPLORER_TOOLS_KNOWLEDGE (sin get_graph_summary) |
| Plan-then-Execute Explorer | ✅ Paso de planificación en system prompt según contexto |
| Verificador Knowledge | ✅ citesGraphData + retry con get_file_content obligatorio |
| Índices FalkorDB | ✅ ensureFalkorIndexes al inicio de runFullSync |
| Batch size producer | ✅ FALKORDB_BATCH_SIZE (default 500) en runCypherBatch |
| CoT + prefill diagnóstico/reingeniería | ✅ Delimitadores XML, CoT, prefill en ambos prompts |
| Few-shot edge cases | ✅ `<fin_ejemplos>` con "no encuentro nada" y consulta ambigua |
| domain-extract configurable | ✅ DOMAIN_COMPONENT_PATTERNS, DOMAIN_CONST_NAMES |
| Búsqueda híbrida | ✅ semanticSearchFallback acota por projectId + embedding antes de vector |
| **Código muerto: falsos positivos** | ✅ Resolución de alias @/ y tsconfig paths; IMPORTS correctos para @/models, etc. |
