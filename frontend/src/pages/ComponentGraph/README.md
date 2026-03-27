# ComponentGraph

Vista **Grafo de componente** (`/graph-explorer`): consume `GET /api/graph/component/:name` con `depth` y `projectId`.

- **Alcance**: *Proyectos* (shard completo), *Repos por proyecto* (`graph-summary?repoScoped=1`) y *Repositorios aislados*.
- **Componente**: `graph-summary?full=1` para poblar el desplegable (proyecto agregado: una petición; repo concreto: `repoScoped=1`). Fallback en ingest si faltan aristas File→Component.

## Visualización

- **[React Flow](https://reactflow.dev/)** (`@xyflow/react`): nodos arrastrables, zoom, pan, **MiniMap**, **Controls**, fondo de puntos.
- **Nodos**: tipo `componentGraph` — tarjeta con `kind`, etiqueta (archivo), ruta opcional, anillo **foco** para el componente consultado.
- **Aristas**: `smoothstep`, flecha cerrada, **etiqueta** `depends` / `legacy`; `depends` (azul, animada); `legacy_impact` (ámbar, discontinua). Solo se dibujan si `source`/`target` existen en nodos.
- **API (Nest)**: normalización `falkorScalarToString` en `graph.service.ts` para evitar `[object Object]` en nombres/ids desde Falkor.
- **Layout**: `layoutNodes` en abanico (foco al centro, dependencias e impacto en arcos); el resto con jitter.
- Tras cargar datos, **`fitView`** acota el subgrafo.

### Archivos

| Archivo | Rol |
|--------|-----|
| `index.tsx` | Formulario alcance/componente + `ReactFlowProvider` y vista |
| `GraphFlowNode.tsx` | Nodo personalizado |
| `componentGraphFlow.ts` | Tipos API, layout, mapeo a nodos/aristas React Flow |

Query típica: `?scope=project:uuid|repo:uuid&projectId=&name=&depth=`.
