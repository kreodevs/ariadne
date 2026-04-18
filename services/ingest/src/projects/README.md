# Módulo `projects`

CRUD de proyectos Ariadne (multi-root) y utilidades relacionadas. Tabla `project_repositories` incluye columna opcional **`role`** (varchar) tras migración `1743200000000`; ver cadena en `docs/comparativa/MIGRACIONES_CADENA_ARIADNE.md`.

- **`projects.controller.ts`** — REST bajo `/projects`.
- **`projects.service.ts`** — Persistencia y operaciones (p. ej. regenerar ID, enrutamiento Falkor).
- **`path-repo-resolution.util.ts`** — Heurística para mapear una ruta absoluta del IDE al `repository.id` dentro del proyecto (`projectKey` / `repoSlug` en la ruta). Incluye `resolveRepositoryIdForWorkspacePath` → resultado `unique` | `none` | `ambiguous` (empates).

Endpoint de resolución: `GET /projects/:id/resolve-repo-for-path?path=<ruta absoluta o relativa>`. **`ProjectsService.resolveRepositoryForWorkspacePath`** usa la variante discriminada para el plan de modificación y el **preflight** del chat multi-root.

- **`getRepositoryRolesContext(projectId)`** — Texto markdown de repos + roles para inyectar en el sintetizador del chat por proyecto.

## Gobierno de arquitectura (dominios + Falkor)

- **`domainId`** opcional en proyecto (`ProjectEntity`) — pertenencia a un dominio lógico (color/nombre en UI, PlantUML).
- **`getCypherShardContexts(projectId, { includeSiblingProjects? })`** — Pares `{ graphName, cypherProjectId }` para el proyecto actual **y** para otros proyectos cuyo `domainId` está en la whitelist (`ProjectDomainDependency`). Usado por **`ChatCypherService.executeCypher`**, resúmenes de grafo y documentación de MCP.
- **`getGraphRouting(projectId)`** — Expone `shardMode`, `domainSegments`, `extendedGraphShardNames` (solo grafos ajenos al proyecto), **`cypherShardContexts`** (lista completa para consultas).
- **REST:** `GET/PATCH /projects/:id`, `GET :id/architecture/c4?level=1|2|3&sessionId=`, `GET|POST :id/domain-dependencies`, `GET :id/graph-routing`. Ver módulo `../domains/`.
