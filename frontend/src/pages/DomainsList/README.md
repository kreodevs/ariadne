# DomainsList

- **`DomainsList.tsx`** — Lista de dominios con recuento de proyectos (`assignedProjectCount` desde `GET /domains`), modal para ver proyectos asignados (`GET /domains/:id/projects`), y modal para aristas de visibilidad dominio→dominio (`GET|POST|DELETE /domains/:id/visibility`) usadas por `getCypherShardContexts` y el C4 agregado.
