# Tests en Ariadne

## Ingest (`services/ingest`)

- **Framework:** Vitest (`npm test` / `npm run test:watch`).
- **Incluye:** chat (scope, modification-plan, analytics, job-analysis), **`sync-path-filter`** (e2e / `INDEX_E2E`), etc.
- **Variables útiles en tests de filtro:** `INDEX_TESTS`, `INDEX_E2E` (ver `src/providers/sync-path-filter.spec.ts`).

## Frontend (`frontend`)

- **Unitario:** Vitest — `pnpm run test:unit` (o `npm run test:unit` tras instalar deps).
  - Ejemplo: `src/pages/RepoDetail/utils.spec.ts` (`formatJobPayload`).
- **E2E:** Playwright — `pnpm exec playwright install chromium` (primera vez) y `pnpm run test:e2e`.
  - Arranca Vite con **`VITE_E2E_AUTH_BYPASS=true`** (solo pruebas; ver `ProtectedRoute`).
  - Los smoke mockean `GET /api/projects` y `GET /api/repositories` para no depender del API real.

## MCP (`services/mcp-ariadne`)

- Build TypeScript como verificación mínima; no hay Vitest dedicado en este paquete.

## CI

- `.github/workflows/ci-ingest-mcp.yml` — Vitest ingest + build MCP.
- `.github/workflows/ci-frontend.yml` — Vitest frontend + Playwright (Chromium).

## Raíz del monorepo

Opcional: `pnpm -C services/ingest test && pnpm -C frontend test:unit` (añadir script en `package.json` raíz si lo usáis a menudo).
