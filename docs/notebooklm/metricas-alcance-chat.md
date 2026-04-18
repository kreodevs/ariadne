# Telemetría de alcance del chat (ingest)

Con **`CHAT_TELEMETRY_LOG=1`** o **`true`**, cada ejecución del pipeline unificado (`runUnifiedPipeline`) emite una línea de log estructurado (JSON) vía `Logger` de Nest.

## Campos útiles

| Campo | Significado |
|--------|-------------|
| `event` | Siempre `chat_unified_pipeline`. |
| `pathGroundingRatio` | Fracción de paths citados en la respuesta que aparecen en contexto/retrieval (heurística). |
| `pathGroundingHits` / `pathCitationsUnique` | Conteos del muestreo de grounding. |
| `chat_scope_effective` | Objeto con alcance efectivo: `repoIdsFromScope`, `repoIdsEffective`, `preflightPathRepoApplied`, `projectScope`, `scopeFilterActive`, `clientScopeSource`, `inferred`, `ambiguous`. |
| `contextChars` | Tamaño del contexto **tras** preflight (si aplica). |
| `collectedRowGroups` | Número de filas/agrupaciones pasadas al sintetizador (tras preflight). |

## Variables de entorno relacionadas

- **`CHAT_INFER_SCOPE_FROM_ROLES`** — Default activo; `0|false|off|no` desactiva la inferencia de `repoId` desde el mensaje y roles en `project_repositories`.
- **`CHAT_PREFLIGHT_PATH_REPO`** — Default activo; `0|false|off` desactiva el recorte de contexto por ruta en mensaje (solo chat por proyecto con retrieval multi-repo).

## Agregación local

En la raíz del monorepo, **`pnpm metrics:chat-telemetry`** (o `npm run metrics:chat-telemetry`) ejecuta `scripts/aggregate-chat-telemetry.mjs`.

- Con **archivo:** `pnpm run metrics:chat-telemetry -- ingest.log` (o `npm run metrics:chat-telemetry -- ingest.log`); el path es el primer argumento del script Node.
- Sin argumento: lee **stdin** (p. ej. `grep chat_unified_pipeline ingest.log | pnpm run metrics:chat-telemetry`).

Salida: JSON con conteos (`chat_unified_pipeline_events`, medias de `pathGroundingRatio`, etc.).

Para producción, suele bastar con volcar logs del ingest a Loki/ELK y filtrar por `event=chat_unified_pipeline`.
