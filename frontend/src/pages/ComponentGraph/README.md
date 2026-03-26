# ComponentGraph

Vista **Grafo de componente**: consume `GET /api/graph/component/:name` con `depth` y `projectId` opcionales. Muestra dependencias (`depends`) e impacto legacy (`legacy_impact`) en SVG con pan y zoom.

Ruta UI: `/graph-explorer`. Parámetros de URL: `?name=&projectId=&depth=`.

Para un layout tipo diagrama con minimapa, se puede sustituir el SVG por `@xyflow/react` cuando el entorno permita instalar dependencias.
