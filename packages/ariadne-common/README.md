# ariadne-common

Tipos y utilidades compartidas para FalkorDB/Cypher entre servicios Ariadne (ingest, cartographer, MCP).

## Contenido

- **cypher**: `escapeCypherString`, `cypherSafe` — escape de strings para Cypher.
- **falkor**: `GRAPH_NAME`, `getFalkorConfig()`, `FalkorConfig` — configuración de conexión (FALKORDB_HOST, FALKORDB_PORT).
- **graph-types**: `ResolvedCallInfo`, `ParsedFileMinimal`, etc. — contratos mínimos para utilidades de grafo.
- **graph-utils**: `buildExportsMap`, `resolveCrossFileCalls`, `runCypherBatch`, `GraphClient` — lógica compartida de producer.
- **graph-labels**: `FALKOR_EMBEDDABLE_NODE_LABELS`, `FALKOR_DOCUMENTATION_DOC_LABELS` — etiquetas Falkor para embed-index y docs (Fase 4); mantener alineado con `producer` en ingest.

## Consumidores

- **ariadnespec-ingest**: producer, falkor, project.
- **ariadnespecs-cartographer**: producer, falkor, project.
- **ariadne-mcp**: falkor.

## Build (desarrollo)

```bash
cd packages/ariadne-common && npm install && npm run build
```

Los servicios usan `"ariadne-common": "file:../../packages/ariadne-common"`. Tras cambiar código aquí, volver a `npm run build` y luego construir el servicio que lo consume.

## Deployment (Docker)

Los Dockerfiles de ingest, cartographer y mcp-ariadne **deben construirse con contexto en la raíz del repo** (no solo la carpeta del servicio), para poder copiar y compilar `packages/ariadne-common` dentro de la imagen. Ver [docs/ariadne-common.md](../../docs/ariadne-common.md).
