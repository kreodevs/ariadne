# Plan de implementación: capacidades avanzadas del motor en **Ariadne**

**Fecha:** 14 de abril de 2026  

**Contexto:** Ariadne evoluciona su propio monorepo (ingest, grafo, MCP, UI). Este plan describe **funcionalidades objetivo** y **cómo integrarlas** sin acoplar el proyecto a repositorios ni artefactos externos.

---

## 0. Independencia del repositorio (obligatorio)

- **Sin enlaces ni rutas cruzadas:** En documentación, scripts, CI y código de Ariadne **no** deben aparecer URLs, paths de workspace, submódulos ni convenciones que apunten a otro repo de producto. Todo lo que se implemente vive **solo** bajo este árbol.
- **Portación:** Si se usa un baseline de código o changelog como ayuda **fuera** de Git (copia local, diff manual, notas privadas), eso no se versiona aquí como dependencia. El resultado debe ser **autosuficiente**: build, tests y manuales referencian únicamente Ariadne.
- **Nomenclatura:** Mantener `ariadne-common`, `mcp-ariadne`, `.ariadne-project` y textos de producto **Ariadne**. No introducir nombres de archivo, paquetes ni marca ajena en rutas públicas o UX.
- **Documentación funcional:** Registrar el delta en **`CHANGELOG.md` (raíz de Ariadne)** y en los manuales bajo `docs/` y `frontend/public/` de este repo.

---

## 1. Objetivo y criterios de éxito

- **Objetivo:** Igualar o superar las capacidades del motor de referencia (análisis con caché, chat multi-repo, plan de modificación robusto, Storybook/markdown en grafo, MCP alineado) **dentro** de Ariadne, con identidad y stack propios.
- **Autenticación (no negociable):** Solo el **login propio** actual (p. ej. `auth.controller`, OTP, email). **No** SSO ni middleware de identidad federada ajenos a este diseño.
- **Éxito:** Contratos HTTP/MCP estables y documentados aquí; ingest con Vitest al nivel del baseline de portación; sin regresiones en lo listado en la sección 3.

---

## 2. Inventario: capacidades pendientes o a completar en Ariadne

### 2.1 Ingest — análisis y caché (baseline ~1.5.0)

| Área | En baseline | Notas para implementar en Ariadne |
|------|-------------|-----------------------------------|
| Caché de análisis | `analyze-cache.util.ts`, `analyze-distributed-cache.service.ts` | **Hecho en ingest:** LRU + Redis opcional; env `ANALYZE_CACHE_*`, `ANALYZE_CACHE_REDIS_URL` / `REDIS_URL`; `reportMeta.fromCache` |
| Scope en `POST .../analyze` | Alineado con chat: `scope`, `crossPackageDuplicates`; `includePathPrefixes: []` → 400 | **Hecho:** `ChatService`, `POST /repositories/:id/analyze`, `POST /projects/:id/analyze` (+ `AnalyticsService`), `analyze-prep` interno |
| Capa extrínseca CALL | `diagnostico-intrinsic-layer.ts`, LRU/Redis | **Hecho en ingest** (capas intrínseca/extrínseca, límites, metadatos de capa) |
| Validación LLM vs fase A | `diagnostico-validate.util.ts`, `DIAGNOSTICO_VALIDATE_PATHS` | **Hecho en ingest** |
| Huella de índice | `content_hash` en `indexed_files` | **Fase 0:** migración `1743300000000-IndexedFileContentHash` (cadena en `MIGRACIONES_CADENA_ARIADNE.md`) |

### 2.2 Ingest — plan de modificación (baseline ~1.2.0 + mejoras posteriores)

| Archivo / comportamiento | Descripción |
|---------------------------|-------------|
| `modification-plan-resolve.util.ts` (+ spec) | Repo explícito en multi-root; diagnósticos `AMBIGUOUS_*`, `INVALID_REPO_SCOPE` |
| `modification-plan-scope-cypher.util.ts` (+ spec) | Scope en Cypher y candidatos semánticos |
| `modification-plan-path-hints.util.ts` (+ spec) | Priorización por hints `src/.../*.tsx` |
| `modification-plan-terms.util.ts` (+ spec) | Stopwords, `MODIFICATION_PLAN_TERM_MIN_LENGTH`, allowlist; sin `slice(0,80)` como aguja |
| `modification-plan-path-exclusions.util.ts` | Exclusiones `.cursor/`, `node_modules`, `.git`; env de override |
| `markdown-fence.util.ts` (+ spec) | Fences markdown robustos |

Campos API/MCP: `currentFilePath`, `questionsMode` (`business` \| `technical` \| `both`), `warnings`, `diagnostic`.

### 2.3 Ingest — chat

| Mejora | Archivos / env |
|--------|----------------|
| Inferencia de alcance por rol (admin multi-repo) | `resolve-chat-scope-from-message.util.ts`; `CHAT_INFER_SCOPE_FROM_ROLES` |
| Listados íntegros | `chat-wants-listing.spec.ts`; `CHAT_COMPONENT_FULL_MAX`, `CHAT_GRAPH_INVENTORY_FULL_MAX` |
| Preflight path → repo | `chat-preflight-scope.util.ts` (+ spec), `CHAT_PREFLIGHT_PATH_REPO` |
| Telemetría | `clientMeta`; `CHAT_TELEMETRY_LOG`; doc **`docs/metricas-alcance-chat.md`** en este repo (crear/actualizar aquí, no como enlace externo) |

### 2.4 Ingest — Storybook y Markdown en grafo (baseline ~1.3.0)

| Pieza | Descripción |
|-------|-------------|
| Pipeline | **Hecho:** `storybook-documentation.ts`, `storybook-csf-ast.ts`; rutas MD/MDX y CSF en `parser.ts` |
| Grafo | **Hecho:** `StorybookDoc`, `MarkdownDoc`; `HAS_STORYBOOK_DOC`, `HAS_MARKDOWN_DOC`, `STORYBOOK_DESCRIBES`, `STORYBOOK_TARGETS_FILE`, `MARKDOWN_DESCRIBES`, `MARKDOWN_TARGETS_FILE` |
| Embeddings | **Hecho:** `EmbedIndexService` + índices vectoriales Falkor para ambas etiquetas |
| Sync | **Hecho:** `providers/sync-path-filter.ts` (GitHub, Bitbucket, `git-clone.provider`) |

### 2.5 Proyectos y repos

| Mejora | Descripción |
|--------|-------------|
| Rol por repo | `ProjectRepositoryRole` (migración acorde a la sección 4) |
| Resolución path → repo | `path-repo-resolution.util.ts` (+ spec); `GET /projects/:id/resolve-repo-for-path` |
| Cola sync | `sync-queue.controller.ts`: incluir solo si aporta valor operativo en Ariadne |

### 2.6 MCP (`mcp-ariadne`)

| Mejora | Descripción |
|--------|-------------|
| Config proyecto | Comportamiento equivalente a `projectId` + `defaultRepoId` + `pathPrefixes`, expuesto vía **`.ariadne-project`** y helpers en este servicio (sin renombrar el paquete publicado) |
| `get_project_analysis` | **Hecho:** `scope`, `crossPackageDuplicates` hacia ingest; si hay `reportMeta`, markdown + bloque JSON |
| Búsqueda semántica | **Hecho:** ingest `semanticSearchFallback` + MCP `semantic_search` (vector y keyword) con `StorybookDoc` / `MarkdownDoc` |
| Dependencias | Revisar si `ioredis` en MCP sigue siendo necesario cuando la caché de análisis vive en ingest |

### 2.7 Paquete común (`ariadne-common`)

| Origen conceptual | Acción |
|-------------------|--------|
| Módulo tipo `strapi-enrich` | Añadir a `ariadne-common` **solo** si ingest/API lo necesitan; si no, omitir (YAGNI) |
| `falkor.ts` / `index.ts` | Etiquetas nuevas (`StorybookDoc`, etc.) en tipos/helpers compartidos |

### 2.8 Frontend

| Patrón en baseline | Integración en Ariadne |
|--------------------|-------------------------|
| Vistas de chat admin/usuario separadas | **Portar comportamiento** (scope opcional, badges de caché, metadatos) respetando layout y rutas actuales de Ariadne |
| `api.analyze` con scope y `crossPackageDuplicates` | **Hecho:** `frontend/src/api.ts` + UI en `RepoChat` / `ProjectChat` (alcance opcional, badges `reportMeta`) |
| Tarjeta de archivo IDE para el agente | Solo **`.ariadne-project`** en `ProjectDetail` (JSON, multi-root, copiar/descargar) |
| Utilidades | `strip-outer-markdown-fence.ts`, `select-safe.ts` si el chat las requiere |

### 2.9 API (`services/api`)

- **Mantener** login propio y cadena de guards actual.
- **Lista negra en portaciones:** no incorporar middleware SSO, JWKS, callbacks OAuth ni utilidades `sso.ts` / páginas `Callback` de modelos ajenos.
- **Sí incorporar:** mejoras aisladas en `falkor.service`, `graph.service`, `cache*`, OpenAPI, si no arrastran auth federada.

### 2.10 Scripts y documentación (solo rutas dentro de Ariadne)

- **Hecho en raíz:** `scripts/aggregate-chat-telemetry.mjs` y script `pnpm metrics:chat-telemetry` (agregación local sobre líneas JSON `chat_unified_pipeline`).
- **Creados / mantenidos:** `docs/metricas-alcance-chat.md`, `docs/diagnostico-layer-dependencies.md`, `docs/plan-analyze-layer-cache.md`. Revisar según release: `docs/db_schema.md`, `docs/indexing_engine.md`, `docs/CHAT_Y_ANALISIS.md`, manuales `frontend/public/`.

### 2.11 Calidad de ingeniería

- Vitest en ingest: `test` / `test:watch`.
- Alinear dependencias del ingest (p. ej. uso real de `@prisma/internals`) con el pipeline definitivo de Ariadne.

---

## 3. Lo que ya tiene Ariadne y no debe perderse

Al integrar capacidades nuevas, **preservar** hasta revisión explícita:

| Área | Ejemplos |
|------|----------|
| Ingest | `analytics.service.ts`, `chat-retriever-tools.service.ts`, guards/controllers `internal-*`, `metrics/`, embedding spaces, `prisma-extract.ts`, `markdown-chunk.ts` / `markdown-graph.ts` si siguen siendo canónicos |
| Orchestrator | `codebase-chat/` |
| Frontend | `HeaderSearch`, `Login.tsx` y sesión propia, átomos/layout, `ComponentGraph`, `graphScope.ts`, estilos propios |
| MCP | `redis.ts`, `utils.ts` (revisar duplicación tras cambios) |
| Migraciones | `1739180800000-EmbeddingSpaces.ts`, `1740000000000-ProjectFalkorShardRouting.ts`, `1743100000000-IngestRuntimeFlags.ts` |

**Regla:** archivos divergentes = **merge manual**; no sobrescribir el árbol Ariadne con un importación ciega.

---

## 4. Riesgo crítico: migraciones TypeORM

**Colisión conocida en historiales separados:** timestamp `1739180800000` usado para migraciones **distintas** (embedding spaces vs rol de repo).**Plan:**

1. Inventariar tablas/columnas de ambas intenciones.
2. Definir cadena única para BD existentes y nuevas (renombrar timestamp, migración compuesta o reconciliación — documentar en notas de despliegue **internas** o en `CHANGELOG`).
3. Incorporar migraciones necesarias: rol de repo, `IndexedFileContentHash`, etc., sin duplicar estado.
4. Validar con `migration:run` sobre copia de BD.

---

## 5. Estrategia de integración

1. Congelar un **commit de referencia** solo para uso local del equipo (no versionar como submódulo ni path en docs).
2. Portar por **dominio** (ingest/chat, pipeline, projects, MCP, frontend/api); sustituir cualquier import de paquete ajeno por **`ariadne-common`** y mensajes de producto por **Ariadne**.
3. Tres vías en conflictos: base histórica común + cambio entrante + HEAD Ariadne; priorizar lógica del motor entrante **salvo** extensiones Ariadne y **salvo auth** (siempre gana login propio).
4. El servidor MCP publicado sigue siendo **`mcp-ariadne`**.
5. Tras cada fase, actualizar **`CHANGELOG.md`** en la raíz de Ariadne.

---

## 6. Fases (orden sugerido)

### Fase 0 — Preparación

- [x] Vitest en ingest (`test` / `test:watch`); `tsconfig` excluye `*.spec.ts` del `nest build`.
- [x] Migraciones §4: `1743200000000-ProjectRepositoryRole`, `1743300000000-IndexedFileContentHash`; entidades y doc `MIGRACIONES_CADENA_ARIADNE.md`.

### Fase 1 — Multi-root y plan de modificación

- [x] Utilidades `modification-plan-*` + specs Vitest; `ChatService` / `ProjectChatController` / interno `modification-plan-files` con `currentFilePath`.
- [x] MCP: `get_modification_plan` con `currentFilePath`, `questionsMode`, serialización `warnings` / `diagnostic`.
- [x] `path-repo-resolution`: `resolveRepositoryIdForWorkspacePath` + `ProjectsService.resolveRepositoryForWorkspacePath`.

### Fase 2 — Análisis con caché y capas

- [x] Caché analyze + capas diagnóstico + límites de aristas (`services/ingest/src/chat/*`, utilidades `analyze-*.ts`, `diagnostico-*`).
- [x] Unificar con `AnalyticsService` (`analyzeOptions` → `chat.analyze`) y documentación Fase 6.
- [x] MCP `get_project_analysis`: `scope`, `crossPackageDuplicates`, salida con `reportMeta` en JSON.
- [x] Frontend: `api.analyze` / `api.analyzeProject` con body extendido; **RepoChat** y **ProjectChat** con alcance opcional y badges de caché / alcance (`reportMeta`).

### Fase 3 — Chat

- [x] Inferencia de alcance por rol (`resolve-chat-scope-from-message.util.ts`, `CHAT_INFER_SCOPE_FROM_ROLES`); preflight path→repo (`chat-preflight-scope.util.ts`, `CHAT_PREFLIGHT_PATH_REPO`); `strictChatScope` / `[AMBIGUOUS_SCOPE]` en `POST /projects/:id/chat`; telemetría ampliada (`CHAT_TELEMETRY_LOG`, `chat_scope_effective`); doc **`docs/metricas-alcance-chat.md`**.
- [x] Listados íntegros (respuesta temprana sin sintetizador; `CHAT_COMPONENT_FULL_MAX`, `CHAT_GRAPH_INVENTORY_FULL_MAX`, detectores y tablas Markdown en chat).
- [x] Script **`pnpm metrics:chat-telemetry`** (`scripts/aggregate-chat-telemetry.mjs`) para agregación local sobre logs JSON.
- [x] UI: toggle **chat amplio** (`strictChatScope: false`) en **ProjectChat** si hay varios repos; columna **Rol (chat)** y `PATCH .../repositories/:repoId` en **ProjectDetail**.

### Fase 4 — Storybook / Markdown + embeddings

- [x] Pipeline (`storybook-documentation`, `storybook-csf-ast`, ramas en `parser` / `producer`); nodos `StorybookDoc`, `MarkdownDoc` y relaciones; `sync-path-filter` + GitHub/Bitbucket/clone alineados; embed-index y `semantic_search` (ingest + MCP) incluyen docs; fallback keyword MCP para Storybook/Markdown.

### Fase 5 — Pulido

- [x] `ariadne-common`: `graph-labels.ts` (`FALKOR_EMBEDDABLE_NODE_LABELS`, docs); ingest `embed-index` usa la lista para `CREATE VECTOR INDEX`.
- [x] Cartographer: README aclara índice canónico en ingest y alcance sin Fase 4 por defecto.
- [x] API: `services/api/README.md` — sin SSO/OIDC en el servicio; auth en capa de despliegue si aplica.
- [x] Versionado semver: `README.md` raíz — CHANGELOG + alinear `package.json` en release; ingest README embed-index alineado con Fase 4.
- [x] Raíz: `pnpm dev:setup` incluye `frontend install`.

### Fase 6 — `AnalyticsService` y análisis multi-root

- [x] Fachada `AnalyticsService` (`resolveRepositoryIdForAnalysis`, `analyzeByProjectId` → `ChatService.analyze`).
- [x] `POST /projects/:projectId/analyze` para modos de código con `idePath` / `repositoryId` opcionales; `POST /repositories/:id/analyze` sin cambio semántico (`:id` = repo).
- [x] MCP `get_project_analysis`: proyecto vs repo + `currentFilePath` / `idePath` hacia ingest.
- [x] Documentación: `services/ingest/README.md` (decisiones Fase 6), `src/chat/README.md`, `Plan_Implementacion_Fase6_AnalyticsService.md`, script `scripts/qa-fase6-analytics.sh` / `QA_Fase6_Resultado.md`.
- [x] Vitest `analytics.service.spec.ts` (resolución y delegación).
- [x] Jobs incrementales: `GET /projects/:projectId/jobs/:jobId/analysis` (`JobAnalysisService.analyzeJobForProject` + Vitest `job-analysis.service.spec.ts`).

---

## 7. Pruebas y validación

- Unit: specs portados deben pasar en CI de Ariadne.
- Integración: multi-root, inferencia de alcance, `get_modification_plan` con `currentFilePath`.
- Regresión: `internal-*`, embedding spaces.
- Grafo: consultas con `StorybookDoc` / `MarkdownDoc` tras Fase 4.

---

## 8. Entregables

- Ramas sugeridas: `feature/motor-ingest-*` (evitar nombres que sugieran otro producto).
- PRs internos; notas de migración para ops.
- Este plan y `CHANGELOG.md` actualizados.

---

## 9. Referencias solo dentro de Ariadne

| Recurso | Ubicación |
|---------|-----------|
| Historial de cambios | `CHANGELOG.md` (raíz) |
| Paridad / contexto arquitectónico | `docs/comparativa/` (documentos ya existentes en este repo) |
| Analytics multi-root | `docs/comparativa/Plan_Implementacion_Fase6_AnalyticsService.md` |
| Cadena TypeORM ingest (Fase 0) | `docs/comparativa/MIGRACIONES_CADENA_ARIADNE.md` |

---

*Siguiente paso sugerido: ampliar embeddings/coverage, UI que use `GET /projects/.../jobs/.../analysis` si aplica, u otras mejoras de producto.*
