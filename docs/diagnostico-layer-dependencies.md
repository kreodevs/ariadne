# Diagnóstico: capas intrínseca y extrínseca (ingest)

En el modo `diagnostico` (y derivados que reutilizan el mismo prep), el informe combina datos del grafo **dentro del alcance** y, cuando hay **scope** activo, una capa **extrínseca** de llamadas (`CALL`) hacia nodos fuera del foco.

## Intrínseca

- Consultas Cypher y agregados sobre nodos y relaciones en el **foco** del análisis (repo / prefijos / exclusiones del `scope`).
- Métricas locales: riesgo compuesto, anti-patrones (`detectAntipatterns`), acoplamiento, etc.
- No depende de la caché extrínseca; sí puede alimentar la **caché global del informe** (ver `docs/plan-analyze-layer-cache.md`).

## Extrínseca (CALL)

- Construye aristas de llamada **desde** el foco **hacia** funciones fuera del foco (o según la implementación actual en `chat.service.ts` y utilidades `diagnostico-*`).
- Acotada por límites de aristas para evitar explosión en monorepos grandes.
- Resultados cacheables en LRU + Redis opcional (claves `diag-ext-calls` — ver `buildDiagnosticoExtrinsicLayerCacheKey` en `analyze-cache.util.ts`).
- Telemetría en `reportMeta`: `extrinsicCallsLayerCacheHit`, `extrinsicCallsLayerRedisHit` cuando aplica.

## Validación LLM vs fase A

- Utilidades tipo `diagnostico-validate` (paths citados vs datos de la fase A) reducen alucinaciones en el texto del informe.
- Variable típica: `DIAGNOSTICO_VALIDATE_PATHS` (ver código en `services/ingest/src/chat/`).

## MCP

- `get_project_analysis` con `mode: diagnostico` delega en ingest; la lógica de capas vive **solo** en ingest.
