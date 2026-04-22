# RepoChat

Página de chat con el repositorio: preguntas en lenguaje natural → Cypher → FalkorDB.

## Componentes

- **RepoChat.tsx** — Página principal con layout split: panel de análisis a la izquierda, chat a la derecha.
- **FullAuditModal.tsx** — Modal de Full Repo Audit (auditoría de estado cero).

## Alcance opcional

Panel **Alcance opcional**: prefijos de ruta y globs de exclusión (una línea por entrada) se envían como `scope` en `POST /repositories/:id/analyze` **y** en `POST /repositories/:id/chat` (menos tokens / 429). Checkbox **Duplicados cross-boundary** añade `crossPackageDuplicates` en modo duplicados.

## Modo Ariadne (The Forge)

**ChatPipelineModeSelect** + `ingestOptionsFromChatPipelineMode` (`frontend/src/utils/chat-pipeline-mode.ts`):

- **Chat normal** — sin `responseMode` (prosa en backend).
- **MDD / SDD** — `responseMode: evidence_first`: una respuesta JSON MDD (7 claves); **ChatAssistantContent** lo muestra formateado.
- **Evidencia bruta** — `responseMode: raw_evidence` + `deterministicRetriever: true`: sin LLM en la fase de retrieve en ingest.

**MCP `ask_codebase`:** mismos tres comportamientos con `responseMode` = `default` \| `evidence_first` \| `raw_evidence`. **Ojo:** si el agente **omite** `responseMode`, el servidor MCP fuerza `raw_evidence` + `deterministicRetriever: true` (equivalente a “Evidencia bruta”), no a “Chat normal”; para prosa+ReAct hay que pasar **`responseMode: "default"`**. Detalle: [docs/notebooklm/mcp_server_specs.md](../../../docs/notebooklm/mcp_server_specs.md) (subsection *Modo The Forge*).

`api.chat` reintenta hasta 3 veces ante **429** con backoff.

## Componentes de chat

- **ChatAssistantContent.tsx** — Detecta JSON MDD / raw_evidence o Markdown.
- **ChatPipelineModeSelect.tsx** — Radios de modo pipeline.

Tras la respuesta, **badges** bajo el título del informe muestran `reportMeta` (p. ej. **Caché**, **Alcance activo**, huella degradada, capa CALL cache) y la nota de cobertura del grafo si viene en el payload.

## Botones de análisis

- **Diagnóstico** — Deuda técnica, antipatrones, riesgo.
- **Duplicados** — Código duplicado (embeddings + nombres idénticos).
- **Reingeniería** — Plan priorizado basado en diagnóstico + duplicados.
- **Código muerto** — Archivos/funciones/componentes sin referencias.
- **AGENTS** — Genera `AGENTS.md`: protocolo para agentes AI (protocolo de sesión, herramientas por intención, flujos SDD). Basado en Model Context Protocol Handbook.
- **SKILL** — Genera `SKILL.md`: skill para Cursor/Claude (YAML frontmatter, instrucciones, ejemplos, troubleshooting). Basado en MCP Handbook.
- **Full Audit** — Auditoría completa: arquitectura, seguridad, deuda, plan de acción.
- **Ver índice** — Navegador del grafo FalkorDB.

## Full Audit

El botón "Full Audit" ejecuta `POST /repositories/:id/full-audit` y muestra:

- Executive Summary: score de salud 0-100, top riesgos, horas de deuda estimadas.
- Critical Findings: tabla con Hallazgo | Impacto | Esfuerzo | Prioridad.
- Action Plan: pasos recomendados para las próximas 2 semanas.
- Detalle de seguridad (secretos expuestos), arquitectura (god objects, imports circulares, complejidad) y salud del código (código muerto, duplicados).
