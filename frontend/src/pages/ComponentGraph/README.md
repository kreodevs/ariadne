# ComponentGraph

Vista **Grafo de componente**: consume `GET /api/graph/component/:name` con `depth` y `projectId`.

- **Alcance**: `<select>` agrupado en *Proyectos* (UUID del proyecto Ariadne → `projectId` en Falkor) y *Repositorios aislados* (UUID del repo).
- **Componente**: `<select>` poblado con `GET /repositories/:id/graph-summary?full=1` (merge de todos los repos del proyecto).

Ruta: `/graph-explorer`. Query: `?scope=project:uuid|repo:uuid&projectId=&name=&depth=`.
