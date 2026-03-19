# Plan: Grafo de Dominio para Extracción de Conocimiento

**Origen:** Observación de que el grafo actual modela **código** pero no el **dominio del problema**, lo cual limita la extracción de conocimiento.

---

## 1. Estado actual: Grafo de estructura de código

| Nodos | Relaciones | Preguntas que responde |
|-------|------------|------------------------|
| Project, File, Component, Function, Route, Hook, Prop, Model, NestController... | CONTAINS, IMPORTS, CALLS, RENDERS, HAS_PROP, USES_HOOK | ¿Dónde está X? ¿Quién llama a Y? ¿Qué props tiene Z? ¿Cuál es la estructura? |

**Fuente:** Cartographer (Tree-sitter) → Parser → Producer → FalkorDB

---

## 2. Gaps en extracción de conocimiento

Cuando el usuario pregunta:
- *"¿Qué tipos de cotizaciones existen?"*
- *"¿Cuáles son los cálculos específicos para días, horas y mes?"*

**Flujo actual:**
1. Cypher sobre grafo de **código** → busca Function/Component con términos (cotizador, precio, calcular)
2. `get_file_content` → lee archivos
3. **LLM extrae en tiempo de consulta** → tipos, fórmulas, reglas

**Limitaciones:**
- Cada pregunta = re-ejecución de extracción (coste de tokens, latencia)
- Sin índice previo de conocimiento de dominio
- La semántica depende de que el LLM “entienda” el código a partir del texto

---

## 3. Propuesta: Grafo de dominio (Domain Knowledge Graph)

### Nodos adicionales

| Nodo | Props | Origen |
|------|-------|--------|
| `:DomainConcept` | name, description, category (tipo\|opción\|entidad), projectId | Enums, constantes, JSDoc, nombres de componentes |
| `:Formula` | expression, mode (dias\|horas\|mes), projectId, sourcePath, sourceLine | Código que calcula precios/tarifas |
| `:BusinessRule` | rule, appliesTo (concepto o modo), projectId, sourcePath | Comentarios, JSDoc @rule |

### Relaciones

| Relación | Significado |
|----------|-------------|
| `(DomainConcept)-[:DEFINED_IN]->(Function\|Component)` | El concepto se deriva de este artefacto de código |
| `(Formula)-[:IMPLEMENTS]->(DomainConcept)` | Esta fórmula calcula este concepto |
| `(Formula)-[:FOR_MODE]->(DomainConcept)` | Aplica cuando mode = días/horas/mes |
| `(DomainConcept)-[:RELATES_TO]->(DomainConcept)` | Ej: Plaza → TipoMedio |

### Consultas que habilitaría

```cypher
// "qué tipos de cotizaciones existen"
MATCH (c:DomainConcept) WHERE c.projectId = $projectId AND c.category = 'tipo'
RETURN c.name, c.description

// "cálculos para días, horas y mes"
MATCH (f:Formula)-[:FOR_MODE]->(m:DomainConcept)
WHERE f.projectId = $projectId AND m.name IN ['dias','horas','mes']
RETURN f.expression, m.name, f.sourcePath
```

---

## 4. Cómo poblarlo

### Opción A: Extracción heurística (sin LLM en indexación)

1. **Enums/constantes:** Parser detecta `enum X` o `const Y = { A, B, C }` → `DomainConcept` con `category: 'opcion'`
2. **Componentes con patrón:** Nombres como `Cotizador*`, `*Template`, `*Modal` → `DomainConcept` con `category: 'tipo'`
3. **JSDoc @domain:** Si existe `/** @domain TipoMedio */` → `DomainConcept`
4. **Funciones con nombre:** `calcular*`, `actualizar*Precio*` → `Formula` con mode inferido por parámetros/condiciones (regex o AST)

### Opción B: Extracción asistida por LLM (en indexación)

1. Por cada Function/Component con `description` o path relevante (cotizador, precio, config)
2. Chunk de código + contexto → LLM con prompt: "Extrae conceptos de dominio (tipos, opciones) y fórmulas (expresión, modo: dias\|horas\|mes)"
3. Respuesta estructurada (JSON) → crear nodos `DomainConcept`, `Formula`, relaciones
4. Coste: 1 LLM call por batch de archivos (no por consulta)

### Opción C: Híbrido

- Heurística para enums, constantes, nombres de componentes
- LLM solo para archivos que contienen lógica de cálculo (handlers, utils)

---

## 5. Integración con KnowledgeExtraction

| Pregunta | Sin grafo dominio | Con grafo dominio |
|----------|-------------------|-------------------|
| "qué tipos de cotizaciones" | Cypher → funciones → leer código → LLM | Cypher → `DomainConcept` → respuesta directa o LLM para enriquecer |
| "cálculos para días/horas/mes" | Igual | Cypher → `Formula` WHERE mode → respuesta directa |
| "explicar algoritmo de X" | Siempre leer código + LLM | Grafo da contexto; LLM solo sintetiza |

---

## 6. Evaluación

| Criterio | Puntos |
|----------|--------|
| **Valor:** Reduce latencia y coste en consultas repetidas de dominio | Alto |
| **Complejidad:** Opción A (heurística) es asumible; Opción B requiere pipeline de indexación con LLM | Media-Alta |
| **Mantenibilidad:** El grafo de dominio debe reindexarse cuando cambia el código | Igual que hoy |
| **Riesgo:** Extracción incorrecta → respuestas erróneas. Mitigación: siempre citar sourcePath | Medio |

---

## 7. Estado de implementación

| Paso | Estado |
|------|--------|
| **MVP heurístico** | ✅ `DomainConcept` para enums, constantes (OPTIONS, TIPOS, etc.), componentes por patrón (Cotizador*, *Template, BrandRider, etc.) |
| **Pipeline domain-extract** | ✅ `pipeline/domain-extract.ts` + integrado en parser → producer → FalkorDB. `buildCypherDeleteFile` elimina DomainConcepts huérfanos |
| **answerTiposOpciones** | ✅ Consulta `DomainConcept` primero; si hay ≥5, usa LLM para enriquecer; si no, fallback a componentes + archivos |
| **Opción B (LLM en indexación)** | Placeholder: si el MVP da poco valor, añadir fase post-sync que envía chunks a LLM para extraer fórmulas y reglas de negocio |
