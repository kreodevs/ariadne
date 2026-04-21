# Providers (ingest)

- **github.service.ts** / **bitbucket/bitbucket.service.ts** — Listado de archivos y contenido; el filtro de paths indexables es **`shouldSyncIndexPath`** en **`sync-path-filter.ts`** (código, `.md`, MDX Storybook, `.prisma`, `.mjs`/`.cjs`, JSON Strapi acotado, más **`package.json`**, **`openapi.json`** / **`swagger.json`** / **`openapi.ya?ml`** en cualquier carpeta del repo).
- **git-clone.provider.ts** — Walk del clone shallow con el mismo criterio.
- **sync-path-filter.ts** — Fuente única de verdad para qué entra al índice. Omite por defecto carpetas e2e/playwright/cypress/`__tests__`/etc. y archivos `*.e2e.*`; **`INDEX_E2E=1`** las incluye (análogo a `INDEX_TESTS` para `*.spec.*`). Omite **`.../migrations/`** (p. ej. TypeORM); **`INDEX_MIGRATIONS=1`** la incluye. Vitest: `sync-path-filter.spec.ts`.
