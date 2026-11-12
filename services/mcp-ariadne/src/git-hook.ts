/**
 * @fileoverview Instalación idempotente del hook git `post-commit` de Ariadne.
 *
 * El hook envía al ingest (`POST /repositories/local-sync/file`) los archivos del commit
 * recién hecho, igual que el daemon `live-watcher`. Lo instala `ariadne link`.
 *
 * `scripts/link.mjs` (runner de `npx github:...`) se GENERA desde este código con `pnpm run build:link`; no tiene copia a mano.
 *
 * Idempotencia: el bloque va entre marcadores. Si ya existe se reemplaza en su sitio
 * (sin duplicar); si el hook ya tenía contenido ajeno (Husky, lint, etc.) se añade al final
 * sin tocar lo demás; si no cambia nada, no se escribe.
 */

import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

export const HOOK_BEGIN = "# >>> ariadne post-commit >>>";
export const HOOK_END = "# <<< ariadne post-commit <<<";

/** Script Node (sin comillas simples ni plantillas: va dentro de `node -e '...'`). */
const HOOK_NODE_SCRIPT = String.raw`
const fs = require("fs"), path = require("path");
const root = process.env.ROOT;
let projectId, cfgUrl;
try { projectId = JSON.parse(fs.readFileSync(path.join(root, ".ariadne-project"), "utf8")).projectId; } catch (e) {}
try { cfgUrl = JSON.parse(fs.readFileSync(path.join(root, ".ariadne", "config.json"), "utf8")).serverUrl; } catch (e) {}
const url = (process.env.INGEST_URL || process.env.ARIADNE_INGEST_URL || cfgUrl || "http://localhost:3002").replace(/\/$/, "");
const EXT = new Set([".ts",".tsx",".js",".jsx",".mjs",".cjs",".prisma",".py",".go",".rs"]);
const IGN = ["node_modules","dist","build",".next",".turbo","coverage",".ariadne"];
const tok = fs.readFileSync(0, "utf8").split("\0").filter(Boolean);
const files = [];
for (let i = 0; i < tok.length; ) {
  const st = tok[i][0];
  if (st === "R" || st === "C") { if (st === "R") files.push({ p: tok[i+1], del: true }); files.push({ p: tok[i+2], del: false }); i += 3; }
  else { files.push({ p: tok[i+1], del: st === "D" }); i += 2; }
}
const ok = (f) => (EXT.has(path.extname(f.p).toLowerCase()) || f.p.endsWith("package.json"))
  && !IGN.some((d) => f.p.startsWith(d + "/") || f.p.includes("/" + d + "/"));
(async () => {
  let n = 0, fail = 0;
  for (const f of files.filter(ok)) {
    let content = "", del = f.del;
    if (!del) { try { content = fs.readFileSync(path.join(root, f.p), "utf8"); } catch (e) { del = true; } }
    try {
      const r = await fetch(url + "/repositories/local-sync/file", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: f.p, content: del ? "" : content, projectId: projectId }),
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) n++; else fail++;
    } catch (e) { fail++; break; }
  }
  if (n || fail) console.error("[ariadne] post-commit: " + n + " archivo(s) sincronizados" + (fail ? ", " + fail + " fallaron (ingest en " + url + "?)" : ""));
})();
`;

/** Bloque completo (con marcadores) que se inserta en el hook. Corre en subshell: nunca corta el resto del hook. */
export const POST_COMMIT_BLOCK = String.raw`${HOOK_BEGIN}
# Gestionado por "ariadne link" (re-ejecutarlo lo actualiza). ARIADNE_HOOK_DISABLE=1 lo omite.
(
  [ "$ARIADNE_HOOK_DISABLE" = "1" ] && exit 0
  command -v node >/dev/null 2>&1 || exit 0
  ARIADNE_ROOT="$(git rev-parse --show-toplevel)" || exit 0
  cd "$ARIADNE_ROOT" || exit 0
  git diff-tree --no-commit-id --name-status -r -z --root HEAD 2>/dev/null |
    ROOT="$ARIADNE_ROOT" node -e '${HOOK_NODE_SCRIPT}'
) || true
${HOOK_END}
`;

export type HookInstallStatus =
  | "installed" // hook nuevo
  | "appended" // se añadió a un hook existente
  | "updated" // bloque previo actualizado
  | "unchanged" // ya estaba al día
  | "skipped-not-git"
  | "skipped-foreign-shebang";

export interface HookInstallResult {
  status: HookInstallStatus;
  hookPath?: string;
}

/** Carpeta de hooks efectiva (respeta core.hooksPath y worktrees; Husky v9 usa `.husky/_` generado → `.husky`). */
export function resolveHooksDir(cwd: string): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "--git-path", "hooks"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    let dir = resolve(cwd, out);
    if (basename(dir) === "_" && basename(dirname(dir)) === ".husky") dir = dirname(dir);
    return dir;
  } catch {
    return null;
  }
}

const BLOCK_RE = new RegExp(`${HOOK_BEGIN}[\\s\\S]*?${HOOK_END}\\n?`);
const SHELL_SHEBANG_RE = /^#!.*\b(ba|z|da|k)?sh\b/;

/** Calcula el contenido final del hook a partir del existente (puro, testeable). */
export function mergeHookContent(
  existing: string | null,
): { content: string; status: HookInstallStatus } {
  if (existing === null || existing.trim() === "") {
    return { content: `#!/usr/bin/env bash\n${POST_COMMIT_BLOCK}`, status: "installed" };
  }
  if (BLOCK_RE.test(existing)) {
    const content = existing.replace(BLOCK_RE, () => POST_COMMIT_BLOCK);
    return { content, status: content === existing ? "unchanged" : "updated" };
  }
  if (existing.startsWith("#!") && !SHELL_SHEBANG_RE.test(existing.split("\n", 1)[0])) {
    return { content: existing, status: "skipped-foreign-shebang" };
  }
  const sep = existing.endsWith("\n") ? "\n" : "\n\n";
  return { content: `${existing}${sep}${POST_COMMIT_BLOCK}`, status: "appended" };
}

/** Instala o actualiza el hook `post-commit` en el repo de `cwd`. Idempotente. */
export async function installPostCommitHook(cwd: string): Promise<HookInstallResult> {
  const hooksDir = resolveHooksDir(cwd);
  if (!hooksDir) return { status: "skipped-not-git" };

  const hookPath = resolve(hooksDir, "post-commit");
  const existing = existsSync(hookPath) ? await readFile(hookPath, "utf-8") : null;
  const { content, status } = mergeHookContent(existing);

  if (status === "skipped-foreign-shebang") return { status, hookPath };
  if (status !== "unchanged") {
    await mkdir(hooksDir, { recursive: true });
    await writeFile(hookPath, content, "utf-8");
  }
  const mode = (await stat(hookPath)).mode;
  if ((mode & 0o111) !== 0o111) await chmod(hookPath, mode | 0o755);
  return { status, hookPath };
}
