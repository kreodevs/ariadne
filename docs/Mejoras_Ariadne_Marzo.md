# Mejoras Ariadne — plan de implementación (marzo y siguientes)

Documento que condensa la recomendación de priorización respecto a los cuatro pilares (GraphRAG híbrido, multi-agente LangGraph, ingesta distribuida / lineage, CI y multi-lenguaje). Orden pensado para **un solo equipo**, asumiendo **Falkor con sharding**, **MCP**, **ingest AST** y **orchestrator** ya operativos.

---

## Resumen ejecutivo

| Prioridad | Bloque | Cuándo |
|-----------|--------|--------|
| Alta | Métricas y SLO (Fase 0) | Ahora |
| Alta | CI preventivo en PR (Pilar 4) | Tras Fase 0 o en paralelo |
| Alta | GraphRAG: vector → expansión Cypher 1–2 hops (Pilar 1a) | Tras CI estable o en paralelo con segundo dev |
| Media | Ingest por archivo + consolidación cross-file (Pilar 3a) | Solo si hay dolor real (timeouts, repos grandes) |
| Media | Orquestador con “replan” mínimo (Pilar 2 reducido) | Tras mejor contexto (Fase 2) o si el flujo lineal falla mucho |
| Baja / piloto | Dominio LLM en ingest (`:BusinessRule` / `:Formula`, Pilar 1b) | Cliente o caso de negocio claro + RAG estructural ya bueno |
| Baja / acotado | Data flow / taint ligero (Pilar 3b) | Caso de uso que lo pague (seguridad, migración, auditoría) |
| Estratégica / bajo demanda | Multi-lenguaje Tree-sitter (Pilar 4) | Contrato o repo real multi-stack |

---

## Fase 0 — Base (1–2 semanas, en paralelo con todo)

**Objetivo:** poder decidir con datos si GraphRAG o ingesta son el cuello de botella.

- Métricas mínimas: latencia RAG/chat, tasa de “no encontrado”, repos o archivos que rompen ingest.
- Definir **SLO** (ej. P95 chat, P95 job de PR).

**Cuándo:** inmediatamente, antes de features grandes.

---

## Fase 1 — CI preventivo en PR (Pilar 4, recortado)

**Objetivo:** Relic fuera del IDE en el momento que más importa (revisiones).

**Qué implementar:**

- GitHub Action o Bitbucket Pipe en `pull_request`.
- Obtener diff en CI o enviar `stagedDiff` / equivalente a vuestro backend.
- Usar **`analyze_local_changes`** y, si aplica, impacto legacy / contrato (`get_legacy_impact`, etc.).
- Comentario automático en PR: archivos tocados, impacto resumido, **riesgo ALTO / MED / BAJO** (reglas simples al inicio).

**Cuándo:** justo después de Fase 0, o en paralelo si hay capacidad.

**Por qué primero:** alto ROI/DevEx, reutiliza piezas existentes, no bloquea el resto.

---

## Fase 2 — GraphRAG híbrido: vector → subgrafo local (Pilar 1a)

**Objetivo:** el sintetizador recibe **uso estructural**, no solo vecinos semánticos.

**Qué implementar:**

1. Top-K por embedding (flujo actual).
2. Por cada ancla: Cypher **profundidad 1–2** (CALLS, IMPORTS, RENDERS, acorde al modelo actual del grafo).
3. Serializar **subgrafo** (nodos + aristas + paths) hacia el LLM, con **tope** de tamaño/tokens y deduplicación.

**Dónde tocar:** pipeline RAG del ingest/chat y/o alineación con `semantic_search` / embeddings en MCP según arquitectura actual.

**Cuándo:** tras Fase 1 estable, o en paralelo si hay segundo dev **y** shard/`projectId` correcto en prod.

**Dependencia crítica:** grafo correcto por `projectId` (sharding) en todas las lecturas.

---

## Fase 3 — Ingest resiliente “por archivo” (Pilar 3a, progresivo)

**Objetivo:** dejar de reventar parser/memoria en repos o archivos enormes **sin** saltar a Map-Reduce el primer día.

**Progresión:**

1. Particionar trabajo **por archivo** (cola de jobs o tabla de jobs; encaja con re-sync incremental).
2. Límites y estrategia explícita para archivos gigantes (chunk AST, truncate, o skip marcado).
3. **Segundo pase** de consolidación de aristas **cross-file** (imports/exports).

**Map-Reduce “de verdad”** (muchos workers, Rabbit/Bull): solo cuando los pasos anteriores no basten en producción.

**Cuándo:** cuando haya **incidentes medibles** (timeouts, OOM, sync eterno). Si no duele, esta fase puede **esperar**.

---

## Fase 4 — Orquestador: grafo con “replan” (Pilar 2, MVP)

**Objetivo:** evolucionar el SDD sin inflar a tres agentes nombrados desde el día uno.

**Qué implementar:**

- Flujo: plan → validación de contrato / impacto → si falla → **volver a planificar** con feedback estructurado (ej. rompe `HAS_PROP` X).
- Reutilizar herramientas MCP existentes.

**Cuándo:** después de Fase 2 (mejor contexto → menos replans absurdos) o cuando el flujo lineal falle de forma habitual en demos.

**Evolución posterior:** roles **Architect / Risk Assessor / Coder** y paralelismo cuando el grafo de replan sea estable.

---

## Fase 5 — Dominio en grafo con LLM en ingest (Pilar 1b, piloto)

**Objetivo:** respuestas de negocio sin leer todo el código en cada pregunta.

**Qué implementar:**

- Modelo rápido/barato sobre chunks acotados post-AST.
- Nodos tipo `:BusinessRule` / `:Formula` (o un solo tipo al inicio) y relaciones al AST (ej. `IMPLEMENTS` hacia concepto de dominio).
- **Solo en módulos piloto** (un bounded context), no en todo el monorepo el primer día.

**Cuándo:** haya cliente o caso interno recurrente de **preguntas de negocio** y Fase 2 demueste que el RAG estructural ya es sólido.

---

## Fase 6 — Data flow / taint ligero (Pilar 3b)

**Objetivo:** trazas de datos útiles sin pretender “estado global completo” en React.

**Enfoque inicial acotado:**

- Props explícitas padre → hijo.
- Stacks ya modelados (ej. Nest: controller → service → repositorio), si aplica.

**Cuándo:** después de Fases 2–4 y con un **caso de uso** que justifique el coste (compliance, migración, seguridad).

---

## Fase 7 — Multi-lenguaje (Pilar 4, backend)

**Objetivo:** mismo grafo multi-root con gramáticas adicionales (Python/Go/Java).

**Cuándo:** **demanda contractual o repo real** multi-stack. Antes es YAGNI.

---

## Cronología en una línea

```text
F0 métricas → F1 CI PR → F2 vector + expansión grafo
  → (F3 ingest por archivo si duele) → F4 replan en orchestrator
  → (F5 dominio LLM piloto si hay negocio) → (F6 taint acotado si hay caso)
  → (F7 multi-lang si hay demanda)
```

---

## Paralelización recomendada

- Con **un dev:** F0 → F1 → F2 → decidir F3 según incidentes → F4 → resto bajo demanda.
- Con **dos devs:** F1 en paralelo con F2 **después** de tener métricas y shards estables en prod.
- **F3** no arrancar por moda: solo si el ingest es el fuego real.

---

## Referencias internas (código / docs)

- MCP y herramientas: `services/mcp-ariadne`, `docs/MCP_HTTPS.md`, `docs/mcp_server_specs.md`
- Ingest / chat / embeddings: `services/ingest`
- Orquestador: `services/orchestrator`
- Grafo y sharding: `packages/ariadne-common`, `services/api`

---

*Última actualización: marzo 2026 — plan vivo; revisar prioridades tras Fase 0.*
