# ComponentGraph

Vista **Explorador de grafo** (`/graph-explorer`):

- **Grafo de componente** — `GET /api/graph/component/:name` con `depth` y `projectId`.
- **Vista C4** — `GET /api/graph/c4-model?projectId=` — nodos padre `System` (subflow) y contenedores hijos; aristas `COMMUNICATES_WITH` (roll-up desde el grafo de código).

- **Alcance**: *Proyectos* (shard completo), *Repos por proyecto* (`graph-summary?repoScoped=1`) y *Repositorios aislados*.
- **Componente**: `graph-summary?full=1` para poblar el desplegable (proyecto agregado: una petición; repo concreto: `repoScoped=1`). Fallback en ingest si faltan aristas File→Component.
- **Errores de validación** (`Elige un componente`, etc.): al cambiar el componente en el `Select` o la profundidad se limpia el mensaje; antes podía quedar el banner rojo tras un intento fallido aunque ya hubiera nombre elegido.

## Visualización

### Grafo de componente (principal)

- **[vis-network](https://visjs.github.io/vis-network/docs/network/)** (`ComponentGraphVisView.tsx`): layout **forceAtlas2Based**, zoom (rueda), pan, botones de navegación de vis (estilos sobrescritos en `index.css` bajo `.component-graph-vis` para tema oscuro), **Encuadrar** / **Autolayout**; nodos con color y tipografía explícitos (hex; vis no usa CSS vars). Aristas = `filterValidEdges` (`depends` / `legacy_impact`). **Clic** en nodo periférico → expansión depth 1 (`mergeGraphNodes` / `mergeGraphEdges`).
- **API (Nest)**: mismo contrato que antes (`graph.service.ts`, `falkorScalarToString`, etc.).
- **graphHints** (opcional): aviso si no hay aristas depends salientes del foco pero sí `projectId`.
- **Repos Nest/API (p. ej. `smile-nest`)**: el corte usa sobre todo `:Component` y **RENDERS**; Nest se indexa como **:NestService / :NestController** y **CALLS** entre **:Function**. **`@Roles()`**: agregado a nivel controlador como **:AccessRole** + **ALLOWS_ACCESS_ROLE**; por handler HTTP (**`NestRoute`**, `DECLARES_ROUTE`, **REQUIRES_ROLE**, **USES_GUARD** → **NestGuard**) el índice enlaza roles/guards a rutas; eso no aparece en el grafo de componente. El aviso de aristas ausentes suele ser **normal** en API sin JSX; para acoplamiento usar **C4**, índice de repo o Cypher sobre Nest/Function/NestRoute/AccessRole.

### Vista C4

- **[React Flow](https://reactflow.dev/)** solo para C4: `C4ArchitectureFlowView`, fondo de puntos, controles.

### Debug Falkor

- **`ComponentGraphDebugPanel.tsx`**: panel colapsable — ejecutor Cypher `POST /api/graph/falkor-debug-query` (`FALKOR_DEBUG_CYPHER=1` en API). Oculto en vista C4.

### Otros archivos (mapeo / legado)

- **`componentGraphFlow.ts`**: tipos API, `resolveFocalNode`, `filterValidEdges` (usado por vis y tests).
- **`graphLayout.ts`**, **`GraphFlowNode.tsx`**: layout Dagre + nodo RF usados antes del cambio a vis como vista principal; pueden reutilizarse si se reactiva React Flow en componente.

- **Expansión**: `getComponentGraph(componentName, { depth: 1, projectId })` → merge con deduplicación (`graphMerge.ts`). Clave `graphKey` + `graphNonce` para remount del canvas vis.

### Archivos

| Archivo | Rol |
|--------|-----|
| `index.tsx` | Formulario, toggle componente / C4, estado, expansión |
| `ComponentGraphVisView.tsx` | Grafo de componente con vis-network |
| `ComponentGraphDebugPanel.tsx` | Cypher Falkor vía API |
| `C4FlowNodes.tsx` | Nodos `c4System` / `c4Container` |
| `c4ArchitectureFlow.ts` | C4 → React Flow |
| `componentGraphFlow.ts` | Tipos, `filterValidEdges`, `resolveFocalNode` |
| `graphMerge.ts` | Fusión al expandir |

Query típica: `?scope=project:uuid|repo:uuid&projectId=&name=&depth=`.
