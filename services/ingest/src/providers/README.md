# Providers (ingest)

- **github.service.ts** / **bitbucket/bitbucket.service.ts** — Listado de archivos y contenido; el filtro de paths indexables es **`shouldSyncIndexPath`** en **`sync-path-filter.ts`** (código, `.md`, MDX Storybook, `.prisma`, `.mjs`/`.cjs`, JSON Strapi acotado).
- **git-clone.provider.ts** — Walk del clone shallow con el mismo criterio.
- **sync-path-filter.ts** — Fuente única de verdad para qué entra al índice.
