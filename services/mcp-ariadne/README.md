# ariadne-mcp (AriadneSpecs MCP Server)

Servidor MCP que expone herramientas de contexto sobre el grafo en FalkorDB.

**Transporte:** Streamable HTTP (puerto 8080 o `PORT`). **Modo stateless:** un Server+Transport por request, evita el error "Server already initialized" cuando Cursor reintenta el handshake. Auth M2M opcional: `MCP_AUTH_TOKEN` → exige `Authorization: Bearer <token>`.

## Publicar a npm

```bash
cd services/mcp-ariadne
npm login
npm publish
```

## Herramientas

### Core
- **list_known_projects** — Proyectos indexados (`id` = proyecto Ariadne, `roots[]` = repos). El texto de respuesta indica que para **`get_modification_plan`** en multi-root conviene usar `roots[].id` del repo donde está el código (p. ej. frontend).
- **get_component_graph**, **get_legacy_impact**, **get_contract_specs** — Grafo, impacto, props (con `description` JSDoc si existe).
- **get_functions_in_file**, **get_import_graph** — Contenido estructural de archivos.
- **get_file_content** — Contenido crudo del archivo desde Bitbucket/GitHub (requiere INGEST_URL).
- **validate_before_edit** — OBLIGATORIO antes de editar: impacto + contrato en un llamado.
- **semantic_search** — Búsqueda por palabra clave en componentes, funciones y archivos.
- **ask_codebase** — Preguntas en NL sobre el código; delega al ingest. Argumentos opcionales: **`scope`** (`repoIds`, `includePathPrefixes`, `excludePathGlobs`), **`twoPhase`**. Requiere INGEST_URL y OPENAI_API_KEY.
- **get_project_analysis** — Deuda técnica, duplicados, reingeniería, código muerto o **seguridad** (heurística; requiere INGEST_URL). `projectId` puede ser id de **proyecto** o **`roots[].id`** (repo); si es proyecto multi-root, usa **`currentFilePath`** o pasa el id del repo. Opcional: **`scope`** (mismo shape que `ask_codebase`), **`crossPackageDuplicates`** (modo duplicados). El MCP llama a `POST /projects/.../analyze` o `POST /repositories/.../analyze`. Si la respuesta trae **`reportMeta`**, se añade un bloque JSON al final del markdown.
- **get_modification_plan** — Plan vía `POST /projects/:id/modification-plan` (`userDescription`, opcional **`scope`**, **`currentFilePath`**, **`questionsMode`**: `business` | `technical` | `both`). Respuesta puede incluir **`warnings`** y **`diagnostic`**. `projectId` = proyecto o `roots[].id`.

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

Variables: `FALKORDB_HOST`, `FALKORDB_PORT`, `FALKOR_SHARD_BY_PROJECT`, `FALKOR_SHARD_BY_DOMAIN`, `INGEST_URL` (enrutamiento vía `GET /projects/:id/graph-routing`; herramientas que leen Falkor abren el subgrafo por ruta cuando aplica).

### Resolución multi-root (sin depender solo del cwd)

- **`mcp-scope-enrichment.ts`** — Orden: `.ariadne-project` subiendo directorios desde `currentFilePath` → si hace falta, ingest `GET /projects/:id/resolve-repo-for-path?path=` para acotar el repo → fallback al grafo Falkor como antes.
- **`ask_codebase`** y **`get_modification_plan`** mezclan en `scope.repoIds` el repo inferido cuando el IDE envía ruta de fichero.

## Uso (producción / Docker)

- Transporte: **Streamable HTTP** en `0.0.0.0:8080` (o `PORT`).
- Requiere FalkorDB con el grafo `AriadneSpecs` ya poblado.
- **Auth:** Si `MCP_AUTH_TOKEN` está definido, las peticiones deben incluir `Authorization: Bearer <token>`.

Variables: `PORT` (8080), `FALKORDB_HOST`, `FALKORDB_PORT`, `INGEST_URL`, `MCP_AUTH_TOKEN` (opcional).

### Caché de herramientas MCP (no es la caché de `analyze`)

Las herramientas **get_component_graph**, **get_legacy_impact** y **get_sync_status** pueden cachear respuestas cortas:

- **Por defecto** (sin `MCP_REDIS_URL` ni `REDIS_URL`, o con `MCP_REDIS_DISABLED=1`): caché **en memoria** del proceso (TTL 30–120 s según herramienta).
- **Redis:** define `MCP_REDIS_URL` o `REDIS_URL` para compartir caché entre instancias. La caché de informes **`get_project_analysis`** vive en **ingest** (ver `docs/plan-analyze-layer-cache.md`); el MCP no la duplica.

## Scripts

- `npm run build` — compila TypeScript.
- `npm start` — inicia el servidor (stdio).
