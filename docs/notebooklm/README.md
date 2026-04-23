# Docs Ariadne

Índice de documentación del proyecto Ariadne (análisis de código con grafo FalkorDB, ingesta Bitbucket/GitHub, chat NL, MCP Oracle, **gobierno de arquitectura** (dominios, C4, whitelist proyecto→dominio) y frontend de administración).

## Instalación y uso

| Doc | Descripción |
|-----|-------------|
| **INSTALACION_MCP_CURSOR.md** | Instalación del MCP para Cursor (esta carpeta). |
| **MCP_HTTPS.md** | Cliente HTTP(S) al MCP (Streamable HTTP, auth `MCP_AUTH_TOKEN`, nota API Nest en el servidor). |
| **MCP_AYUDA.md** | Ayuda resumida MCP (esta carpeta); copia al frontend como `ayuda-mcp.md`. |
| **../manual/README.md** | Manual de uso y validación (carpeta `docs/manual/`). |
| **../manual/CONFIGURACION_Y_USO.md** | Configuración detallada (`docs/manual/`). |

## Arquitectura y referencia

| Doc | Descripción |
|-----|-------------|
| **architecture.md** | Stack (NestJS, TypeORM, PostgreSQL, FalkorDB, Redis), modelo repo/webhook, credenciales cifradas. |
| **indexing_engine.md** | Pipeline de indexación (esta carpeta). |
| **ingestion_flow.md** | Flujo de ingesta masiva (esta carpeta). |
| **db_schema.md** | Grafo FalkorDB (nodos, relaciones) y tablas PostgreSQL (dominios, dependencias). |
| **mcp_server_specs.md** | Especificación del servidor MCP: herramientas, API Nest (`/api/graph/*` + JWT), fallback Falkor (esta carpeta). |

## Funcionalidades

| Doc | Descripción |
|-----|-------------|
| **CHAT_Y_ANALISIS.md** | Chat y análisis (esta carpeta). |
| **bitbucket_webhook.md** | Webhook Bitbucket (esta carpeta). |

## Deployment y negocio

| Doc | Descripción |
|-----|-------------|
| **DEPLOYMENT_DOKPLOY.md** | Deployment Dokploy (esta carpeta). |
| **RESUMEN_RELIC_PARA_OTRO_PROYECTO.md** | Integración con Ariadne (esta carpeta). |
| **RELIC_ESTRATEGIA_INVERSION.md** | Estrategia / roadmap (esta carpeta). |
| **RELIC_PRESENTACION_EJECUTIVA.md** | Presentación ejecutiva (esta carpeta). |

## Calidad y límites

| Doc | Descripción |
|-----|-------------|
| **TESTING.md** | Vitest ingest/frontend, Playwright, CI. |
| **MONOREPO_Y_LIMITACIONES_INDEXADO.md** | Alcance de índice y filtros. |
| **OBSERVABILIDAD_FASE0.md** | Observabilidad fase 0. |
| **metricas-alcance-chat.md** | Métricas de chat. |
| **diagnostico-layer-dependencies.md** / **plan-analyze-layer-cache.md** | Diagnóstico y caché analyze. |

## Otros

| Doc | Descripción |
|-----|-------------|
| **ariadne-common.md** | Paquete compartido. |
| **parser-ejemplo-circulo-activo.md** | Ejemplo parser. |
| **PROJECT_BRAIN_DUMP.md** | Brain dump monorepo. |
| **ariadne-project.example** | Ejemplo de `.ariadne-project` para fijar `projectId` en el repo que se mantiene con Ariadne. |
| **cursor-rule-relic-project.mdc** | Regla de Cursor: usar `projectId` de `.ariadne-project` en llamadas al MCP. |
| **constitution.md** | Principios y convenciones del proyecto. |
| **Mejoras_Ariadne_Marzo.md** | Mejoras / roadmap. |

**Shell frontend:** Gobierno (Dashboard, Dominios, Proyectos); Ingeniería (Repositorios, Cola de Sync, Nuevo Repo, C4 Viewer); Plataforma (Grafo, Credenciales, Ayuda). `/` → `/dashboard`.

En la raíz del repo: **AGENTS.md** — Protocolo para agentes (list_known_projects al inicio, preferencia projectId, flujos de diagnóstico y SDD).
