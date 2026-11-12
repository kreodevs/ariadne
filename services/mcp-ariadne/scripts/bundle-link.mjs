#!/usr/bin/env node
/**
 * @fileoverview Empaqueta `src/cli.ts` (+ `git-hook.ts`) en UN solo `.mjs` standalone sin dependencias.
 *
 * Es el runner de `npx github:kreodevs/ariadne link`: npx baja el repo sin compilar, así que el
 * archivo generado (`scripts/link.mjs` en la raíz) se versiona. Fuente única: `src/cli.ts`.
 *
 * Uso:
 *   node scripts/bundle-link.mjs                      # escribe dist/link.mjs (lo hace `npm run build`)
 *   node scripts/bundle-link.mjs --out ../../scripts/link.mjs   # actualiza el archivo versionado
 *   node scripts/bundle-link.mjs --out ../../scripts/link.mjs --check   # falla (exit 1) si está desactualizado
 */

import { build } from "esbuild";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const outIdx = args.indexOf("--out");
const outFile = resolve(pkgRoot, outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : "dist/link.mjs");

const HEADER = `// ARCHIVO GENERADO — no editar a mano.
// Fuente: services/mcp-ariadne/src/cli.ts (+ git-hook.ts). Regenerar: pnpm run build:link (raíz)
// o \`npm run sync:link\` en services/mcp-ariadne.
`;

const result = await build({
  entryPoints: [resolve(pkgRoot, "src/cli.ts")],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  target: "node20",
  legalComments: "none",
  // El shebang lo conserva esbuild desde src/cli.ts (la banner va después).
  banner: { js: HEADER },
  logLevel: "warning",
});

const code = result.outputFiles[0].text;

if (check) {
  const current = existsSync(outFile) ? readFileSync(outFile, "utf-8") : null;
  if (current !== code) {
    console.error(
      `✗ ${outFile} está desactualizado respecto a src/cli.ts.\n  Ejecuta: pnpm run build:link (raíz) y versiona el resultado.`,
    );
    process.exit(1);
  }
  console.log(`✓ ${outFile} está al día.`);
} else {
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, code, "utf-8");
  chmodSync(outFile, 0o755);
  console.log(`✓ Generado ${outFile} (${(code.length / 1024).toFixed(1)} KB)`);
}
