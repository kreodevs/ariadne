# Métricas (Fase 0)

- **`GET /metrics`**: formato Prometheus (`text/plain`). Incluye métricas Node por defecto (`ariadne_nodejs_*`) y métricas de negocio (`ariadne_chat_*`, `ariadne_ingest_*`).
- **`METRICS_ENABLED`**: `0` o `false` desactiva el registro y el endpoint responde 503 (útil en entornos donde no debe exponerse scrape).

Definición de series y SLO sugeridos: [docs/OBSERVABILIDAD_FASE0.md](../../../../docs/OBSERVABILIDAD_FASE0.md).
