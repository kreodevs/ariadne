# Docs Ariadne

- **INSTALACION_MCP_CURSOR.md** — Instalación del MCP FalkorSpecs para Cursor.
- **MCP_AYUDA.md** — Ayuda resumida: instalación, escenarios, herramientas, troubleshooting. Se muestra en la sección Ayuda del frontend.
- **DEPLOYMENT_DOKPLOY.md** — Deployment en Dokploy (apiariadne.kreoint.mx / ariadne.kreoint.mx).
- **manual/README.md** — Manual de uso y validación (puesta en marcha, proyectos multi-root, uso por componente, tests y comprobación).
- **manual/CONFIGURACION_Y_USO.md** — Manual de configuración y uso (variables de entorno, credenciales en BD, proyectos, resync desde repo/proyecto, flujos de trabajo, troubleshooting).
- **architecture.md** — Stack (NestJS, TypeORM, PostgreSQL), modelo repo/webhook, proyectos multi-root (project_repositories), Context/Hook en grafo, credenciales cifradas, cola Redis.
- **indexing_engine.md** — Pipeline de indexación (parser, producer, Context, custom Hook, repoId en nodos).
- **CHAT_Y_ANALISIS.md** — Chat por repo y por proyecto, diagnósticos, antipatrones, código muerto, duplicados, reingeniería.
- **ingestion_flow.md** — Flujo de ingesta masiva (capas, cola, webhook bridge, shallow clone; resync desde repo vs desde proyecto).
- **db_schema.md** — Esquema del grafo FalkorDB (nodos Context, Hook custom, DomainConcept context, project_repositories).
- **bitbucket_webhook.md** — Configuración del webhook Bitbucket para ingest.
- **mcp_server_specs.md** — Especificación MCP: proyecto vs repo, list_known_projects (roots), get_file_content/get_modification_plan, fallbacks ingest.
- **plan_faltantes.md** — Plan de tareas para modelo (CALLS cross-file, Nest/Strapi), operación (frontend, migraciones, webhook), calidad y opcionales.
- **plan_gaps_objetivos.md** — Análisis de brechas frente a objetivos (multi-proyecto, MCP, anti-alucinación, Q&A dev, manuales de usuario).
- **reingenieria_stack_y_ingesta.md** — Contexto de la reingeniería del stack y la ingesta.

Otros: blueprint, constitution, agentes_specs, dfd_specs. En la raíz: **AGENTS.md** — Protocolo para agentes (list_known_projects con roots, projectId proyecto o repo, get_modification_plan).
