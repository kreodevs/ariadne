# Changelog

Todas las notas de versión de **Ariadne / FalkorSpecs** (monorepo).  
Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/).

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
