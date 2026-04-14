# Módulo `projects`

CRUD de proyectos Ariadne (multi-root) y utilidades relacionadas.

- **`projects.controller.ts`** — REST bajo `/projects`.
- **`projects.service.ts`** — Persistencia y operaciones (p. ej. regenerar ID, enrutamiento Falkor).
- **`path-repo-resolution.util.ts`** — Heurística para mapear una ruta absoluta del IDE al `repository.id` correcto dentro del proyecto (`projectKey` / `repoSlug` en la ruta).

Endpoint de resolución: `GET /projects/:id/resolve-repo-for-path?path=<ruta absoluta o relativa>`.
