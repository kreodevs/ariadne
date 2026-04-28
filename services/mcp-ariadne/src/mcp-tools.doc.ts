/**
 * @fileoverview **Catálogo JSDoc** de las herramientas MCP del servidor **AriadneSpecs Oracle** (`index.ts`).
 * Paridad: mismos `name` que el array devuelto por `ListToolsRequestSchema`. Las descripciones de producto
 * para el cliente MCP siguen en `description` de cada tool; aquí se documenta **contrato técnico** para
 * colaboradores (dependencias HTTP, grafo, multi-root).
 *
 * @packageDocumentation
 * @module mcp-tools.doc
 * @copyright 2026 Jorge Correa
 * @license Apache-2.0
 *
 * ## Entorno y autenticación
 *
 * - **INGEST_URL** (o `ARIADNESPEC_INGEST_URL`): chat, análisis, archivos, `list_known_projects` vía REST.
 * - **ARIADNE_API_URL** + **ARIADNE_API_BEARER** / **ARIADNE_API_JWT**: rutas `GET /api/graph/*` (paridad UI).
 * - **FalkorDB**: fallback cuando no hay API/ingest; sharding vía `ariadne-common`.
 * - **`.ariadne-project`**: el IDE debe leer `projectId` y pasarlo donde aplique (ver `MCP_INSTRUCTIONS` en `index.ts`).
 *
 * ## Herramientas (nombre MCP → rol técnico)
 *
 * | Tool | Rol |
 * |------|-----|
 * | `list_known_projects` | Descubre `id` de proyecto y `roots[].id` de repo (multi-root). Origen: ingest o grafo. |
 * | `get_component_graph` | Subgrafo de componente (RENDERS, IMPORTS, hooks). Preferencia API Nest; fallback Falkor. |
 * | `get_c4_model` | Contenedores C4 + COMMUNICATES_WITH. API `GET /api/graph/c4-model`. |
 * | `get_legacy_impact` | Impacto inverso (quién llama/renderiza). API `GET /api/graph/impact` o Falkor. |
 * | `get_contract_specs` | Props y firmas desde scanner (contrato SDD). |
 * | `get_functions_in_file` | Nodos Function/Component por ruta de archivo (`CONTAINS`). |
 * | `get_import_graph` | Aristas IMPORTS alrededor de un archivo. |
 * | `get_file_content` | Lectura de archivo vía ingest (`/repositories/:id/file` o proyecto). |
 * | `validate_before_edit` | Precondición SDD: impacto + contrato antes de editar nodo. |
 * | `semantic_search` | Búsqueda híbrida vector+keyword; `projectId` puede ser repo o proyecto. |
 * | `get_project_analysis` | POST análisis ingest (`diagnostico`, `duplicados`, `reingenieria`, `codigo_muerto`, `seguridad`). |
 * | `ask_codebase` | Pregunta NL; modos `responseMode` / `deterministicRetriever` (ver specs MCP en docs). |
 * | `get_modification_plan` | Plan legacy: `filesToModify` + preguntas; preferir `roots[].id` en multi-root. |
 * | `get_definitions` | Definición de símbolo (archivo + líneas). |
 * | `get_references` | Usos de símbolo (refactor seguro). |
 * | `get_implementation_details` | Firma, props, endpoints asociados al símbolo. |
 * | `trace_reachability` | Alcance desde entrypoints (código muerto heurístico). |
 * | `check_export_usage` | Exports sin importadores. |
 * | `get_affected_scopes` | Radio de explosión ante cambio en nodo + tests opcionales. |
 * | `check_breaking_changes` | Heurística de ruptura si se quitan parámetros. |
 * | `find_similar_implementations` | Búsqueda semántica de implementaciones parecidas. |
 * | `get_project_standards` | Fragmentos de config (ESLint, Prettier, tsconfig). |
 * | `get_file_context` | Archivo + imports + exports (workflow paso 2). |
 * | `analyze_local_changes` | Diff staged vs grafo (pre-commit). |
 * | `get_sync_status` | Estado de sync/indexación. |
 * | `get_debt_report` | Deuda técnica agregada (huérfanos, complejidad). |
 * | `find_duplicates` | Duplicados cross-package (fingerprints). |
 *
 * @see {@link ./index.ts} registro `ListToolsRequestSchema` y despacho `CallToolRequestSchema`
 * @see Documentación de producto: `docs/notebooklm/mcp_server_specs.md`
 */

/**
 * Revisión del catálogo documentado; subir si se añade/elimina una tool en `index.ts`.
 * @constant
 */
export const MCP_ARIADNE_TOOLS_DOC_REVISION = 1;
