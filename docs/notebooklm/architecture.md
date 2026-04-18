**Versión:** 1.1

**Estado:** Definición de Sistema (en transición hacia stack objetivo)

**Core Engine:** FalkorDB + Tree-sitter + MCP

## 1. Resumen Ejecutivo

La arquitectura de **AriadneSpecs** se basa en la separación de preocupaciones entre la **Ingesta Estática** y la **Consulta de Contexto** (Oracle MCP). El objetivo central es que la base de datos de grafos actúe como una memoria de corto y largo plazo que valide cada intención de código antes de su ejecución.

## 2. Stack objetivo

| Capa | Tecnología | Notas |
|------|------------|--------|
| **Framework backend** | NestJS | Servicios que exponen API o lógica de negocio. |
| **ORM / persistencia relacional** | TypeORM | Entidades, migraciones y consultas sobre PostgreSQL. |
| **Base de datos relacional** | PostgreSQL | Repos, jobs de ingesta, metadatos, auditoría. |
| **Grafo** | FalkorDB | Topología/dependencias; alimentado por el microservicio de ingesta. |
| **Cola / caché** | Redis | Estados, caché, colas entre microservicios. |

Cada servicio es una aplicación NestJS desplegable de forma independiente. Comunicación REST/HTTP; Redis para caché o colas cuando haga falta.

## 3. Modelo de ingesta objetivo (repositorio + webhook)

- **Fuente de verdad:** Repositorio remoto (Bitbucket o GitHub), no directorio local montado.
- **Estrategia por capas:**
  1. **Fase Mapping:** Escaneo del repo (árbol de directorios, detección de lenguajes).
  2. **Fase Deps:** Lectura de `package.json`, `requirements.txt`, `go.mod` para contexto de librerías.
  3. **Fase Chunking semántico:** Parser Tree-sitter por unidades lógicas (funciones, clases) con metadata `line_range` y `commit_sha`.
- **Cola de mensajes:** Redis/BullMQ. `POST /repositories/:id/sync` encola el job; un worker lo procesa de forma asíncrona.
- **Full sync:** Shallow clone opcional (`git clone --depth 1`) o API (Bitbucket/GitHub). Se filtran `node_modules`, `dist`, `venv`, `.env`, `*.log`; pipeline: parse → producer Cypher → FalkorDB; estado en PostgreSQL (repos, sync_jobs, indexed_files).
- **Incremental:** Webhook (Bitbucket push) llama a `POST /webhooks/bitbucket`; diff por commit; archivos borrados se eliminan del grafo (orphan cleanup).
- **Webhook bridge:** Se persiste `lastCommitSha` tras cada sync; permite diff entre SHA conocido y nuevo para indexar solo cambios.
- **Proveedores:** Bitbucket (API REST 2.0), GitHub (API REST v3). Alternativa: shallow clone vía `runShallowClone()`.
- **Credenciales:** Tokens y secrets en BD cifrados (AES-256-GCM) o variables de entorno. Tabla `credentials`; `repositories.credentialsRef` apunta a la credencial. Clave maestra `CREDENTIALS_ENCRYPTION_KEY`.

## 4. Componentes del Sistema

### A. Microservicio de Ingesta (evolución del Cartographer)

Servicio NestJS que realiza el análisis estático a partir de repositorios remotos. Incluye **Chat** (NL→Cypher) y **Análisis** (diagnóstico, duplicados, reingeniería).

- **Chat:** `POST /repositories/:id/chat` (por repo) y `POST /projects/:projectId/chat` (por proyecto, todos los repos). Preguntas en NL → LLM genera Cypher → FalkorDB. Intent detection (project overview, diagnóstico). Retry si 0 resultados. Ver [CHAT_Y_ANALISIS.md](CHAT_Y_ANALISIS.md).
- **Análisis:** `POST /repositories/:id/analyze` (`:id` = repo) — modos `diagnostico`, `duplicados`, `reingenieria`, `codigo_muerto`, `seguridad` (auditoría heurística de secretos/higiene en índice). **`POST /projects/:projectId/analyze`** — mismos modos de código con resolución de repo vía `AnalyticsService` (`idePath` / `repositoryId` en multi-root) o `agents` / `skill` para informes AGENTS.md / SKILL.md.
- **Proyectos (multi-root):** Tabla `project_repositories` (repo_id, project_id). Un repo puede estar en varios proyectos. Sync escribe nodos para cada proyecto del repo (standalone + proyectos). Resync: `POST /repositories/:id/resync` (desde repo) o `POST /repositories/:id/resync-for-project` con `{ projectId }` (solo ese slice).
- **Proceso de indexación (sin filesystem local):**
  1. **Origen:** Repositorio remoto (Bitbucket/GitHub): listado y contenido vía REST API o clone. Credenciales desde `credentialsRef` (BD) o env.
  2. **Parser (Tree-sitter):** Mismo pipeline que el Cartographer: genera AST, identifica imports, componentes, hooks, props.
  3. **Graph Producer:** Transforma en Cypher y escribe en FalkorDB (path en grafo prefijado por repo para multi-repo).
- **Frecuencia:** Full sync bajo demanda; incremental vía webhook en cada push.
- **Cartographer legacy:** El servicio actual en `services/cartographer` que usa **chokidar** y **SCAN_PATH** está marcado como legacy. Puede mantenerse reducido a **shadow server** (solo `POST /shadow`) para el flujo SDD mientras el microservicio de ingesta asume full sync + webhook.

### B. FalkorDB (Cerebro de Grafos)

Instancia de base de datos de grafos en memoria que almacena la topología del sistema.

- **Multi-proyecto / multi-root:** El grafo soporta proyectos (entidad Ariadne con UUID) y repos (roots). Tabla `project_repositories`: un repo puede estar en varios proyectos. Nodos con `projectId` y `repoId`; unicidad por (projectId, repoId, path) donde aplique. `(Project)-[:CONTAINS]->(File)`; **Context** (`createContext`) y **Hook** (custom hooks definidos en archivo) con `File -[:CONTAINS]-> Context` y `File -[:CONTAINS]-> Hook`. DomainConcept con `category: 'context'` para contextos.
- **Estructura de Datos:** Matrices dispersas para resolución rápida de caminos de dependencia.
- **Persistencia:** Snapshots en disco para asegurar que el índice sobreviva a reinicios del sistema.

### C. Oracle MCP Server (El Interfaz)

Servidor que implementa el **Model Context Protocol** para exponer las herramientas de AriadneSpecs a la IA.

- **Seguridad:** Capa de abstracción que impide a la IA ejecutar queries destructivas.
- **Enriquecimiento:** No solo entrega nodos del grafo, sino que formatea la respuesta en Markdown estructurado para que la IA lo consuma fácilmente.

---

## 5. Flujo de Datos Detallado

1. **Fase de Mapeo (Escritura):**
   - Microservicio de Ingesta (o Cartographer legacy) → Tree-sitter (extrae imports, componentes, etc.) → FalkorDB (MERGE nodos y relaciones).
2. **Fase de Razonamiento (Lectura):**
   - `IA (Cursor/Claude)` -> `MCP Tool (get_legacy_impact)` -> `Oracle Server` -> `FalkorDB` (Query Cypher).
3. **Fase de Validación (Ciclo SDD):**
   - `IA` propone código → Orquestador ejecuta flujo (impacto, contratos, opcional weaver) → **Shadow Indexing**: Cartographer expone `POST /shadow` con `{ files: [{ path, content }] }` para indexar en grafo `AriadneSpecsShadow`; API expone `GET /graph/compare/:componentName` para comparar main vs shadow → `IA` recibe veredicto (approved, missingInShadow, extraInShadow) y confirma o corrige.

---

## 6. Stack de Comunicación y Red

- **API REST (OpenAPI 3.1):** Servicio `api` expone `GET /graph/impact/:nodeId`, `GET /graph/component/:name`, `GET /graph/contract/:componentName`, `GET /graph/compare/:componentName`, `POST /graph/shadow`. Caché y estados en **Redis** (claves por recurso, TTL coherente).
- **Orquestador (NestJS + LangGraph):** Flujo de validación SDD: `validate_impact` → `fetch_contracts` → `compare_contracts`; opcionalmente weaver, shadow index y compare graphs. Endpoints: `GET /workflow/refactor/:nodeId`, `POST /workflow/refactor/validate`, `POST /workflow/refactor/full`. Persistencia de estado por sesión en Redis (módulo `RedisStateService`) para trazabilidad.
- **Inter-agente:** Redis se usa para caché de fragmentos y estados de agentes.
- **IA a Sistema:** El protocolo MCP utiliza **Streamable HTTP** (puerto 8080) para integración remota o local.

---

## 7. Diagrama de Entidad-Relación (Lógico)

Para **AriadneSpecs**, el modelo relacional es el siguiente:

- **PROJECT** --(CONTAINS)--> **FILE** (nodo raíz: `projectId`, `projectName`, `rootPath`, `lastIndexed`, `manifestDeps`; nodos con `repoId` además de `projectId`)
- **FILE** --(CONTAINS)--> **COMPONENT** | **CONTEXT** (createContext) | **HOOK** (custom hooks definidos en archivo)
- **COMPONENT** --(USES_HOOK)--> **HOOK**
- **COMPONENT** --(RENDERS)--> **COMPONENT**
- **FILE** --(IMPORTS)--> **FILE**
- **FUNCTION** --(CALLS)--> **FUNCTION**
- **DomainConcept** con `category: 'context'` para contextos

---

## 8. Credenciales (PostgreSQL)

Tabla `credentials`: tokens y secrets cifrados con AES-256-GCM. Tipos: `token`, `app_password`, `webhook_secret`. Cada repositorio puede referenciar una credencial (`credentialsRef`). Si no hay referencia, se usan variables de entorno. Ver [manual/CONFIGURACION_Y_USO.md](manual/CONFIGURACION_Y_USO.md).

## 9. Consideraciones de Escalabilidad

- **Pruning (Poda):** El pipeline ignora `node_modules`, `dist`, `build`, `coverage`, `venv`, `.venv`, `__pycache__`, `*.log`, `.env` para mantener el grafo ligero.
- **Memory Management:** Dado que FalkorDB es en memoria, se establece un límite de 100,000 nodos por instancia para asegurar tiempos de respuesta sub-10ms.
