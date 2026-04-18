# Observabilidad — Fase 0 (marzo 2026)

Implementación mínima para medir **latencia de chat/RAG**, **tasa de retrieval vacío**, **calidad de grounding de rutas**, **fallos de sync** y **parser (truncado / fallo)**.

## Endpoint

| Servicio | Ruta | Notas |
|----------|------|--------|
| Ingest | `GET http://<ingest>:3002/metrics` | Prometheus scrape. No va por el proxy Nest API salvo que añadas ruta explícita. |

En producción, restringe la red (solo Prometheus / VPC) o desactiva con `METRICS_ENABLED=0`.

## Variables de entorno (ingest)

| Variable | Default | Efecto |
|----------|---------|--------|
| `METRICS_ENABLED` | activo | `0` / `false`: sin métricas ni `nodejs_*` default; `GET /metrics` → 503. |

Se mantiene `CHAT_TELEMETRY_LOG` para logs JSON por request (complementario, no sustituye series).

## Series Prometheus

### Chat (pipeline unificado)

| Métrica | Tipo | Labels | Significado |
|---------|------|--------|-------------|
| `ariadne_chat_pipeline_duration_seconds` | Histogram | `scope`=`repo`\|`project`, `two_phase`=`true`\|`false` | Tiempo retriever + sintetizador (segundos). |
| `ariadne_chat_empty_retrieval_total` | Counter | igual | Sin contexto reunido antes del sintetizador. |
| `ariadne_chat_low_path_grounding_total` | Counter | `scope` | Respuesta con paths citados pero &lt;50% presentes en retrieval (heurística). |
| `ariadne_chat_pipeline_errors_total` | Counter | — | Excepción en `chat` / `chatByProject` antes de respuesta OK. |

### Ingest / parser / sync

| Métrica | Tipo | Labels | Significado |
|---------|------|--------|-------------|
| `ariadne_ingest_sync_jobs_failed_total` | Counter | `source`=`full_sync`\|`webhook` | Job pasado a `failed`. |
| `ariadne_ingest_parse_truncated_total` | Counter | — | Parse OK tras truncar (`TRUNCATE_PARSE_MAX_BYTES`). |
| `ariadne_ingest_parse_failed_total` | Counter | — | `parseSource` devolvió `null` tras fallos. |
| `ariadne_nodejs_*` | (default) | — | CPU, memoria, GC, etc. (`prom-client` collectDefaultMetrics). |

## SLO de partida (ajustar con datos)

Valores **iniciales** a refinar después de 1–2 semanas de histogram\_\* en producción:

| Objetivo | Métrica / consulta | Target sugerido |
|----------|-------------------|-----------------|
| Latencia chat | `histogram_quantile(0.95, sum(rate(ariadne_chat_pipeline_duration_seconds_bucket[5m])) by (le))` | &lt; 45 s (depende del modelo y tamaño de contexto) |
| Retrieval vacío | `rate(ariadne_chat_empty_retrieval_total[1h]) / rate(ariadne_chat_pipeline_duration_seconds_count[1h])` o ratio vs chats | &lt; 15 % (si es mayor: índice, scope o preguntas fuera de alcance) |
| Grounding débil | `rate(ariadne_chat_low_path_grounding_total[1h])` | Tendencia a la baja tras mejoras GraphRAG |
| Sync estable | `rate(ariadne_ingest_sync_jobs_failed_total[24h])` | Cerca de 0 salvo incidentes de red/credenciales |
| Parser | `rate(ariadne_ingest_parse_failed_total[1h])` | Vigilar picos tras cambios Tree-sitter |

**Job CI / PR (Fase 1):** cuando exista, añadir histograma propio (p. ej. `ariadne_pr_impact_check_duration_seconds`); hasta entonces el SLO de PR queda documentado pero no instrumentado aquí.

## Alertas (ejemplo PromQL)

```yaml
# Ejemplo: muchos chats sin contexto
- alert: AriadneChatEmptyRetrievalHigh
  expr: |
    sum(rate(ariadne_chat_empty_retrieval_total[15m]))
      / sum(rate(ariadne_chat_pipeline_duration_seconds_count[15m])) > 0.25
  for: 30m
  labels:
    severity: warning
  annotations:
    summary: "Alto ratio de chat sin retrieval en Ariadne ingest"
```

## Referencias

- Plan de producto: [Mejoras_Ariadne_Marzo.md](./Mejoras_Ariadne_Marzo.md)
- Código: `services/ingest/src/metrics/`, instrumentación en `chat.service.ts`, `sync.service.ts`, `webhooks.service.ts`, `pipeline/parser.ts`
