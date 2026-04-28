# Arquitectura C4 (DSL PlantUML)

- **`c4-dsl-generator.service.ts`** — Genera texto PlantUML C4 (niveles 1–3) a partir de PostgreSQL (dominios, dependencias proyecto→dominio, repos/manifest) y FalkorDB (Component, Route; diff opcional vs grafo shadow con `sessionId`).
- **`kroki-proxy.service.ts`** — POST del DSL a Kroki (`KROKI_URL`, default `https://kroki.io`) y devuelve SVG; usado por `POST /projects/:id/architecture/c4/render-svg` para que el **frontend no llame a Kroki desde el navegador** (evita `NetworkError`/CORS).
- **`ArchitectureModule`** — Exporta generador + proxy para `ProjectsModule` / `ProjectsController` (`GET /projects/:id/architecture/c4`, `POST .../render-svg`).
