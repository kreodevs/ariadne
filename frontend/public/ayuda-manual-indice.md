# Docs Ariadne

Índice de documentación del proyecto Ariadne (análisis de código con grafo FalkorDB, ingesta Bitbucket/GitHub, chat NL, MCP Oracle y frontend de administración).

## Instalación y uso

- **INSTALACION_MCP_CURSOR.md** — Instalación del MCP AriadneSpecs para Cursor.
- **MCP_AYUDA.md** — Ayuda resumida: instalación, escenarios, herramientas, troubleshooting. Se muestra en la sección Ayuda del frontend.
- **manual/README.md** — Manual de uso y validación (puesta en marcha, uso por componente, tests y comprobación).
- **manual/CONFIGURACION_Y_USO.md** — Configuración y uso (variables de entorno, credenciales en BD, flujos de trabajo, troubleshooting).

## Arquitectura y referencia

- **architecture.md** — Stack (NestJS, TypeORM, PostgreSQL, FalkorDB, Redis), modelo repo/webhook, credenciales cifradas.
- **indexing_engine.md** — Pipeline de indexación y fuentes (parser, producer, complexity).
- **ingestion_flow.md** — Flujo de ingesta masiva (capas, cola, webhook bridge, shallow clone).
- **db_schema.md** — Esquema del grafo FalkorDB (nodos, relaciones).
- **mcp_server_specs.md** — Especificación del servidor MCP AriadneSpecs Oracle.

## Funcionalidades

- **CHAT_Y_ANALISIS.md** — Chat NL→Cypher, diagnósticos, antipatrones, métricas, duplicados, reingeniería.
- **bitbucket_webhook.md** — Configuración del webhook Bitbucket para ingest.

## Deployment y negocio

- **DEPLOYMENT_DOKPLOY.md** — Deployment en Dokploy.
- **RESUMEN_RELIC_PARA_OTRO_PROYECTO.md** — Cómo integrar otro proyecto con Ariadne y MCP (`.ariadne-project`).
- **RELIC_ESTRATEGIA_INVERSION.md** — Estrategia de inversión / roadmap.
- **RELIC_PRESENTACION_EJECUTIVA.md** — Presentación ejecutiva para stakeholders.

Otros: **constitution.md**, **ariadne-project.example**. En la raíz: **AGENTS.md** — Protocolo para agentes (list_known_projects al inicio, preferencia projectId).
