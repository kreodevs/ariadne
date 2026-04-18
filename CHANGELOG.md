# Changelog

Todas las notas de versión de **Ariadne / FalkorSpecs** (monorepo).  
Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/).

## [Unreleased]

### Changed

- **Documentación:** referencias de ayuda (`CHAT_Y_ANALISIS`, `ingestion_flow`, `bitbucket_webhook`, `DEPLOYMENT_DOKPLOY`, `TESTING`, caché/diagnóstico, observabilidad, métricas chat, RELIC, etc.) consolidadas bajo **`docs/notebooklm/`**; `copy-docs.sh`, `DocViewer.tsx`, README raíz, manuales y servicios actualizados.
- **Documentación:** `docs/db_schema.md` movido a **`docs/notebooklm/db_schema.md`**; enlaces y `frontend/scripts/copy-docs.sh` actualizados. Ayuda MCP/INSTALACION/arquitectura copian desde `docs/notebooklm/` cuando el archivo ya no está en la raíz de `docs/`.
- **`docs/mcp_server_specs.md`** → **`docs/notebooklm/mcp_server_specs.md`**; enlaces en README, MONOREPO, `types.ts`, etc.; copia estática `public/mcp_server_specs.md` en `copy-docs.sh`; enlace absoluto `/mcp_server_specs.md` en INSTALACION_MCP_CURSOR.
- **`docs/indexing_engine.md`** → **`docs/notebooklm/indexing_engine.md`**; README, manuales, `copy-docs.sh` y `DocViewer.tsx` actualizados.

### Added

- **Gobierno de arquitectura (dominios, C4, whitelist proyecto→dominio):** entidades TypeORM `Domain`, `ProjectDomainDependency`, `Project.domainId`; ingest `DomainsService`, `C4DslGeneratorService`, `GET /projects/:id/architecture/c4`, `GET /projects/:id/graph-routing` con `cypherShardContexts`; chat/MCP ejecutan Cypher multi-shard con el `cypherProjectId` correcto; frontend `/domains` y pestaña Arquitectura en proyecto (`C4Previewer` / Kroki). Ver README de `services/ingest`, `services/api`, `services/mcp-ariadne`, `frontend`.

- **Ingest — chat multi-root (Fase 3, primera entrega)**  
  - Inferencia de `repoId` desde mensaje + `project_repositories.role` (`resolve-chat-scope-from-message.util.ts`, `CHAT_INFER_SCOPE_FROM_ROLES`).  
  - Preflight: recorte de filas/contexto cuando el mensaje incluye una ruta que resuelve a un único repo (`chat-preflight-scope.util.ts`, `CHAT_PREFLIGHT_PATH_REPO`).  
  - `ChatRequest`: `clientMeta`, `strictChatScope`; respuesta `[AMBIGUOUS_SCOPE]` cuando hay varios repos sin acotar.  
  - `ProjectsService.getRepositoryRolesContext` para el prompt del sintetizador.  
  - Telemetría `CHAT_TELEMETRY_LOG`: objeto `chat_scope_effective` (preflight, inferencia, alcance).  
  - Documentación: `docs/notebooklm/metricas-alcance-chat.md`; README chat/projects actualizados.
  - Listados íntegros en chat (tablas Markdown, respuesta temprana; topes `CHAT_COMPONENT_FULL_MAX`, `CHAT_GRAPH_INVENTORY_FULL_MAX`).
  - `PATCH /projects/:id/repositories/:repoId` con `{ role }`; UI de rol en detalle de proyecto.
  - Script raíz `pnpm metrics:chat-telemetry` (`scripts/aggregate-chat-telemetry.mjs`).
  - Frontend **ProjectChat**: opción chat amplio (`strictChatScope: false`) con varios repos.
  - Frontend **RepoDetail**: botón **Indexar embeddings** → `POST /repositories/:id/embed-index` (reindexar vectores tras Fase 4 o cambio de modelo).

- **Ingest — Fase 4 (Storybook / markdown en grafo)**  
  - `storybook-documentation.ts`, `storybook-csf-ast.ts`; `parser` + `producer`: `StorybookDoc`, `MarkdownDoc`, enlaces a `Component`/`File`, CSF `STORYBOOK_TARGETS_FILE`.  
  - `sync-path-filter.ts`; listados GitHub/Bitbucket y walk de clone alineados (incl. MDX Storybook, JSON Strapi acotado).  
  - Sync/webhook/shadow: markdown vía parser/producer (sin chunk `Document` por defecto).  
  - `embed-index`: vectores para `StorybookDoc` y `MarkdownDoc`.  
  - Chat `semanticSearchFallback` y MCP `semantic_search`: consultas vectoriales + keyword para docs.

- **Fase 5 (pulido)**  
  - `ariadne-common`: `graph-labels.ts` (`FALKOR_EMBEDDABLE_NODE_LABELS`, `FALKOR_DOCUMENTATION_DOC_LABELS`); ingest `embed-index` crea índices vectoriales iterando esa lista.  
  - `services/cartographer/README.md`: alcance vs ingest canónico.  
  - Raíz `pnpm dev:setup`: añade `pnpm -C frontend install`.
  - Documentación: README raíz (versionado semver); API (autenticación / sin SSO); manuales y `CHAT_Y_ANALISIS` — embed-index y `semantic_search` incluyen Storybook/Markdown.

- **Fase 6 — Analytics multi-root**  
  - Vitest: `services/ingest/src/chat/analytics.service.spec.ts` (`resolveRepositoryIdForAnalysis`, `analyzeByProjectId`).  
  - `services/ingest/README.md`: sección decisiones / contratos Fase 6.  
  - Planes: `PLAN_INCORPORACION_MEJORAS_RELIC_EN_ARIADNE.md` (Fase 6), `Plan_Implementacion_Fase6_AnalyticsService.md`, `Plan_Autonomia_Ariadne.md` actualizados.
  - `GET /projects/:projectId/jobs/:jobId/analysis` — `JobAnalysisService.analyzeJobForProject`; export de `JobAnalysisService` en `RepositoriesModule`; Vitest `job-analysis.service.spec.ts`.

- **Backlog §2 (producto / docs / CI / MCP)**  
  - MCP: caché de herramientas (`get_component_graph`, `get_legacy_impact`, `get_sync_status`) con **memoria por defecto**; Redis solo si `MCP_REDIS_URL` o `REDIS_URL` (o `MCP_REDIS_DISABLED=1` fuerza memoria). Documentado en `services/mcp-ariadne/README.md`.  
  - Docs: `docs/notebooklm/plan-analyze-layer-cache.md`, `docs/notebooklm/diagnostico-layer-dependencies.md` (caché analyze / capas diagnóstico en ingest).  
  - CI: `.github/workflows/ci-ingest-mcp.yml` (Vitest ingest + build MCP).  
  - Frontend **RepoDetail**: `JobAnalysisModal` usa `api.getJobAnalysisByProject` cuando el repo tiene `projectId` / `projectIds`.
  - Frontend **RepoList** (`/repos`): botón **Resync** por fila (`POST /repositories/:id/resync`) sin entrar al detalle.
  - **Indexado:** `sync-path-filter` omite carpetas e2e/playwright/cypress/`__tests__`/`__mocks__` y `*.e2e.*`; env **`INDEX_E2E=1`** para incluirlas; Vitest `sync-path-filter.spec.ts`.
  - **Frontend:** Vitest (`utils.spec.ts`), Playwright (`e2e/smoke.spec.ts`), `VITE_E2E_AUTH_BYPASS` en `ProtectedRoute`; CI `ci-frontend.yml`; `docs/notebooklm/TESTING.md`.

## [1.2.0] — 2026-04-14

### Added

- **Ingest — Fase 0 migraciones**  
  - `1743200000000-ProjectRepositoryRole`: columna `project_repositories.role` (nullable).  
  - `1743300000000-IndexedFileContentHash`: columna `indexed_files.content_hash` (nullable).  
  - Entidades alineadas; `ProjectsService` expone `role` en repos; plan de modificación usa roles en etiquetas de diagnóstico.  
  - Documentación: `docs/comparativa/MIGRACIONES_CADENA_ARIADNE.md`.

- **Ingest — plan de modificación (multi-root y retrieval)**  
  - Utilidades `modification-plan-resolve`, `modification-plan-scope-cypher`, `modification-plan-terms`, `modification-plan-path-hints`, `modification-plan-path-exclusions`, `markdown-fence`.  
  - `POST /projects/:id/modification-plan`: `currentFilePath`, `questionsMode` (`business` | `technical` | `both`), respuesta con `warnings` y `diagnostic`.  
  - `ProjectsService.resolveRepositoryForWorkspacePath` y resolución `unique` | `ambiguous` en `path-repo-resolution.util.ts`.  
  - Vitest en ingest (`npm test`) y exclusión de `*.spec.ts` del build Nest.

- **MCP** — `get_modification_plan` reenvía `currentFilePath`, `questionsMode` y serializa `warnings` / `diagnostic`.

- **Ingest — Fase 2: análisis con caché, scope y capas de diagnóstico**  
  - Caché LRU y Redis opcional para modos cacheables (`ANALYZE_CACHE_*`, `ANALYZE_CACHE_REDIS_URL` / `REDIS_URL`); respuesta con `reportMeta` (`fromCache`, foco, cobertura, capa extrínseca CALL).  
  - `POST /repositories/:id/analyze` y `POST /projects/:projectId/analyze`: cuerpo con `scope` (alineado con chat) y `crossPackageDuplicates` (modo duplicados); validación de scope (`includePathPrefixes` vacío → 400).  
  - Utilidades y servicios: `analyze-cache.util`, `analyze-distributed-cache.service`, `analyze-focus.util`, `diagnostico-intrinsic-layer`, `diagnostico-validate.util`; límites vía `MAX_ANALYZE_CALL_EDGES` / env relacionados.  
  - `AnalyticsService.analyzeByProjectId` reenvía `analyzeOptions` a `ChatService.analyze`; `POST .../analyze-prep` interno acepta las mismas opciones.  
  - Documentación de API en `services/ingest/src/chat/README.md`; plan de paridad actualizado en `docs/comparativa/PLAN_INCORPORACION_MEJORAS_RELIC_EN_ARIADNE.md`.

- **MCP (`mcp-ariadne`) — `get_project_analysis`**  
  - Argumentos `scope` y `crossPackageDuplicates`; si el ingest devuelve `reportMeta`, la salida incluye el markdown del informe y un bloque JSON con los metadatos.

- **Frontend — panel de analyze**  
  - `api.analyze` / `api.analyzeProject` con body extendido; **RepoChat** y **ProjectChat**: alcance opcional (prefijos / globs), duplicados cross-boundary, badges de caché y foco; en proyecto multi-root, selector de repo para análisis de código.

## [1.1.0] — 2026-03-27

### Added

- **FalkorDB: sharding por dominio (monorepos grandes)**  
  - Modo `domain` vs `project` en `projects` (`falkor_shard_mode`, `falkor_domain_segments`).  
  - Env: `FALKOR_SHARD_BY_DOMAIN`, `FALKOR_AUTO_DOMAIN_OVERFLOW`, `FALKOR_GRAPH_NODE_SOFT_LIMIT`.  
  - Utilidades en `ariadne-common`: `effectiveShardMode`, `domainSegmentFromRepoPath`, `listGraphNamesForProjectRouting`, `shadowGraphNameForSession`, etc.  
  - Migración TypeORM `ProjectFalkorShardRouting`.

- **Espacios de embedding (catálogo multi-modelo)**  
  - Tabla `embedding_spaces` y FKs `read_embedding_space_id` / `write_embedding_space_id` en `repositories`.  
  - API `GET|POST /embedding-spaces`, DTO `CreateEmbeddingSpaceDto`, servicio `EmbeddingSpaceService`.  
  - Utilidad `graph-property.util` para alinear propiedades del grafo con espacios vectoriales.  
  - Proveedor **Ollama** para embeddings locales.  
  - Migración `EmbeddingSpaces`.

- **Ingest — chat e integración con orquestador**  
  - `ChatRetrieverToolsService`: herramientas del retriever sin pasar por el LLM del ingest.  
  - Controllers internos `InternalChatToolsController`, `InternalProjectToolsController` bajo `InternalApiGuard` (red Docker / orchestrator).  
  - Refuerzo del `ChatService` y handlers para flujos analyze / scope.

- **Orchestrator — módulo `codebase-chat`**  
  - Cliente HTTP al ingest (`IngestChatClient`), capa LLM (`OrchestratorLlmService`).  
  - Endpoints de chat, análisis de codebase y plan de modificación (`Codebase*Controller` / `*Service`).  
  - Utilidades de scope y constantes dedicadas.

- **API grafo**  
  - Mejoras en `GraphService` / `GraphController`: resolución de nodos multi-repo, saneo de escalares Falkor, rutas y OpenAPI actualizados.  
  - `FalkorService` y caché alineados con partición y rutas de grafo.

- **Infra**  
  - Variables de entorno de sharding en `docker-compose` para api / ingest / mcp según servicio.

### Changed

- **Sync (`ingest`)**: lógica ampliada para coordinar índice, repositorios y rutas Falkor con los nuevos modos de partición y espacios de embedding.  
- **Shadow service**: alineación con nombres de grafo por sesión.  
- **Proyectos y repositorios**: campos y DTOs para shard Falkor y referencias a espacios de embedding.  
- **Proveedores de embedding** (Google, OpenAI): ajustes para encajar en el catálogo de espacios y configuración.  
- **`mcp-ariadne`**: herramientas y resolución Falkor multi-grafo / listado de candidatos para routing MCP.  
- **`packages/ariadne-common`**: contrato público ampliado (`index` exporta nuevas utilidades Falkor).  
- **Redis state / workflow (orchestrator)**: extensiones para soportar flujos del codebase-chat.

### Fixed

- Corrección de representación de propiedades de nodos Falkor que llegaban como objetos (evita `"[object Object]"` en IDs y aristas en UI/API).  
- IDs estables de nodos en vistas de grafo cuando hay colisiones de `name` entre repos (`projectId` / `repoId` / `path` en clave compuesta).

### Impacto arquitectónico

- **Grafo de dependencias**: aparece un eje **orchestrator → ingest** explícito (HTTP interno + herramientas retriever), además del flujo existente ingest → Falkor/Postgres.  
- **Falkor**: de un grafo lógico por proyecto puede derivarse un **conjunto de grafos** por segmento de ruta; API, MCP e ingest deben acordar `projectId`, modo de shard y segmentos conocidos.  
- **Datos**: nuevas tablas/columnas exigen **migraciones** antes de desplegar; re-sync recomendable tras activar `domain` u overflow automático.  
- **Embeddings**: desacoplamiento modelo/proveedor vía `embedding_spaces` y asociación por repositorio (lectura/escritura), moviendo el sistema hacia multi-tenant vectorial sin reemplazar el índice existente de golpe.

---

## [1.0.0] — línea base previa

Versión documentada en `package.json` de servicios (`1.0.0`) antes de este release: ingest orchestration, API grafo, MCP, Falkor por proyecto (`FALKOR_SHARD_BY_PROJECT`), sin espacios de embedding persistidos ni sharding por dominio en BD.
