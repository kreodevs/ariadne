# ComponentGraph

Vista **Explorador de grafo** (`/graph-explorer`):

- **Grafo de componente** — `GET /api/graph/component/:name` con `depth` y `projectId`.
- **Vista C4** — `GET /api/graph/c4-model?projectId=` — nodos padre `System` (subflow) y contenedores hijos; aristas `COMMUNICATES_WITH` (roll-up desde el grafo de código).

- **Alcance**: *Proyectos* (shard completo), *Repos por proyecto* (`graph-summary?repoScoped=1`) y *Repositorios aislados*.
- **Componente**: `graph-summary?full=1` para poblar el desplegable (proyecto agregado: una petición; repo concreto: `repoScoped=1`). Fallback en ingest si faltan aristas File→Component.
- **Errores de validación** (`Elige un componente`, etc.): al cambiar el componente en el `Select` o la profundidad se limpia el mensaje; antes podía quedar el banner rojo tras un intento fallido aunque ya hubiera nombre elegido.

## Visualización

- **[React Flow](https://reactflow.dev/)** (`@xyflow/react`): nodos arrastrables, zoom, pan, **MiniMap**, **Controls**, fondo de puntos.
- **Nodos**: tipo `componentGraph` — tarjeta con `kind`, etiqueta (archivo), ruta opcional, anillo **foco** para el componente de la carga inicial (`rootFocalName`). Nodos periféricos muestran pista de clic para expandir.
- **Aristas**: `smoothstep`, flecha cerrada, **etiqueta** `depends` / `legacy`; `depends` (azul); `legacy_impact` (ámbar, discontinua). Las **depends directas del foco** (salientes) van **animadas** y un poco más gruesas. Solo se dibujan si `source`/`target` existen en nodos.
- **API (Nest)**: normalización `falkorScalarToString` en `graph.service.ts` para evitar `[object Object]` en nombres/ids desde Falkor. El subgrafo usa Cypher explícito `RENDERS*`, `USES_HOOK`, cadena `File-IMPORTS->File` hacia otros `Component` (mismo `projectId`), no solo `[*]`. Las aristas se conectan con el **id del nodo origen de cada fila** (no un único `centerId` mezclado entre shards). Con **sharding por dominio**, se fusionan todos los shards del proyecto.
- **graphHints** (opcional en la respuesta): si no hay aristas `depends` salientes del foco pero sí `projectId`, se muestra aviso de posible desincronización / resync (chat vs Falkor).
- **Layout**: **Dagre** (`@dagrejs/dagre`, `rankdir: LR`) en `graphLayout.ts`: foco a la izquierda, dependientes en columna a la derecha (evita una sola fila horizontal con muchos hijos). Fallback en cuadrícula si no hay aristas válidas o Dagre falla. Nodos con **handles** izquierda/derecha (`GraphFlowNode`) para que las aristas no salgan del centro de la tarjeta (antes quedaban tapadas por el nodo).
- **Debug** (`ComponentGraphDebugPanel.tsx`): panel colapsable bajo el canvas — columna izquierda **vis-network** (layout **forceAtlas2Based**, zoom con rueda, pan arrastrando el fondo, botones de navegación de vis, teclado; tras estabilizar se apaga la física; botones **Encuadrar** / **Autolayout**), aristas = `filterValidEdges` como React Flow; columna derecha **JSON**; bloque **Falkor (Cypher vía API)** y `FALKOR_DEBUG_CYPHER=1` como antes. Oculto en vista C4.
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
| `ComponentGraphDebugPanel.tsx` | vis-network + JSON crudo + ejecutor Cypher vía API (`falkor-debug-query`) |

Query típica: `?scope=project:uuid|repo:uuid&projectId=&name=&depth=`.
