# Contributing to Ariadne (AriadneSpecs)

Thank you for helping improve Ariadne. This document explains **license**, **style**, **JSDoc**, **how to run the stack**, and **how to propose changes**.

## License and copyright

- By contributing, you agree your contributions are licensed under the **Apache License 2.0**, the same as the rest of the project ([`LICENSE`](LICENSE), [`NOTICE`](NOTICE)).
- Add yourself to [`AUTHORS.md`](AUTHORS.md) under **Contributors** when you make a substantive, copyrightable contribution (code, substantial docs, or creative assets), unless you prefer not to be listed.
- For **new source files**, include a file header as described in [`docs/JSDOC.md`](docs/JSDOC.md) (`@fileoverview`, `@copyright`, `@license`).

## Code of conduct

Be respectful and assume good intent. Prefer technical arguments over tone.

## Architecture snapshot (read before large changes)

- **ingest** (NestJS, port 3002): repositories, sync/BullMQ, webhooks, chat/NL→Cypher, analysis, Falkor writes, Prisma/OpenAPI ingestion paths.
- **api** (NestJS, port 3000): graph endpoints, OTP auth, reverse proxy to ingest for selected routes.
- **orchestrator** (NestJS + LangGraph, port 3001): SDD / legacy coordination as documented in repo docs.
- **mcp-ariadne**: MCP server for IDEs (tools over HTTP + Falkor/ingest).
- **frontend**: React + Vite SPA.
- **Infra**: Postgres, Redis, FalkorDB (see root `README.md` and `docker-compose*.yml`).

Deep dives: [`docs/notebooklm/architecture.md`](docs/notebooklm/architecture.md) and linked docs from the root [`README.md`](README.md).

## Development setup

1. **Node** ≥ 20, **pnpm** (see root `package.json` scripts).
2. Infra: `pnpm run dev:infra` (Docker / Colima as documented in `README.md`).
3. Run services in separate terminals: `pnpm run dev:ingest`, `pnpm run dev:api`, `pnpm run dev:orchestrator`, `pnpm run dev:front`.

Tests:

- `pnpm run test:ingest`
- `pnpm run test:frontend:unit`

## JSDoc and documentation

- Follow [`docs/JSDOC.md`](docs/JSDOC.md) for tags and examples.
- **Public APIs** (exported functions, controllers, MCP tool handlers): document parameters, return shape, and thrown errors.
- **Do not** remove existing `@fileoverview` blocks; extend them when behavior changes.

## Git workflow

1. Branch from `main` (or the agreed default branch): `feat/…`, `fix/…`, `docs/…`.
2. Small, reviewable commits with messages in **English or Spanish** (pick one per repo convention; default: clear imperative in English is fine).
3. Open a PR describing **motivation**, **what changed**, **how to test**, and **risk** (DB migrations, Falkor compatibility, breaking API).

## Database and migrations

- **ingest** uses TypeORM migrations under `services/ingest/src/migrations/`. If you change entities, add a migration and document upgrade steps in the PR body.

## Security

- Do not commit secrets. Use `.env` / deployment secrets only.
- Report security issues privately to the maintainers (email in [`AUTHORS.md`](AUTHORS.md)) until a public advisory is agreed.

## Questions

- Open a discussion or issue on GitHub (once published), or contact the primary author listed in [`AUTHORS.md`](AUTHORS.md).
