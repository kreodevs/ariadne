# Módulo `projects`

CRUD de proyectos Ariadne (multi-root) y utilidades relacionadas. Tabla `project_repositories` incluye columna opcional **`role`** (varchar) tras migración `1743200000000`; ver cadena en `docs/comparativa/MIGRACIONES_CADENA_ARIADNE.md`.

- **`projects.controller.ts`** — REST bajo `/projects`.
- **`projects.service.ts`** — Persistencia y operaciones (p. ej. regenerar ID, enrutamiento Falkor).
- **`path-repo-resolution.util.ts`** — Heurística para mapear una ruta absoluta del IDE al `repository.id` dentro del proyecto (`projectKey` / `repoSlug` en la ruta). Incluye `resolveRepositoryIdForWorkspacePath` → resultado `unique` | `none` | `ambiguous` (empates).

Endpoint de resolución: `GET /projects/:id/resolve-repo-for-path?path=<ruta absoluta o relativa>`. **`ProjectsService.resolveRepositoryForWorkspacePath`** usa la variante discriminada para el plan de modificación y el **preflight** del chat multi-root.

- **`getRepositoryRolesContext(projectId)`** — Texto markdown de repos + roles para inyectar en el sintetizador del chat por proyecto.
