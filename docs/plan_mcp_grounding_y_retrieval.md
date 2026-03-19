# Plan: grounding en grafo, filtrado multi-root y calidad de respuestas MCP/Ingest

**Estado:** MVP + §2, §3, §6 y métricas §7 implementados en ingest/MCP (ver §Implementado y tabla extendida).  
**Objetivo:** que FalkorSpecs deje de comportarse como “consultor genérico” y priorice respuestas **ancladas al índice** (grafo + repo), con trazabilidad y menos ruido entre roots (ERP vs frontend vs monorepo).

**Contexto en código actual (referencia):**

- Chat unificado: `services/ingest/src/chat/chat.service.ts` (`runUnifiedPipeline`, Retriever + Synthesizer).
- MCP `ask_codebase`: `services/mcp-falkorspec/src/index.ts` → ingest chat.
- `semantic_search` / fallback semántico en planes: mismo servicio + Cypher.
- `getModificationPlan`: `getModificationPlan` / `getModificationPlanByProject` en `chat.service.ts`.

---

## 1. Forzar evidencia en la respuesta (grounding)

**Problema:** rutas, porcentajes o listas de archivos “suenan” plausibles pero no están atadas a filas del grafo.

**Propuesta:**

| Acción | Detalle |
|--------|---------|
| Regla de servidor | Si la salida incluye **archivos, rutas o porcentajes**, deben provenir de **subconsultas** (Cypher o API interna ya validada), no solo del LLM. |
| Formato fijo | Sección **Evidencia**: lista `{ path, símbolo o import detectado, repoId }` cuando aplique. |
| Vacío explícito | Si `MATCH` / consulta devuelve 0 filas: texto tipo **“sin datos en índice para este alcance”**, sin relleno genérico. |
| System prompt | Prohibición explícita: **no inventar rutas** cuando la consulta estructurada devolvió vacío. |

**Impacto:** reduce “puede que…” sin anclaje; requiere tocar prompts del Synthesizer y posiblemente post-validación de cadenas que parezcan paths contra el conjunto retrieval.

---

## 2. Filtrar por `repoId` / prefijo de path antes del LLM

**Problema:** multi-root mezcla ERP, monorepo compos y `oohbp2`; el modelo recibe ruido o contexto irrelevante.

**Propuesta:**

- Parámetros explícitos (herramientas / ingest): `repoIds[]`, `includePathPrefixes[]`, `excludePathGlobs[]` (ej. excluir `**/erp/**`, root Strapi).
- **Default** para flujos tipo “migración OBP”: solo root `oohbp2` + opcionalmente `packages/ui` del monorepo; **no** ERP salvo que el usuario lo pida.

**Impacto:** cambios en contratos MCP + ingest (chat, `semantic_search`, `get_modification_plan`) y en Cypher para acotar `WHERE` por `repoId`/`path`.

---

## 3. `ask_codebase` en dos fases (o tools internas)

**Problema:** un solo pase largo → resúmenes vagos o límites de tokens.

**Propuesta:**

| Fase | Rol |
|------|-----|
| **1 — Retrieval** | Consultas deterministas (grafo + búsqueda textual de imports); salida **JSON estructurado** (conteos por paquete, top N archivos, aristas `IMPORTS`). |
| **2 — Redacción** | El LLM **solo interpreta** ese JSON; no infiere el repo. |

**Opcional:** herramientas internas tipo `list_imports(scope, packageGlob)` y obligar a invocarlas antes de la respuesta final al usuario.

**Impacto:** refactor del pipeline en `chat.service.ts` (y posiblemente del Coordinator en agentes).

---

## 4. `semantic_search` que devuelve 0 resultados

**Problema:** si casi siempre da vacío, suele ser **indexación / tokenización**, no culpa del usuario.

**Propuesta:**

- Indexar imports literales (`from 'primereact/...'`, `@imj_media/...`) como **campos dedicados** en `File` o índice full-text.
- Normalizar alias (`@imj_media/ui` vs rutas `packages/ui`, paths de `tsconfig`).
- **Diagnóstico en la respuesta:** por qué no hubo hits (índice vacío, scope incorrecto, repo sin sync), no solo “no encontré nada”.

**Impacto:** parser/producer + posible pasada de backfill en sync.

---

## 5. `get_modification_plan`: límites y relevancia

**Problema:** listas enormes poco accionables (miles de líneas / PDF mental).

**Propuesta:**

- **Cap** configurable: máximo N archivos.
- Orden por **centralidad** o nº de importadores en el grafo (heurística documentada).
- **Post-filtro duro** por `repoId` / prefijo `src/` del alcance pedido; si el NL contradice el filtro, prevalece el filtro.
- **Score de confianza** por archivo: “visto en grafo” vs “inferido” (si en el futuro se mezcla heurística).

**Impacto:** `getModificationPlan` en `chat.service.ts` + configuración (env o `domain_config`).

---

## 6. Enriquecer el grafo / contratos (props de componentes)

**Problema:** `get_contract_specs` sin props en `Button` → el LLM no puede ser específico si el índice no extrajo la API.

**Propuesta:**

- Mejor extracción de props React: interfaces TS, `React.forwardRef` + `ComponentProps`, etc.
- **Opcional:** ingerir `.d.ts` o barrels de `packages/ui` como fuente de exports para paquetes publicados.

**Impacto:** `parser.ts` / producer, posible ingest adicional de tipos.

---

## 7. Telemetría para iterar

**Problema:** sin métricas, no se sabe si las mejoras funcionan.

**Propuesta (por request):**

- Tamaño del contexto inyectado, nº de chunks, `repoIds` incluidos.
- Si la respuesta citó al menos **K** rutas presentes en el retrieval.
- Muestreo: % respuestas con rutas **verificables** vs alucinadas (comparación con `get_file_content` o hash de archivo en repo).

**Impacto:** logging estructurado en ingest + opcional dashboard / logs agregados.

---

## Orden sugerido (histórico)

Lo anterior ya está cubierto por el MVP + tabla «Implementado adicional» (§1–§3, §5–§7 parcial). Siguiente ROI: **§4** imports literales en índice, centralidad en modification-plan, post-validación de paths.

---

## Implementado (MVP ingest)

| Sección | Qué hay hoy |
|---------|-------------|
| §1 Grounding | Prompts del Retriever y Synthesizer en `runUnifiedPipeline`: sección **## Evidencia**, prohibición de inventar rutas si el contexto está vacío o 0 filas, mensaje **sin datos en índice para este alcance**. |
| §4 Diagnóstico semantic vacío | `getSemanticSearchDiagnostics()` en `chat-handlers.service.ts`; el tool `semantic_search` adjunta el diagnóstico cuando no hay hits. |
| §5 Límite modification-plan | `MODIFICATION_PLAN_MAX_FILES` (default 150, máx. 2000) en `getModificationPlan`. |
| §7 Telemetría | `CHAT_TELEMETRY_LOG=1` → `chat_unified_pipeline`: tamaños, `projectScope`, citas path, **`pathGroundingRatio`** / `pathGroundingHits` vs retrieval. |

**Pendiente (backlog menor):** post-validación estricta de paths en servidor, imports literales dedicados (§4), score por centralidad en modification-plan.

**Implementado adicional:**

| Sección | Qué hay |
|--------|---------|
| §2 Filtros | `ChatScope` en `chat-scope.util.ts`; `POST .../chat` y tools del pipeline filtran Cypher, `semantic_search` y `get_file_content`; `getModificationPlan` post-filtra `filesToModify`. MCP: `scope` en `ask_codebase` y `get_modification_plan`. |
| §3 Dos fases | JSON `retrieval_summary` inyectado antes del contexto bruto; `twoPhase` en body / `CHAT_TWO_PHASE` (default on; `0\|false\|off` desactiva el bloque estructurado). |
| §6 Parser props | `parser.ts`: interfaces `XProps`, `type XProps = { ... }`, `forwardRef<..., PropsType>` fusionados en `propsByComponent`. |
| §7 Alucinación (muestreo) | Con `CHAT_TELEMETRY_LOG=1`: `pathGroundingHits`, `pathGroundingRatio`, `pathCitationsUnique` vs contexto + filas retrieval. |

---

## Referencias cruzadas

- Multi-root y `roots[].id`: `docs/plan_multi_root.md`, `AGENTS.md`, `frontend/public/mcp_server_specs.md`.
- Chat y análisis: `docs/CHAT_Y_ANALISIS.md`.
