---
name: ariadnespecs-mcp
description: Protocol for using MCP AriadneSpecs Oracle tools when maintaining legacy code. Use when: diagnóstico de archivo/componente/hook (e.g. "diagnóstico de usePauta.tsx"), AriadneSpecs MCP, technical debt, validate_before_edit, get_project_analysis, semantic search, refactoring legacy components, or user mentions Ariadne, FalkorDB, or project analysis. Always invoke MCP tools (get_component_graph, get_legacy_impact, get_definitions, get_references) when user asks for file/component diagnostics—do NOT rely only on Read/Grep.
---

# AriadneSpecs MCP Protocol

Protocol for using the MCP AriadneSpecs Oracle tools (get_component_graph, validate_before_edit, get_project_analysis, etc.) when maintaining indexed codebases.

## Session Start

1. **Run `list_known_projects`** to map project names to IDs.
2. If `.ariadne-project` exists in workspace root, read its `projectId` and use it in all MCP calls.
3. If user mentions project by name (e.g. "oohbp2"), use `list_known_projects` → find matching `id` → pass as `projectId`.
4. **Grafo de componente / impacto / C4:** el MCP usa el API Nest (`ARIADNE_API_URL` + `ARIADNE_API_BEARER` / `ARIADNE_API_JWT`) cuando está configurado; sin JWT, `get_component_graph` y `get_legacy_impact` hacen fallback Falkor y el resultado puede no coincidir con el explorador. El markdown de respuesta indica la fuente.

## Tools by Intent

| User Intent | Tool | Flow |
|-------------|------|------|
| **Diagnóstico de archivo/componente/hook** ("diagnóstico de usePauta.tsx", "analiza Board") | `get_component_graph`, `get_legacy_impact`, `get_definitions`, `get_references` | **Use MCP first**, not just Read/Grep. list_known_projects → projectId → get_component_graph + get_legacy_impact + get_definitions/get_references. |
| Diagnóstico proyecto, duplicados, reingeniería, código muerto, seguridad (`seguridad`) | `get_project_analysis` | list_known_projects → `projectId` (proyecto o `roots[].id`) + `currentFilePath` si multi-root → `get_project_analysis(projectId?, mode, currentFilePath?)`. **Código muerto:** presentar el resultado tal cual. El backend es la fuente de verdad. |
| "¿Cómo funciona X?", arquitectura amplia, login end-to-end sin archivo ancla | `ask_codebase` | `projectId` + `question` **concretas** + **`scope`** si multi-root; ver **Routing: `ask_codebase`** y tabla **The Forge** abajo |
| Ya tienes **path** o **nombre de símbolo** (función, componente, clase) | **`get_file_content`**, **`get_definitions`**, **`get_references`**, **`get_component_graph`** | **No** abras con `ask_codebase` solo para leer un archivo o un grafo local: más lento y más tokens |
| Búsqueda por término | `semantic_search`, `find_similar_implementations` | Direct query |
| Antes de editar componente/función | `validate_before_edit` | Required — returns impact + contract |

**Never invent props or assume IDs.** Use what the graph returns.

## Routing: `ask_codebase` (cuándo sí / cuándo no)

`ask_codebase` orquesta **ReAct + tools +** (según modo) **sintetizador** → alto coste en **latencia y tokens**. Úsalo cuando la pregunta sea **exploratoria** o cruce **varias fuentes** (grafo + Prisma + OpenAPI + docs). Evítalo cuando una herramienta **más estrecha** baste.

### Preferir otra tool (mismo resultado, menos coste)

| Situación | Usar primero |
|-----------|----------------|
| Contenido de un archivo conocido | `get_file_content` |
| Dónde se define `Foo` / firma / líneas | `get_definitions`, `get_implementation_details` |
| Quién importa o llama a `Foo` | `get_references`, grafo (`get_component_graph` si es UI) |
| Impacto de un **componente** concreto | `get_component_graph` + `get_legacy_impact` |
| Deuda / duplicados / seguridad / código muerto (informe cerrado) | `get_project_analysis` con `mode` adecuado |
| Lista de archivos a tocar para un cambio grande | `get_modification_plan` |
| Solo “¿dónde está X en el repo?” (término suelto) | `semantic_search` o `find_similar_implementations` |

### Si usas `ask_codebase`, acota siempre

1. **`scope`**: en monorepo / multi-root, `repoIds` (= `roots[].id`), `includePathPrefixes` y/o `excludePathGlobs` para no barrer todo el índice.
2. **`projectId`**: preferir **`roots[].id`** del repo donde vive el código si el cambio es local a ese root.
3. **`currentFilePath`**: cuando el `projectId` sea el del **proyecto** Ariadne y haya varios roots — ayuda a anclar el repo correcto.
4. **Pregunta concreta**: nombres de módulos, endpoints, errores, rutas de archivo sospechosas; evita “explícame el proyecto entero” en una sola llamada si puedes partir en 2 preguntas acotadas.

### Modo de respuesta (trade-off)

| Necesidad | `responseMode` | Notas |
|-----------|----------------|--------|
| SDD / LegacyCoordinator / JSON estable | **`evidence_first`** | `answer` = JSON MDD |
| Cliente (Forge) va a sintetizar; quieres **menos LLM en retrieve** | **`raw_evidence`** + **`deterministicRetriever: true`** | Secuencia fija de tools en ingest; menos “inteligente”, más barato/rápido en retrieve |
| Respuesta legible en prosa sin struct MDD | `default` | Sigue siendo ReAct + sintetizador → no lo uses solo por comodidad si `evidence_first` encaja |

### Anti-patrones (evitar)

- **`ask_codebase`** con pregunta vaga **sin** `scope` en proyecto con varios repos.
- Repetir **`ask_codebase`** para el mismo subproblema ya resuelto en la sesión (reutiliza paths/evidencia del JSON anterior).
- **`default`** cuando el consumidor esperaba JSON estructurado (**`evidence_first`** / **`raw_evidence`**).

## The Forge / `ask_codebase` (alineación contrato)

| `responseMode` | `answer` (texto MCP) | Retrieval |
|----------------|----------------------|-----------|
| **`evidence_first`** | JSON **MDD** (7 claves: `summary`, `openapi_spec`, `entities`, `api_contracts`, `business_logic`, `infrastructure`, `risk_report`, `evidence_paths`) | ReAct LLM + tools |
| **`raw_evidence`** | JSON **`JSON.parse(answer)`**: `mode`, `deterministicRetriever`, `gatheredContext`, `collectedResults`, `cypher` — **The Forge sintetiza** a partir de ahí | ReAct LLM + tools **salvo** si `deterministicRetriever: true` → secuencia fija en ingest (sin LLM en retrieve) |
| `default` (omitir) | Prosa | ReAct + sintetizador |

- SDD compacto / LegacyCoordinator: **`evidence_first`**.
- Máximo control y coste de retrieval bajo: **`raw_evidence`** + **`deterministicRetriever: true`** (menos selectivo que ReAct; no “entiende” la pregunta para elegir tools).

## Before Editing (SDD)

**OBLIGATORY** before modifying a component or function:

1. Call `validate_before_edit(nodeName, projectId?)`.
2. If `[NOT_FOUND_IN_GRAPH]` → do not proceed; suggest reindex.
3. Use props/signatures from the response — do not invent.
4. Use `get_file_content` for current code.

## Refactoring Flow

1. **Find** → semantic_search / find_similar_implementations
2. **Context** → get_file_context / get_definitions + get_references
3. **Validate** → validate_before_edit + check_breaking_changes
4. **Edit** → apply change
5. **Imports** → see "Imports when creating new files"

Before renaming: `get_references`. Before new code: `find_similar_implementations` + `get_project_standards`.

## Imports when creating new files

**REQUIRED** when extracting code to a new file (hook, util, component):

- **Do NOT assume folder structure.** e.g. `contexts` may be in `src/contexts` or `src/components/contexts` — the relative path depends on actual location.
- **Derive paths from the file being refactored.** Use the original file's import paths as reference. If it imports `../../contexts/usePauta`, the module is 2 levels up from the original. From the new file's folder, compute the equivalent path.
- **Verify actual location** of each imported module: `get_definitions` (node path) or list repo. Never invent paths.
- **Include in refactoring plan:**
  - Step: "After creating the new file, verify import paths are correct from its location."
  - Step: "Run `npm run build` or `npm run dev` and fix import resolution errors until everything compiles."
- Import paths in the new file must resolve **from the new file's folder**, not from the source file.
