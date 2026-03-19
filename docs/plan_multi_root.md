# Plan de implementación: Proyectos multi-root (multi-root projects)

## Objetivo

Permitir que un **proyecto** Ariadne agrupe varios repositorios (multi-root): por ejemplo front y back indexados bajo un mismo `projectId`. Una sola unidad de búsqueda, chat, planes de modificación y análisis; el sistema y el MCP deben poder distinguir qué cambios afectan a un repo, a otro o a ambos.

---

## Estado actual

- **Repositorio** (Postgres): una fila por repo Bitbucket/GitHub. `id` (UUID) se usa como `projectId` en FalkorDB.
- **Grafo**: nodos `File`, `Component`, `Function`, etc. tienen `projectId`; relación `(Project)-[:CONTAINS]->(File)`. Path en el grafo = prefijo `{repoSlug}/` + path relativo al repo (ej. `my-app/src/App.tsx`).
- **Sync**: un job por repo; al hacer full sync se borran solo los nodos de ese repo (por `projectId` + path con prefijo) y se reindexa.
- **Chat, análisis, modification-plan**: trabajan por `repositoryId`; internamente `projectId = repo.id`. No existe el concepto de “proyecto” con varios repos.

---

## Modelo objetivo

- **Proyecto (Project)**: entidad que agrupa uno o más repositorios. Un solo `projectId` en el grafo para todo el proyecto.
- **Repositorio (Repository)**: sigue siendo un repo Bitbucket/GitHub; tiene `projectId` (FK a Project). Si `projectId = null` (compatibilidad), se considera proyecto 1:1: proyecto implícito = repo (comportamiento actual).
- **Grafo**: todos los nodos que hoy tienen `projectId` pasan a tener también **`repoId`** (UUID del repositorio del que viene el archivo). Path sigue siendo **relativo al repo** (ej. `src/App.tsx`), no prefijo global. Unicidad: `(projectId, repoId, path)` para `File`; análogo donde aplique.
- **Búsquedas y planes**: por `projectId` (todo el proyecto). Las respuestas que incluyen archivos devuelven **`repoId`** (y opcionalmente slug/nombre del repo) para que el MCP y la UI sepan “solo front”, “solo back” o “front y back”.

---

## Implicaciones por capa

### 1. Modelo de datos (Postgres)

| Cambio | Descripción |
|--------|-------------|
| Nueva tabla `projects` | `id` (UUID PK), `name` (opcional), `created_at`, `updated_at`. |
| `repositories` | Añadir `project_id` (UUID, nullable, FK a `projects.id`). |
| Migración | Crear `projects`; por cada repo existente crear una fila en `projects` con `id = repo.id` y `name = projectKey/repoSlug`; actualizar `repositories.project_id = repo.id`. Así todo repo actual es “proyecto de un solo root”. |
| Creación de proyectos nuevos | Al “crear proyecto” o “añadir primer repo”: crear `Project` y asignar `repo.project_id = project.id`. Al “añadir repo a proyecto”: elegir proyecto existente y asignar `repo.project_id = project_id`. |

### 2. Grafo FalkorDB (nodos y Cypher)

| Cambio | Descripción |
|--------|-------------|
| `repoId` en nodos | Añadir propiedad `repoId` a todos los nodos que hoy tienen `projectId` y que están asociados a un archivo/repo: `File`, `Function`, `Component`, `Route`, `Model`, `NestModule`, `NestController`, `NestService`, `StrapiContentType`, `StrapiController`, `StrapiService`, `DomainConcept`, `Prop`, `Hook` (cuando se asocian a un Component de un File). Relaciones no llevan repoId; se infiere por el nodo File/Component/Function. |
| Unicidad | `File`: clave lógica `(projectId, repoId, path)`. Path **sin** prefijo de repo (path relativo al repo). Mismo criterio para nodos que tienen path (Function, etc.). |
| Nodo `Project` | Un nodo `:Project` por proyecto (no por repo). `projectId` = `Project.id`. Opcional: propiedad `rootPaths` o lista de `repoId` para referencia. No duplicar nodo Project por cada repo. |
| Índices | Añadir índices compuestos donde sea necesario, por ejemplo `(projectId, repoId)` en `File` y en `Function` para borrados y filtros por repo. |
| Borrado en sync | Al hacer full sync de un repo: borrar solo nodos con `projectId = project.id` **y** `repoId = repo.id` (no borrar nodos de otros roots del mismo proyecto). `buildCypherDeleteFile(path, projectId)` → `buildCypherDeleteFile(path, projectId, repoId)`. |
| MERGE / CREATE | Todo el pipeline de ingest (producer, ingest pipeline) debe recibir `projectId` (del proyecto) y `repoId` (del repo que se está indexando) y generar Cypher con ambos en cada MERGE. |

### 3. Ingest (sync, pipeline, webhooks)

| Cambio | Descripción |
|--------|-------------|
| projectId en sync | En sync (full e incremental): `projectId = repo.project_id ?? repo.id` (si no hay proyecto, proyecto implícito = repo). `repoId = repo.id` siempre. |
| Path en grafo | Dejar de usar prefijo `repoSlug/` en el path del grafo; usar path relativo al repo (ej. `src/App.tsx`). Así path es único por `(projectId, repoId, path)`. El prefijo “qué repo es” se resuelve con `repoId`. |
| buildCypherForFile / producer | Firmas y llamadas: pasar `projectId` y `repoId`; todas las sentencias MERGE deben incluir `repoId` en los nodos. |
| buildProjectMergeCypher | Llamar una vez por proyecto (no por repo). Puede invocarse en el primer sync de cualquier root del proyecto; MERGE (p:Project {projectId}) SET p.projectName = …, p.lastIndexed = … (sin rootPath único; opcional guardar lista de repoIds o nombres). |
| buildCypherDeleteFile | Añadir parámetro `repoId`; en todas las sentencias MATCH/DELETE filtrar por `projectId` y `repoId`. |
| Webhooks | Push a un repo solo dispara sync de ese repo; al escribir en el grafo usar `projectId = repo.project_id` y `repoId = repo.id`. Borrar solo archivos de ese `repoId`. |
| FileContentService | Sigue recibiendo `repositoryId` y `path` (relativo al repo). No cambia la firma; el consumidor ya tiene el repo. |
| getModificationPlan | Recibir `projectId` (o repositoryId y resolver projectId desde repo.project_id). Consultas Cypher con `projectId` (y opcionalmente filtrar por repoId). Respuesta: `filesToModify` como `Array<{ path: string; repoId: string }>` (o incluir repoSlug para UI). Verificar paths contra `MATCH (f:File) WHERE f.projectId = $projectId RETURN f.path, f.repoId`. |
| Chat / análisis por proyecto | Nuevos endpoints o parámetros que acepten `projectId`: por ejemplo `POST /projects/:projectId/chat`, `POST /projects/:projectId/analyze`. O mantener `POST /repositories/:id/...` y añadir `GET/POST /projects/:projectId/...` que operen sobre todos los roots. Internamente: todas las Cypher con `projectId`; resultados pueden agruparse por `repoId` para presentación. |

### 4. API (BFF) y rutas

| Cambio | Descripción |
|--------|-------------|
| Proyectos | `GET /projects` (lista de proyectos con sus repos). `GET /projects/:id` (detalle + repos del proyecto). `POST /projects` (crear proyecto; opcionalmente con primer repo). `PATCH /projects/:id` (nombre). No eliminar proyecto si tiene repos (o cascada según política). |
| Repositorios | `POST /repositories` con opción `projectId` (añadir a proyecto existente) o sin él (crear proyecto nuevo 1:1). `PATCH /repositories/:id` permitir `projectId` (mover repo a otro proyecto). `GET /repositories?projectId=` para filtrar por proyecto. |
| Proxy ingest | El BFF debe exponer rutas de proyectos si el ingest las implementa (ej. `/api/projects/:projectId/chat`) o seguir pasando `repositoryId` y que el ingest resuelva `projectId` desde el repo. Decisión: ingest puede exponer tanto `repositories/:id/...` (comportamiento actual, projectId = repo.project_id ?? repo.id) como `projects/:projectId/...` para chat/analyze/modification-plan a nivel proyecto. |

### 5. Frontend

| Cambio | Descripción |
|--------|-------------|
| Listado | Opción A: seguir listando “Repositorios” y agrupar por proyecto (agrupación visual). Opción B: listar “Proyectos” como primera entidad; al abrir un proyecto se ven sus N repos (roots). Recomendación: B para reflejar el modelo multi-root. |
| Crear proyecto / añadir repo | “Crear proyecto” → nombre opcional → “Añadir primer repositorio” (flujo igual que crear repo actual, pero creando Project y asignando repo al proyecto). En proyecto existente: botón “Añadir otro repo a este proyecto” que abre flujo de alta de repo con `projectId` preseleccionado. |
| Detalle de proyecto | Página “Proyecto” con: nombre, lista de repos (con sync, estado, último sync), acciones: Chat (proyecto), Análisis (proyecto o por repo), Índice (grafo del proyecto), Plan de modificación. Si hay un solo repo, puede mostrarse como hoy con atajos al repo. |
| Chat / análisis | En la vista de proyecto: selector “Todo el proyecto” vs “Solo [repo X]” para análisis (diagnóstico, duplicados, etc.). Chat técnico a nivel proyecto (todo el contexto). Plan de modificación: resultados con archivos agrupados por repo (“Frontend: file1, file2; Backend: file3”). |
| Credenciales | Sin cambio: cada repo tiene su `credentialsRef`. |

### 6. MCP (FalkorSpecs Oracle)

| Cambio | Descripción |
|--------|-------------|
| list_known_projects | Debe devolver **proyectos**, no repos. Cada elemento: `id` (projectId), `name`, `roots`: `[{ id: repoId, name/slug, branch? }]`. Así la IA sabe que un proyecto puede tener varios roots. |
| get_modification_plan | `POST /projects/:id/modification-plan` acepta **`id` = UUID de proyecto Ariadne o UUID de repositorio** (`roots[].id`). Implementado: si el segmento es un repo conocido, el ingest ancla el plan a ese root; si es proyecto, usa el primer repo asociado (orden interno). Respuesta: `filesToModify: { path, repoId }[]`; el MCP pasa esto tal cual. |
| get_file_content | Sigue recibiendo `repositoryId` (o equivalente) y path. Si la IA solo tiene projectId + path, necesita un paso previo: por path (y projectId) resolver `repoId` (consultando el grafo `MATCH (f:File) WHERE f.projectId = $projectId AND f.path = $path RETURN f.repoId`) y luego get_file_content(repoId, path). O extender get_file_content para aceptar (projectId, path) y que el backend resuelva el repo. |
| get_component_graph / get_legacy_impact / semantic_search | Siguen filtrando por `projectId`; pueden devolver nodos de varios repos. Incluir en respuestas que tengan path el `repoId` (o slug) para que el agente sepa “este componente está en el front” vs “en el back”. |
| Inteligencia “uno vs ambos” | En la descripción de herramientas y en system prompt: indicar que las respuestas pueden incluir `repoId`/root; si un plan de modificación devuelve archivos de un solo repo, el agente puede decir “solo hay que tocar el frontend”; si hay archivos de varios repos, “hay que tocar frontend y backend”. No requiere lógica nueva en el MCP más que pasar through la información repoId/root en las respuestas. |

### 7. Análisis (diagnóstico, duplicados, reingeniería, código muerto, full audit)

| Cambio | Descripción |
|--------|-------------|
| Ámbito | Soportar dos modos: por **proyecto** (todos los roots) y por **repositorio** (un solo root). Endpoints: por ejemplo `POST /projects/:projectId/analyze?mode=diagnostico` y `POST /repositories/:id/analyze?mode=diagnostico`. Por proyecto: las Cypher ya filtran por projectId; los resultados incluyen archivos de todos los repos; en la UI (y en la respuesta) agrupar por repoId/repo slug para legibilidad. |
| Job análisis (incremental) | Hoy es por repositoryId. Se mantiene; el análisis de impacto de un job es sobre ese repo. Si en el futuro se quiere “impacto en todo el proyecto”, sería un endpoint adicional que consulte el grafo por projectId. |

### 8. Embedding / RAG

| Cambio | Descripción |
|--------|-------------|
| Índice por proyecto | Embed-index puede seguir siendo por “proyecto” (projectId): indexar todos los nodos Function/Component con ese projectId. Los vectores ya están en el grafo; al incluir repoId en los nodos, las búsquedas semánticas pueden seguir devolviendo path + repoId para que el agente sepa el root. |

### 9. Compatibilidad hacia atrás

| Aspecto | Enfoque |
|---------|---------|
| Repos sin proyecto | `repo.project_id == null` → tratar como proyecto 1:1: `projectId = repo.id`, `repoId = repo.id`. En el grafo es como hoy pero con repoId explícito. |
| Grafos ya indexados | Migración de datos en Falkor: script que, para cada nodo con projectId y sin repoId, setee `repoId = projectId` (un repo por proyecto antiguo). Así no hay que reindexar todo. |
| MCP y API antiguas | Mantener `repositories/:id/...`; si el repo pertenece a un proyecto, projectId = repo.project_id; si no, projectId = repo.id. list_known_projects puede seguir devolviendo “proyectos” donde cada proyecto es un repo cuando project_id es null (o un proyecto real cuando hay varios repos). |

---

## Orden sugerido de implementación

### Fase 1: Modelo y grafo (sin romper comportamiento actual)

1. **Postgres**: Crear tabla `projects` y columna `repositories.project_id`; migración de backfill (cada repo → project con id = repo.id, project_id = repo.id).
2. **Ingest pipeline (producer)**: Añadir `repoId` a todas las sentencias Cypher (buildCypherForFile, buildProjectMergeCypher, buildCypherDeleteFile). En sync: pasar `projectId = repo.project_id ?? repo.id` y `repoId = repo.id`; path en grafo **sin** prefijo repoSlug (path relativo al repo).
3. **Falkor**: Migración opcional para nodos existentes (setear repoId = projectId donde repoId falte). Crear índices (projectId, repoId) donde convenga.
4. **Sync / webhooks**: Ajustar borrado y MERGE para usar projectId + repoId; un solo nodo Project por projectId (no uno por repo).

### Fase 2: API y lógica de proyecto

5. **Ingest**: Endpoints o parámetros por proyecto: `GET /projects`, `GET /projects/:id`, `POST /projects`, y opcionalmente `POST /projects/:projectId/chat`, `POST /projects/:projectId/analyze`, `POST /projects/:projectId/modification-plan`. getModificationPlan: aceptar projectId o repositoryId; respuesta con `{ path, repoId }[]`.
6. **API BFF**: Exponer `/api/projects` y proxy de rutas de proyecto al ingest. Repos: crear/actualizar con `projectId`; listar con filtro por proyecto.

### Fase 3: Frontend

7. **Vistas**: Lista de proyectos; detalle de proyecto con lista de repos; “Añadir otro repo a este proyecto”. Chat y análisis en contexto de proyecto (selector “todo el proyecto” / “solo este repo” si aplica).
8. **Planes de modificación**: Mostrar archivos agrupados por repo (Frontend / Backend).

### Fase 4: MCP y documentación

9. **MCP**: list_known_projects con estructura de proyectos y roots; get_modification_plan devolviendo repoId por archivo; get_file_content por repoId (o resolución projectId+path → repoId); documentar en specs que las respuestas pueden indicar “solo un root” vs “varios roots”.
10. **Docs**: Actualizar db_schema (nodos con repoId), mcp_server_specs, y README de ingest con el modelo multi-root.

---

## Resumen de decisiones clave

| Tema | Decisión |
|------|----------|
| Path en grafo | Relativo al repo (sin prefijo); identificación de root vía `repoId`. |
| Unicidad | (projectId, repoId, path) para File y nodos con path. |
| Proyecto 1:1 | Repos sin project_id: projectId = repo.id, repoId = repo.id (comportamiento actual con repoId explícito). |
| Plan de modificación | Respuesta incluye repoId (y opcionalmente slug) por archivo para que MCP/UI distingan “solo front” vs “front y back”. |
| Análisis | Soportar ámbito “proyecto” (todos los roots) y “repositorio” (un root); agrupar resultados por repo cuando sea útil. |

Este plan permite indexar front y back en el mismo proyecto, un solo projectId para búsquedas y planes, y que el MCP y la UI sean conscientes de qué root(s) se ven afectados en cada respuesta.

---

## Estado de implementación

**Fase 1 (hecha):**
- Postgres: tabla `projects`, `repositories.project_id`, migración `1739180500000-ProjectsAndRepositoryProjectId` con backfill (un proyecto por repo existente).
- Entidad `ProjectEntity`; `RepositoryEntity` con `projectId` y relación a `Project`.
- Pipeline: `buildCypherForFile(..., projectId, repoId, context)` y `buildCypherDeleteFile(relativePath, projectId, repoId)`; todos los nodos del grafo incluyen `repoId`.
- Sync: paths relativos al repo (sin prefijo); `projectId = repo.projectId ?? repo.id`, `repoId = repo.id`; un nodo `Project` por proyecto.
- Webhooks: mismo criterio projectId/repoId y path relativo.
- Chat: usa `projectId = repo.projectId ?? repo.id` para consultas (todo el proyecto).
- Shadow: pasa `repoId = SHADOW_PROJECT_ID` en `buildCypherForFile`.

**Fase 2 (hecha):** getModificationPlan devuelve `filesToModify: Array<{ path, repoId }>`. Projects CRUD en ingest (GET/POST/PATCH/DELETE /projects). Repos create/update con projectId; findAll(projectId?). API BFF proxy /api/projects. ProjectChatController: POST /projects/:projectId/modification-plan.

**Fase 3 (hecha):** Frontend: ProjectList (/), ProjectDetail (/projects/:id), CreateRepo con ?projectId= para "Añadir otro repo". Nav: Proyectos, Repositorios, + Nuevo repo, Credenciales, Ayuda.

**Fase 4 (hecha):** MCP list_known_projects devuelve proyectos con `roots: [{ id, name, branch? }]` (desde GET /projects). get_modification_plan llama a POST /projects/:projectId/modification-plan y devuelve filesToModify con path y repoId. Docs: db_schema (repoId en File), mcp_server_specs actualizado.

**Migración Falkor (hecha):** Backfill `repoId` al arranque del ingest: `runFalkorRepoIdBackfill` en `pipeline/producer.ts` hace `SET n.repoId = n.projectId` para nodos con `projectId` y sin `repoId` (etiquetas File, Component, Function, Route, Model, Nest*, Strapi*, DomainConcept, Prop, Hook). Idempotente; si Falkor no está disponible al arranque, se registra aviso y la app sigue (no bloquea).

---

## Resync: desde el repo vs desde el proyecto

Hay dos formas de hacer **resync** (borrar índice y volver a indexar) de un mismo repositorio; se diferencian en **qué ámbito del grafo se borra** y **qué se reindexa**.

| Origen | Endpoint / UI | Qué borra | Qué reindexa |
|--------|----------------|-----------|--------------|
| **Desde el repositorio** | Detalle del repo → “Resync” (o `POST /repositories/:id/resync`) | Solo el **ámbito standalone** del repo: nodos con `projectId = repoId` y registros en `indexed_file` de ese repo. | **Todo**: standalone (`repoId`) + **cada proyecto Ariadne** que contenga ese repo. Es decir, full sync normal. |
| **Desde el proyecto** | Detalle del proyecto → tabla de repos → “Resync (proyecto)” (o `POST /repositories/:id/resync-for-project` con `body: { projectId }`) | Solo el **slice (projectId, repoId)** de ese proyecto: nodos con ese `projectId` **y** ese `repoId`. No toca standalone ni otros proyectos. | Solo ese **proyecto** para ese repo: reindexa únicamente el ámbito `(projectId, repoId)`. |

### Cuándo usar cada uno

- **Resync desde el repo**  
  Úsalo cuando quieras “empezar de cero” o refrescar **todo** lo que depende de ese repo: el índice en solitario (chat/índice por repo) y **todos** los proyectos en los que participa. Ejemplos: cambiaste de rama por defecto, añadiste muchos archivos, crees que el índice está corrupto o desfasado en todos los ámbitos.

- **Resync desde el proyecto**  
  Úsalo cuando solo te interese refrescar la vista de **ese repo dentro de un proyecto concreto**, sin tocar el resto. Ejemplos: acabas de **asociar** el repo al proyecto y quieres que el proyecto vea el código ya indexado; o quieres forzar que solo ese (proyecto, repo) se vuelva a indexar sin afectar al repo en solitario ni a otros proyectos que usen el mismo repo.
