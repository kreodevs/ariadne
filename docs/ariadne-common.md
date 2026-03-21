# ariadne-common — Paquete compartido

`packages/ariadne-common` concentra tipos y utilidades compartidas entre **ingest**, **cartographer** y **mcp-ariadne** para FalkorDB/Cypher, evitando duplicar lógica y facilitando cambios en un solo lugar.

## Contenido

| Módulo       | Exporta | Uso |
|-------------|---------|-----|
| **cypher**  | `escapeCypherString`, `cypherSafe` | Escape de strings para sentencias Cypher. |
| **falkor**  | `GRAPH_NAME`, `getFalkorConfig()`, `FalkorConfig` | Configuración de conexión (env `FALKORDB_HOST`, `FALKORDB_PORT`). |
| **graph-types** | `ResolvedCallInfo`, `ParsedFileMinimal`, etc. | Contratos mínimos para utilidades de grafo. |
| **graph-utils** | `buildExportsMap`, `resolveCrossFileCalls`, `runCypherBatch`, `GraphClient` | Lógica compartida de producer (mapa de exports, resolución de llamadas cross-file, ejecución de batches Cypher). |

## Consumidores

- **ariadnespec-ingest** — `pipeline/producer`, `pipeline/falkor`, `pipeline/project`
- **ariadnespecs-cartographer** — `graph/producer`, `graph/falkor`, `graph/project`
- **ariadne-mcp** — `falkor` (solo `getFalkorConfig`, `GRAPH_NAME`)

## Uso en desarrollo

1. **Orden de build:** siempre compilar `ariadne-common` antes que los servicios que lo usan:
   ```bash
   cd packages/ariadne-common && npm install && npm run build
   cd services/ingest && npm install && npm run build
   ```
2. **Dependencia:** en cada servicio está declarada como `"ariadne-common": "file:../../packages/ariadne-common"`. Tras cambiar código en `ariadne-common`, volver a construir el paquete y luego el servicio:
   ```bash
   (cd packages/ariadne-common && npm run build)
   (cd services/ingest && npm run build)
   ```
3. **Script de setup:** el script de desarrollo del repo no instala ni construye `ariadne-common` por defecto. Si clonas el repo y solo haces `pnpm -C services/ingest install`, npm resolverá el `file:../../packages/ariadne-common` siempre que la ruta exista; asegúrate de tener `packages/ariadne-common` construido (`npm run build` en esa carpeta) antes de construir ingest/cartographer/mcp.

## Deployment a producción (Docker)

Los Dockerfiles de **ingest**, **cartographer** y **mcp-ariadne** están preparados para construirse **con contexto en la raíz del repo**. El `docker-compose.yml` ya usa `context: .` en todos los servicios; no cambiar a un contexto por carpeta de servicio.

- **Build manual (raíz del repo):**
  ```bash
  docker build -f services/ingest/Dockerfile .
  docker build -f services/cartographer/Dockerfile .
  docker build -f services/mcp-ariadne/Dockerfile .
  ```
- **Orden en el Dockerfile:** se copia `packages/ariadne-common` a `/packages/ariadne-common`, se ejecuta `npm install` y `npm run build` ahí, y después se instala y construye el servicio. Así la dependencia `file:../../packages/ariadne-common` se resuelve correctamente.
- **MCP (multi-stage):** la etapa final copia también `/packages/ariadne-common` desde el builder para que `npm ci` resuelva la dependencia local antes de copiar `dist`.

Si el build se hiciera desde un contexto que no incluye `packages/ariadne-common`, la instalación fallaría. En ese caso, usar siempre contexto raíz o publicar `ariadne-common` en un registro y sustituir la dependencia `file:` por la versión publicada.

## Resumen de impacto

- **Un solo lugar** para escape Cypher, config FalkorDB, `buildExportsMap`, `resolveCrossFileCalls` y `runCypherBatch`.
- **Producción:** builds de Docker deben usar contexto raíz y los Dockerfiles actuales ya están preparados para copiar y compilar `ariadne-common` en la imagen.
