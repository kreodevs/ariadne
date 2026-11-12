# Scripts

- **`qa-fase6-analytics.sh`** — QA manual del análisis multi-root (`POST /projects/:id/analyze`, `resolve-repo-for-path`). Ver [docs/comparativa/QA_Fase6_Resultado.md](../docs/comparativa/QA_Fase6_Resultado.md).
- Otros utilitarios locales (`run-local.js`, `colima-stop.js`, `ensure-docker.js`) según el propio repo.
- **`link.mjs`** — **Generado**, no editar. Bundle de `services/mcp-ariadne/src/cli.ts` (esbuild) que ejecuta `npx github:kreodevs/ariadne link` sin compilar. Regenerar: `pnpm run build:link`; verificar: `pnpm run check:link` (también en CI y antes de publicar).
