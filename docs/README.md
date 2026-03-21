# Docs Ariadne

- **INSTALACION_MCP_CURSOR.md** — Instalación del MCP AriadneSpecs para Cursor.
- **MCP_AYUDA.md** — Ayuda resumida: instalación, escenarios, herramientas, troubleshooting. Se muestra en la sección Ayuda del frontend.
- **DEPLOYMENT_DOKPLOY.md** — Deployment en Dokploy (apiariadne.kreoint.mx / ariadne.kreoint.mx).
- **manual/README.md** — Manual de uso y validación (puesta en marcha, uso por componente, tests y comprobación).
- **manual/CONFIGURACION_Y_USO.md** — Manual de configuración y uso (variables de entorno, credenciales en BD, flujos de trabajo, troubleshooting).
- **architecture.md** — Stack (NestJS, TypeORM, PostgreSQL), modelo repo/webhook, credenciales cifradas, cola Redis.
- **indexing_engine.md** — Pipeline de indexación y fuentes (parser, producer, complexity, nestingDepth, loc).
- **CHAT_Y_ANALISIS.md** — Chat NL→Cypher, diagnósticos, antipatrones, métricas, duplicados, reingeniería (para mantener/extender).
- **ingestion_flow.md** — Flujo de ingesta masiva (capas, cola, webhook bridge, shallow clone).
- **db_schema.md** — Esquema del grafo FalkorDB (nodos, relaciones).
- **bitbucket_webhook.md** — Configuración del webhook Bitbucket para ingest.
- **plan_faltantes.md** — Plan de tareas para modelo (CALLS cross-file, Nest/Strapi), operación (frontend, migraciones, webhook), calidad y opcionales.
- **plan_gaps_objetivos.md** — Análisis de brechas frente a objetivos (multi-proyecto, MCP, anti-alucinación, Q&A dev, manuales de usuario).
- **reingenieria_stack_y_ingesta.md** — Contexto de la reingeniería del stack y la ingesta.
- **NOTEBOOKLM_SNAPSHOT_MCP_MULTIREPO.md** — Snapshot para NotebookLM: multi-root, `get_modification_plan`, opcional `scope`.
- **plan_mcp_grounding_y_retrieval.md** — Plan de grounding/retrieval: estado implementado (§1–§3, §5–§7 parcial); backlog menor (post-validación paths, §4 imports dedicados, centralidad en plan).

Otros: blueprint, constitution, agentes_specs, dfd_specs, mcp_server_specs. En la raíz: **AGENTS.md** — Protocolo para agentes (list_known_projects al inicio, preferencia projectId).
