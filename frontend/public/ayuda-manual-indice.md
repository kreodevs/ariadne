# Docs Ariadne

Índice de documentación del proyecto Ariadne (análisis de código con grafo FalkorDB, ingesta Bitbucket/GitHub, chat NL, MCP Oracle, **gobierno de arquitectura** (dominios, C4, whitelist proyecto→dominio) y frontend de administración).

## Instalación y uso


| Doc                                      | Descripción                                                                                                          |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **notebooklm/INSTALACION_MCP_CURSOR.md** | Instalación del MCP AriadneSpecs para Cursor (configuración, variables, troubleshooting).                            |
| **notebooklm/MCP_AYUDA.md**              | Ayuda resumida: instalación, escenarios, herramientas, troubleshooting. Se muestra en la sección Ayuda del frontend. |
| **manual/README.md**                     | Manual de uso y validación (puesta en marcha, uso por componente, tests y comprobación).                             |
| **manual/CONFIGURACION_Y_USO.md**        | Configuración y uso (variables de entorno, credenciales en BD, flujos de trabajo, troubleshooting).                  |


## Arquitectura y referencia


| Doc                                | Descripción                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **notebooklm/architecture.md**     | Stack (NestJS, TypeORM, PostgreSQL, FalkorDB, Redis), modelo repo/webhook, credenciales cifradas.                                     |
| **notebooklm/indexing_engine.md**  | Pipeline de indexación y fuentes (parser, producer, complexity, nestingDepth, loc).                                                   |
| **notebooklm/ingestion_flow.md**   | Flujo de ingesta masiva (capas, cola, webhook bridge, shallow clone).                                                                 |
| **notebooklm/db_schema.md**        | Grafo FalkorDB (nodos, relaciones) y **tablas PostgreSQL** (repositories, projects, **domains**, **project_domain_dependencies**, …). |
| **notebooklm/mcp_server_specs.md** | Especificación del servidor MCP AriadneSpecs Oracle.                                                                                  |


## Funcionalidades


| Doc                                 | Descripción                                                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **notebooklm/CHAT_Y_ANALISIS.md**   | Chat NL→Cypher, diagnósticos, antipatrones, métricas, duplicados, reingeniería, código muerto, seguridad; rutas por repo y por proyecto (`AnalyticsService`, multi-root). |
| **notebooklm/bitbucket_webhook.md** | Configuración del webhook Bitbucket para ingest.                                                                                                                          |


## Deployment y negocio


| Doc                                                | Descripción                                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **notebooklm/DEPLOYMENT_DOKPLOY.md**               | Deployment en Dokploy (apiariadne.kreoint.mx / ariadne.kreoint.mx).                      |
| **notebooklm/RESUMEN_RELIC_PARA_OTRO_PROYECTO.md** | Cómo integrar otro proyecto con Ariadne y MCP (`.ariadne-project`, list_known_projects). |
| **notebooklm/RELIC_ESTRATEGIA_INVERSION.md**       | Estrategia de inversión / roadmap.                                                       |
| **notebooklm/RELIC_PRESENTACION_EJECUTIVA.md**     | Presentación ejecutiva para stakeholders.                                                |


## Otros


| Doc                               | Descripción                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| **ariadne-project.example**       | Ejemplo de `.ariadne-project` para fijar `projectId` en el repo que se mantiene con Ariadne. |
| **cursor-rule-relic-project.mdc** | Regla de Cursor: usar `projectId` de `.ariadne-project` en llamadas al MCP.                  |
| **notebooklm/constitution.md**    | Principios y convenciones del proyecto.                                                      |


En la raíz del repo: **AGENTS.md** — Protocolo para agentes (list_known_projects al inicio, preferencia projectId, flujos de diagnóstico y SDD).