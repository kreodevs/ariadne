# Arquitectura C4 (DSL PlantUML)

- **`c4-dsl-generator.service.ts`** — Genera texto PlantUML C4 (niveles 1–3) a partir de PostgreSQL (dominios, dependencias proyecto→dominio, repos/manifest) y FalkorDB (Component, Route; diff opcional vs grafo shadow con `sessionId`).
- **`ArchitectureModule`** — Exporta el servicio para `ProjectsModule` / `ProjectsController` (`GET /projects/:id/architecture/c4`).
