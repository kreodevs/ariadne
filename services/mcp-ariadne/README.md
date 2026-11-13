# ariadne-mcp (AriadneSpecs MCP Server)

Servidor MCP que expone herramientas de contexto sobre el grafo en FalkorDB.

**Transporte:** Streamable HTTP (puerto 8080 o `PORT`). **Modo stateless:** un Server+Transport por request, evita el error "Server already initialized" cuando Cursor reintenta el handshake. Con autenticación activa (`MCP_HTTP_ALLOW_UNAUTHENTICATED` sin definir), cada petición a `/mcp` lleva **`Authorization: Bearer`** con el **Secret MCP** (`ari_…` de Perfil) o un **JWT de sesión** válido — el proceso valida vía ingest y reenvía el mismo Bearer al API Nest cuando hace falta.

**Logs de invocación (Dokploy / The Forge):** por defecto cada `tools/call` escribe en stdout JSON en una línea: `mcp_tool_call_start` (nombre, claves de argumentos, payload redactado/truncado), `mcp_tool_call_end` (ms, `resultSummary`, **`result`** con `content[]` devuelto al cliente — texto por bloque hasta `MCP_TOOL_LOG_RESPONSE_BLOCK_MAX`, cupo total `MCP_TOOL_LOG_RESPONSE_TOTAL_MAX`, flag `responseTruncated`), o `mcp_tool_call_error`. También `mcp_list_tools` al listar herramientas. Desactivar: `MCP_TOOL_LOG=0`. Límite de tamaño de la **línea** de log: `MCP_TOOL_LOG_ARG_MAX` (default 12000; súbelo si trunca el JSON entero antes de ver la respuesta).

**`ask_codebase` largo:** `mcp_tool_call_end` solo aparece cuando termina el POST a ingest/orchestrator (puede ser minutos). Mientras tanto, con `MCP_TOOL_LOG` activo, cada **`MCP_ASK_CODEBASE_PROGRESS_LOG_MS`** (default **60000**; `0`/`off` desactiva) se escribe **`mcp_tool_call_progress`** con `elapsedIngestFetchMs`, `elapsedSinceToolStartMs`, `responseMode`, `ingestAbortAfterMs` y prefijo de `projectId`.

## JSDoc del catálogo de herramientas

- Fuente TypeDoc/JSDoc: **`src/mcp-tools.doc.ts`** — tabla resumida de cada `name` MCP, revision `MCP_ARIADNE_TOOLS_DOC_REVISION` (incrementar al cambiar el set de tools en `index.ts`).
- El manifiesto runtime (`description` + `inputSchema`) sigue definido en **`src/index.ts`** dentro de `ListToolsRequestSchema`.

## Configuración de sharding Falkor

El MCP lee el sharding (`shardByProject`, `shardByDomain`, …) de los Ajustes del sistema consultando `GET {INGEST_URL}/internal/system-settings` (`src/falkor-runtime-settings.ts`, caché de 15 s, se refresca al inicio de cada tool), con la misma fuente que ingest y API. `FALKOR_SHARD_BY_PROJECT` en su entorno solo actúa como respaldo si el ingest no responde. Tests: `npm test` (Node ≥ 22.6, `node:test`).

## `ariadne link`, hook `post-commit` y `scripts/link.mjs` generado

- **Fuente única:** `src/cli.ts` (comando `ariadne link`) y `src/git-hook.ts` (instalación **idempotente** del hook git `post-commit`; ver [`scripts/git-hooks/README.md`](../../scripts/git-hooks/README.md)).
- **`scripts/link.mjs` (raíz) es un archivo generado:** bundle con esbuild de `cli.ts` (`scripts/bundle-link.mjs`), versionado porque `npx github:kreodevs/ariadne link` no compila. No editar a mano.

| Script (`services/mcp-ariadne`) | Qué hace |
| --- | --- |
| `npm run build` | `tsc` + bundle a `dist/link.mjs` (corre en los Dockerfiles del MCP y del frontend, CI y publicación; falla si el bundle no compila) |
| `npm run sync:link` | Regenera el `scripts/link.mjs` versionado (desde la raíz: `pnpm run build:link`) |
| `npm run check:link` | Falla si `scripts/link.mjs` está desactualizado (CI y antes de `npm publish`; desde la raíz: `pnpm run check:link`) |

Tras cambiar `cli.ts` o `git-hook.ts`: `npm run sync:link` y versionar el resultado junto con el cambio.

## Publicar a npm

```bash
cd services/mcp-ariadne
npm login
npm publish
```

El workflow `publish-package.yml` ejecuta `npm run build` y `npm run check:link` antes de publicar.

## Herramientas

### Core
- **list_known_projects** — Workspaces indexados: `id` = UUID **proyecto** Ariadne; `roots[]` = repos (`roots[].id`). Para Forge multi-root ver **export_brownfield_project_parity_pack**. Guía: `docs://guias/brownfield-forge-mcp`.
- **get_component_graph** — Por defecto intenta **`GET /api/graph/component/:name`** (mismo grafo que el explorador: RENDERS, USES_HOOK, IMPORTS, `graphHints`, fusión multi-shard). Requiere **`ARIADNE_API_URL`** y **`Authorization: Bearer`** en Cursor (Secret MCP `ari_…` o JWT web); el proceso lo reenvía al Nest **sin variables `ARIADNE_API_*`** en `.env`. Sin Bearer válido, **fallback** Falkor genérico `-[*1..depth]->`.
- **get_legacy_impact** — Preferencia: **`GET /api/graph/impact/:nodeId`** (`GraphService.getImpact`). Misma regla Bearer reenviable que `get_component_graph`. Fallback: Falkor `CALLS|RENDERS*` en un shard.
- **get_contract_specs** — Props (con `description` JSDoc si existe); sigue siendo solo Falkor.
- **get_functions_in_file**, **get_import_graph** — Contenido estructural de archivos.
- **get_file_content** — Contenido crudo del archivo desde Bitbucket/GitHub (requiere INGEST_URL).
- **validate_before_edit** — OBLIGATORIO antes de editar: impacto + contrato en un llamado.
- **semantic_search** — Búsqueda por palabra clave en componentes, funciones y archivos.
- **generate_legacy_documentation** — MDD determinista de **un repo** o scope acotado (`scope.repoIds`). Timeout: **`MCP_LEGACY_DOCUMENTATION_TIMEOUT_MS`** (default 900s).
- **generate_merged_project_mdd** — MDD **fusionado** de todos los roots del proyecto + `multi_root`. **`projectId`** = UUID del **proyecto** (`list_known_projects[].id`). The Forge / Cursor multi-root.
- **export_brownfield_parity_pack** — Parity pack **mono-repo** (`repositoryId` = `roots[].id`). Legacy: `mergeProject: true`.
- **export_brownfield_project_parity_pack** — **Import Forge multi-root:** MDD fusionado + modificationPlanSeed + scaffold. **`projectId`** obligatorio = UUID del **proyecto**. Ver `docs_mcp/guias/brownfield-forge-mcp.md`.
- **ask_codebase** — Preguntas NL (Q&A). **Doc. legacy:** usar tools brownfield arriba, no `ask_codebase`.
- **get_project_analysis** — Deuda técnica, duplicados, reingeniería, código muerto o **seguridad** (heurística; requiere INGEST_URL). `projectId` puede ser id de **proyecto** o **`roots[].id`** (repo); si es proyecto multi-root, usa **`currentFilePath`** o pasa el id del repo. Opcional: **`scope`** (mismo shape que `ask_codebase`), **`crossPackageDuplicates`** (modo duplicados). El MCP llama a `POST /projects/.../analyze` o `POST /repositories/.../analyze`. Si la respuesta trae **`reportMeta`**, se añade un bloque JSON al final del markdown.
- **get_modification_plan** — Plan vía `POST /projects/:id/modification-plan` (`userDescription`, opcional **`scope`**, **`currentFilePath`**, **`questionsMode`**: `business` | `technical` | `both`). Respuesta puede incluir **`warnings`** y **`diagnostic`**. `projectId` = proyecto o `roots[].id`.
### C4 / Arquitectura

Diagramas **C4** (Context, Container, Component) persistidos en ingest + render Archify. Guía atómica: **`docs://guias/c4-architecture-mcp`**.

| Tool | Descripción |
| ---- | ----------- |
| **get_c4_model** | JSON **C4Model** por nivel. Params: `projectId` (UUID proyecto), `level` (`context` \| `container` \| `component`), `regenerate`, `useLlm` (solo context), `containerKey` (solo component). Si no hay snapshot, intenta `POST /c4/generate`. |
| **generate_c4_diagram** | Regenera snapshots + HTML Archify. Params: `level` o `levels[]`, `useLlm`, `containerKey`. Respuesta incluye `htmlUrls[]` con URL absoluta al ingest (`…/c4/html?level=`). |
| **diff_c4_model** | Diff JSON entre dos snapshots + HTML compare Archify si existe. Params: `fromSnapshotId`, `toSnapshotId` (ids de `GET /projects/:id/c4/snapshots`). |

**Requisitos:** C4 habilitado en **Ajustes → Sistema → C4 / Diagramas** (`c4Enabled`). HTML requiere Archify en la imagen ingest (`/opt/archify`) o ruta configurada en `c4ArchifyBin`. **`projectId`** = UUID del **proyecto** (`list_known_projects[].id`), no `roots[].id`.

**Flujo típico:** `get_sync_status` → `generate_c4_diagram` (o `get_c4_model` con `regenerate`) → abrir `htmlUrls` o parsear `model`. Tras cambios de infra/código: regenerar y `diff_c4_model` entre snapshots.

**Secuencias API** (Route → endpoint): solo REST ingest (`POST …/c4/sequence/generate`); no hay tool MCP dedicada.

**Brownfield:** `export_brownfield_project_parity_pack` puede incluir `c4ContainerHtmlUrl`, `c4ContextHtmlUrl`, `c4ModelJson` si hay snapshots.

### Refactorización segura (árbol de llamadas)
- **get_definitions** — Origen exacto de clase/función (archivo, líneas). Evita alucinaciones al refactorizar.
- **get_references** — Todos los lugares donde se usa un símbolo.
- **get_implementation_details** — Firma, tipos, props, endpoints. Asegura que el nuevo código respete la estructura existente.

### Código muerto
- **trace_reachability** — Funciones/componentes nunca llamados desde puntos de entrada (rutas, index, main).
- **check_export_usage** — Exports sin importaciones activas en el monorepo.

### Análisis de impacto
- **get_affected_scopes** — Qué nodos y archivos (incl. tests) se verían afectados por una modificación.
- **check_breaking_changes** — Compara firma antes/después; alerta si se eliminan params usados en N sitios.

### Código sin duplicación
- **find_similar_implementations** — Búsqueda semántica antes de escribir código nuevo.
- **get_project_standards** — Prettier, ESLint, tsconfig para que el código nuevo siga los estándares.

### Workflow
- **get_file_context** — Combina contenido + imports + exports. Paso 2: search → get_file_context → validate/apply.

### Mapa de navegación (legacy flow)
- **generate_navigation_map** — Escanea el proyecto frontend (React Router, Next.js) y genera un mapa completo: rutas con parámetros, componentes que renderiza, formularios (estáticos y dinámicos), endpoints consumidos, componentes compartidos entre ≥2 rutas, path aliases (tsconfig) y apiClient detectado. Soporta diff mode (`scope=diff` + `baselineSnapshot`) para comparar contra un snapshot previo. Requiere `projectId` (de `list_known_projects`).

**Enrutamiento y whitelist de dominios:** Con `INGEST_URL`, el MCP llama a **`GET /projects/:id/graph-routing`** y usa **`cypherShardContexts`**: lista de `{ graphName, cypherProjectId }`. Cada consulta Cypher debe filtrar con el `projectId` que realmente tienen los nodos en ese grafo (propio proyecto + proyectos en dominios permitidos en **ProjectDomainDependency**). Sin esto, los grafos “hermanos” devolverían 0 filas. `forEachProjectShardGraph` y búsquedas que fusionan filas pasan el `cypherProjectId` correcto por shard.

**`semantic_search`, `find_similar_implementations` y id de proyecto vs repo:** `list_known_projects` devuelve `roots[].id` (**repositorio**). En Falkor, los nodos llevan `projectId` = UUID del **proyecto** Ariadne cuando el repo está enlazado; `roots[].id` coincide con `repoId`. **`resolve-graph-scope.ts`** llama `GET /repositories/:id` en ingest, mapea al `cypherProjectId` correcto y, si aplica, añade `AND n.repoId = $repoId` para no mezclar repos en multi-root. Ambas herramientas enrutan con `runOnProjectGraphs`/`forEachProjectShardGraph` y el mismo filtro. Sin este paso, filtrar por `roots[].id` como si fuera `projectId` devolvía **0 filas** (MDD vacío pese a índice sano).

**OpenAPI en `semantic_search`:** el vector suele cubrir `Function` / `Component` / `Document` / `MarkdownDoc`…; los nodos **`:OpenApiOperation`** (spec indexado) no llevan embedding. Tras vector/keyword, si hay cupo en `limit` se **mezclan** operaciones vía `MATCH (op:OpenApiOperation)` filtrando por proyecto/repo (mismos parámetros que el resto). Útil para consultas tipo API/routes/swagger aunque el vector devolviera hits de markdown.

Variables: `FALKORDB_HOST`, `FALKORDB_PORT`, `FALKOR_SHARD_BY_PROJECT`, `FALKOR_SHARD_BY_DOMAIN`, `INGEST_URL` (obligatorio para routing completo y herramientas que listan proyectos).

### Límites de salida (defaults altos — información completa)

Las herramientas ya no recortan agresivamente listados y snippets; puedes **bajar** estos valores si saturan el contexto del LLM o el tiempo de Falkor. Ver `src/mcp-tool-limits.ts`.

| Prefijo env | Ejemplos |
|-------------|----------|
| `MCP_SEMANTIC_SEARCH_*` | `DEFAULT`, `MAX`, `VECTOR_K_MAX`, `KEYWORD_SUBQUERY_LIMIT` |
| `MCP_FILE_CONTEXT_MAX_CHARS` | Contenido en **get_file_context** |
| `MCP_STANDARDS_FILE_SNIPPET_CHARS` | Snippets en **get_project_standards** |
| `MCP_AFFECTED_NODES_MAX`, `MCP_AFFECTED_FILES_MAX` | **get_affected_scopes** |
| `MCP_UNUSED_EXPORTS_MAX` | **check_export_usage** |
| `MCP_IMPLEMENTATION_*` | Descripciones y `FUNCTIONS_LIMIT` (**get_implementation_details**, **validate_before_edit**) |
| `MCP_DEFINITIONS_PER_KIND_LIMIT` | **get_definitions** |
| `MCP_TRACE_*` | **trace_reachability** (listas + query funciones no llamadas) |
| `MCP_FIND_SIMILAR_*` | **find_similar_implementations** |
| `MCP_DEBT_REPORT_ISOLATED_LIMIT` | **get_debt_report** |
| `MCP_FIND_DUPLICATES_GROUP_LIMIT` | **find_duplicates** |
| `MCP_SYNC_STATUS_RECENT_JOBS_MAX` | Jobs recientes en **get_sync_status** |

### Resolución multi-root (sin depender solo del cwd)

- **`mcp-scope-enrichment.ts`** — Orden: `.ariadne-project` subiendo directorios desde `currentFilePath` → si hace falta, ingest `GET /projects/:id/resolve-repo-for-path?path=` para acotar el repo → fallback al grafo Falkor como antes.
- **`ask_codebase`** y **`get_modification_plan`** mezclan en `scope.repoIds` el repo inferido cuando el IDE envía ruta de fichero.

## Uso (producción / Docker)

- Transporte: **Streamable HTTP** en `0.0.0.0:8080` (o `PORT`).
- Requiere FalkorDB con el grafo `AriadneSpecs` ya poblado.
- **Conexión Falkor:** el cliente registra `error` (no tumba el proceso ante `Socket closed unexpectedly`), usa `pingInterval` y `reconnectStrategy` vía Redis. Reinicios de Falkor o cortes de red pueden loguearse sin exit de Node; si el servicio MCP sigue unhealthy, revisa red/DNS hasta Falkor.
- **Auth (`/mcp`, producción):** el cliente envía **`Authorization: Bearer`** (Secret MCP `ari_…` de Perfil o JWT de sesión); el proceso valida vía ingest y reenvía el mismo Bearer al Nest en herramientas de grafo.

Variables: `PORT` (8080), `FALKORDB_HOST`, `FALKORDB_PORT`, `INGEST_URL`, **`ARIADNE_API_URL`** (solo URL base Nest; sin tokens de usuario en `.env`).

### Cursor (HTTP): `~/.cursor/mcp.json`

Servidor **Streamable HTTP** en `http://127.0.0.1:9888/mcp` cuando usas **docker-compose.dev.yml** (mapeo **9888→8080** en el contenedor; evita choque con Apache u otros en `:8080`). Si ejecutas el MCP con `PORT=8080` en el host, usa `http://127.0.0.1:8080/mcp`.

```json
{
 "mcpServers": {
 "ariadne-local": {
 "url": "http://127.0.0.1:9888/mcp",
 "headers": {
 "Authorization": "Bearer <Secret MCP del Perfil (ari_…) o JWT de sesión>"
 }
 }
 }
}
```

Con **Docker Compose dev** (`docker-compose.yml` + `docker-compose.dev.yml`): el servicio `mcp-ariadne` publica **`127.0.0.1:9888`** y a menudo tiene **`MCP_HTTP_ALLOW_UNAUTHENTICATED=true`** (omitir Bearer solo en pruebas locales). En producción deja **`MCP_HTTP_ALLOW_UNAUTHENTICATED` sin definir** y configura el Bearer en `mcp.json`.

Para **paridad** con el explorador en grafos Nest, necesitas **`ARIADNE_API_URL`** correcta **y** Bearer vigente (única fuente: Cursor `headers`, mismo token que usa el usuario en web o el Secret MCP persistente).

### Variables MCP ↔ Cursor / Docker

Compose puede inyectar solo **`ARIADNE_API_URL`** (p. ej. `http://api:3000`). Los tokens de sesión / Secret MCP **no** van en variables de entorno del contenedor MCP: van en la config de Cursor como arriba. Sin Bearer en la petición (y sin modo allow-unauth) la API responde **401** y las tools con fallback usan Falkor.

### Caché de herramientas MCP (no es la caché de `analyze`)

Las herramientas **get_component_graph**, **get_legacy_impact** y **get_sync_status** pueden cachear respuestas cortas (clave `v2` para grafo/impacto tras alinear con el API):

- **Por defecto** (sin `MCP_REDIS_URL` ni `REDIS_URL`, o con `MCP_REDIS_DISABLED=1`): caché **en memoria** del proceso (TTL 30–120 s según herramienta).
- **Redis:** define `MCP_REDIS_URL` o `REDIS_URL` para compartir caché entre instancias. La caché de informes **`get_project_analysis`** vive en **ingest** (ver `docs/notebooklm/plan-analyze-layer-cache.md`); el MCP no la duplica.

## Scripts

- `npm run build` — compila TypeScript.
- `npm start` — inicia el servidor HTTP Streamable (`PORT` / `MCP_HTTP_PORT`, default 8080).
