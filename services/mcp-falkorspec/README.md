# ariadne-mcp (FalkorSpecs MCP Server)

Servidor MCP que expone herramientas de contexto sobre el grafo en FalkorDB.

**Transporte:** Streamable HTTP (puerto 8080 o `PORT`). **Modo stateless:** un Server+Transport por request, evita el error "Server already initialized" cuando Cursor reintenta el handshake. Auth M2M opcional: `MCP_AUTH_TOKEN` → exige `Authorization: Bearer <token>`.

## Publicar a npm

```bash
cd services/mcp-falkorspec
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
- **get_project_analysis** — Diagnóstico, duplicados, reingeniería o código muerto (requiere INGEST_URL).
- **get_modification_plan** — Plan quirúrgico vía `POST /projects/:id/modification-plan` (`userDescription`, opcional **`scope`**). `projectId` = proyecto Ariadne o `roots[].id`; en multi-root, preferir el repo objetivo.

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

Variables: `FALKORDB_HOST`, `FALKORDB_PORT`, `INGEST_URL` (para get_file_content, ask_codebase, get_project_analysis, get_project_standards).

## Uso (producción / Docker)

- Transporte: **Streamable HTTP** en `0.0.0.0:8080` (o `PORT`).
- Requiere FalkorDB con el grafo `FalkorSpecs` ya poblado.
- **Auth:** Si `MCP_AUTH_TOKEN` está definido, las peticiones deben incluir `Authorization: Bearer <token>`.

Variables: `PORT` (8080), `FALKORDB_HOST`, `FALKORDB_PORT`, `INGEST_URL`, `MCP_AUTH_TOKEN` (opcional).

## Scripts

- `npm run build` — compila TypeScript.
- `npm start` — inicia el servidor (stdio).
