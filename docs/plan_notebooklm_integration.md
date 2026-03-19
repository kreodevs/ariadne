# Plan: Integración NotebookLM + Análisis Avanzado

Basado en 4 cuadernos de NotebookLM:
1. **FalkorDB: High-Performance Graph Database** — GraphRAG, vector search híbrido, code graphs
2. **Specification-Driven Development** — Contratos, validación, indexación desde specs
3. **Arquitectura de Prompts y Patrones** — CoT, ToT, ReAct, multi-agente, meta-prompting
4. **Architecting Agentic Systems** — Self-Refine, verificadores, reingeniería con agentes

## Objetivo

Que Ariadne, usando FalkorDB + Chat + MCP, permita a la IA y al usuario:
- Entender todo el proyecto
- **Diagnóstico de deuda técnica**
- **Recomendaciones de reingeniería**
- **Detección de código duplicado**

## Arquitectura actual vs. objetivo

| Componente | Actual | Objetivo |
|------------|--------|----------|
| Indexación | Sync → FalkorDB (File, Component, Function, Route, etc.) | Igual + embeddings opcionales |
| RAG | `semantic_search` (keyword + vector si hay embed-index) | GraphRAG: grafo + vector híbrido |
| Chat | NL → Cypher → FalkorDB | + modos: pregunta, diagnostico, reingenieria, duplicados |
| MCP | get_legacy_impact, get_contract_specs, semantic_search | **get_project_analysis(projectId, mode)** cubre los 3: mode=diagnostico (deuda técnica), mode=duplicados (código duplicado), mode=reingenieria (recomendaciones). También mode=codigo_muerto. |

## Implementación

### 1. Diagnóstico de deuda técnica
- **Fuente:** Patrón Chain-of-Thought / Tree of Thoughts (Arquitectura Prompts), Self-Refine (Agentic Systems)
- **Input:** projectId, contexto del grafo (conteos, muestras, acoplamiento)
- **Flujo:** Consultas Cypher para métricas → prompt estructurado con CoT → LLM produce informe
- **Métricas extraíbles:** archivos sin JSDoc, componentes con muchas props, funciones largas (si tuviéramos líneas), alto acoplamiento (CALLS), imports circulares

### 2. Código duplicado
- **Fuente:** FalkorDB vector search (FalkorDB notebook), embeddings en Function/Component
- **Método:** Para cada Function (y opcionalmente Component) con `embedding`, `CALL db.idx.vector.queryNodes` → vecinos con score > umbral (ej. 0.92) = potencial duplicado semántico
- **Output:** Lista de pares (path, name) con score de similitud

### 3. Reingeniería
- **Fuente:** Patrón Self-Refine, agentes Verificadores (Agentic Systems), SDD
- **Input:** Diagnóstico + duplicados + grafo de dependencias
- **Flujo:** LLM con prompt de "arquitecto senior" genera recomendaciones priorizadas: refactors, extracción de utilidades, consolidación de duplicados

### 4. Mejoras Chat
- Inyectar resúmenes de los 4 notebooks como contexto de sistema (o pocos ejemplos)
- Modo explícito: `?mode=diagnostico|duplicados|reingenieria|pregunta`

### 5. MCP
- **get_project_analysis(projectId, mode)** — Una herramienta con `mode`: `diagnostico` (deuda técnica), `duplicados` (código duplicado), `reingenieria` (recomendaciones), `codigo_muerto` (análisis de uso por archivo). Llama a `POST /repositories/:id/analyze` con `{ mode }`. Equivale a las 3 consultas planeadas: get_technical_debt_report → mode=diagnostico; get_duplicate_code → mode=duplicados; get_reengineering_suggestions → mode=reingenieria.

## Fases

| Fase | Entregable | Estado |
|------|------------|--------|
| 1 | Endpoint `POST /repositories/:id/analyze` con mode=duplicados | ✅ Hecho |
| 2 | Endpoint mode=diagnostico | ✅ Hecho (top riesgo, antipatrones, acoplamiento, JSDoc, loc, complexity, nestingDepth) |
| 3 | Endpoint mode=reingenieria | ✅ Hecho |
| 4 | Modos en Chat UI | ✅ Hecho (layout split: diagnósticos izquierda, chat derecha) |
| 5 | Tools MCP | ✅ Hecho — **get_project_analysis(projectId, mode)** con mode=diagnostico\|duplicados\|reingenieria\|codigo_muerto |

**Anti-patrones implementados:** spaghetti (nestingDepth>4), God function (outCalls>8), shotgun (inCalls>5), imports circulares, componentes sobrecargados (RENDERS>8). Ver [CHAT_Y_ANALISIS.md](CHAT_Y_ANALISIS.md).
