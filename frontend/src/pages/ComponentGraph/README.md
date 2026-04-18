# ComponentGraph

Vista **Explorador de grafo** (`/graph-explorer`):

- **Grafo de componente** — `GET /api/graph/component/:name` con `depth` y `projectId`.
- **Vista C4** — `GET /api/graph/c4-model?projectId=` — nodos padre `System` (subflow) y contenedores hijos; aristas `COMMUNICATES_WITH` (roll-up desde el grafo de código).

- **Alcance**: *Proyectos* (shard completo), *Repos por proyecto* (`graph-summary?repoScoped=1`) y *Repositorios aislados*.
- **Componente**: `graph-summary?full=1` para poblar el desplegable (proyecto agregado: una petición; repo concreto: `repoScoped=1`). Fallback en ingest si faltan aristas File→Component.

## Visualización

- **[React Flow](https://reactflow.dev/)** (`@xyflow/react`): nodos arrastrables, zoom, pan, **MiniMap**, **Controls**, fondo de puntos.
- **Nodos**: tipo `componentGraph` — tarjeta con `kind`, etiqueta (archivo), ruta opcional, anillo **foco** para el componente de la carga inicial (`rootFocalName`). Nodos periféricos muestran pista de clic para expandir.
- **Aristas**: `smoothstep`, flecha cerrada, **etiqueta** `depends` / `legacy`; `depends` (azul); `legacy_impact` (ámbar, discontinua). Las **depends directas del foco** (salientes) van **animadas** y un poco más gruesas. Solo se dibujan si `source`/`target` existen en nodos.
- **API (Nest)**: normalización `falkorScalarToString` en `graph.service.ts` para evitar `[object Object]` en nombres/ids desde Falkor. Con **sharding por dominio** (`falkor_shard_mode=domain`), `GET /graph/component/:name` fusiona el vecindario de **todos** los subgrafos Falkor del proyecto (antes solo se consultaba el primer shard donde existiera el nombre, lo que podía dejar `App` sin aristas visibles).
- **Layout**: **Dagre** (`@dagrejs/dagre`, `rankdir: TB`) en `graphLayout.ts`: el nodo foco queda en el origen tras el layout; `depends` tienden a capas bajo el foco y `legacy_impact` (consumidor→foco) hacia arriba. Fallback en cuadrícula si Dagre falla.
- **Expansión**: `onNodeClick` en nodos no foco → `getComponentGraph(componentName, { depth: 1, projectId })` → **merge** de nodos y aristas con deduplicación por `id` y por `source|target|kind` (`graphMerge.ts`). El set de nombres ya expandidos se resetea al cargar un grafo nuevo.
- Tras cargar o fusionar, **`fitView`** acota el subgrafo (clave `graphKey` + `graphNonce`).

### Archivos

| Archivo | Rol |
|--------|-----|
| `index.tsx` | Formulario alcance/componente, toggle vista componente vs C4, estado del grafo, expansión y `ReactFlowProvider` |
| `GraphFlowNode.tsx` | Nodo personalizado (componente) |
| `C4FlowNodes.tsx` | Nodos `c4System` / `c4Container` (subflows) |
| `c4ArchitectureFlow.ts` | Mapeo de `C4ModelResponse` → nodos/aristas React Flow |
| `componentGraphFlow.ts` | Tipos API, `resolveFocalNode`, `filterValidEdges`, mapeo a nodos/aristas React Flow |
| `graphLayout.ts` | Layout Dagre centrado en el foco |
| `graphMerge.ts` | Fusión de nodos/aristas al expandir |

Query típica: `?scope=project:uuid|repo:uuid&projectId=&name=&depth=`.
