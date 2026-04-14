# Caché de análisis (`POST .../analyze`) en ingest

Referencia rápida de capas y variables. El **MCP** no replica esta caché: `get_project_analysis` llama al ingest; la deduplicación ocurre en el servidor de ingesta.

## Capa principal (informe completo)

- **LRU en memoria** por proceso (`ANALYZE_CACHE_MAX_ENTRIES`, `ANALYZE_CACHE_TTL_MS`).
- **Redis opcional** para compartir entre réplicas: `ANALYZE_CACHE_REDIS_URL` o `REDIS_URL` (ver `AnalyzeDistributedCacheService`). Prefijo: `ANALYZE_CACHE_REDIS_PREFIX` (default `ariadne:analyze:v2:`).
- **Clave:** repo, modo, scope serializado, `crossPackageDuplicates`, último commit, huella de `indexed_files` (incl. `content_hash` cuando existe). Ver `analyze-cache.util.ts` (`buildAnalyzeCacheKey`, `hashFullIndexState`).
- **Desactivar:** `ANALYZE_CACHE_DISABLED=1` (memoria y Redis de informe).
- **Metadatos:** la respuesta puede incluir `reportMeta.fromCache` (texto del informe servido desde caché; no sustituye razonar sobre sync reciente).

## Capa extrínseca CALL (diagnóstico con scope)

- Travesía `CALL` fuera del foco del scope, con tope de aristas (`MAX_ANALYZE_CALL_EDGES` y afines).
- **LRU** local + **Redis** opcional para resultados de esa capa (`buildDiagnosticoExtrinsicLayerCacheKey`).
- Variables: `ANALYZE_EXTRINSIC_LAYER_CACHE_DISABLED`, `ANALYZE_EXTRINSIC_LAYER_REDIS_DISABLED`, TTL / tamaños en `analyze-cache.util.ts`.
- `reportMeta` puede exponer `extrinsicCallsLayerCacheHit`, `extrinsicCallsLayerRedisHit`.

## Lectura relacionada

- `services/ingest/src/chat/analyze-cache.util.ts`
- `services/ingest/src/chat/analyze-distributed-cache.service.ts`
- `services/ingest/src/chat/chat.service.ts` (flujo `analyze` y `reportMeta`)
- `docs/diagnostico-layer-dependencies.md` — capas intrínseca / extrínseca del diagnóstico
