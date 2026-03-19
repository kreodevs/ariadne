# RepoChat

Página de chat con el repositorio: preguntas en lenguaje natural → Cypher → FalkorDB.

## Componentes

- **RepoChat.tsx** — Página principal con layout split: panel de análisis a la izquierda, chat a la derecha.
- **FullAuditModal.tsx** — Modal de Full Repo Audit (auditoría de estado cero).

## Botones de análisis

- **Diagnóstico** — Deuda técnica, antipatrones, riesgo.
- **Duplicados** — Código duplicado (embeddings + nombres idénticos).
- **Reingeniería** — Plan priorizado basado en diagnóstico + duplicados.
- **Código muerto** — Archivos/funciones/componentes sin referencias.
- **Full Audit** — Auditoría completa: arquitectura, seguridad, deuda, plan de acción.
- **Ver índice** — Navegador del grafo FalkorDB.

## Full Audit

El botón "Full Audit" ejecuta `POST /repositories/:id/full-audit` y muestra:

- Executive Summary: score de salud 0-100, top riesgos, horas de deuda estimadas.
- Critical Findings: tabla con Hallazgo | Impacto | Esfuerzo | Prioridad.
- Action Plan: pasos recomendados para las próximas 2 semanas.
- Detalle de seguridad (secretos expuestos), arquitectura (god objects, imports circulares, complejidad) y salud del código (código muerto, duplicados).
