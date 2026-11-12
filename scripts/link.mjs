#!/usr/bin/env node
// ARCHIVO GENERADO — no editar a mano.
// Fuente: services/mcp-ariadne/src/cli.ts (+ git-hook.ts). Regenerar: pnpm run build:link (raíz)
// o `npm run sync:link` en services/mcp-ariadne.


// src/cli.ts
import { existsSync as existsSync2 } from "node:fs";
import { mkdir as mkdir2, readFile as readFile2, writeFile as writeFile2 } from "node:fs/promises";
import { join, basename as basename2 } from "node:path";
import { execSync } from "node:child_process";

// src/git-hook.ts
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
var HOOK_BEGIN = "# >>> ariadne post-commit >>>";
var HOOK_END = "# <<< ariadne post-commit <<<";
var HOOK_NODE_SCRIPT = String.raw`
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
var POST_COMMIT_BLOCK = String.raw`${HOOK_BEGIN}
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
function resolveHooksDir(cwd) {
  try {
    const out = execFileSync("git", ["rev-parse", "--git-path", "hooks"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    let dir = resolve(cwd, out);
    if (basename(dir) === "_" && basename(dirname(dir)) === ".husky") dir = dirname(dir);
    return dir;
  } catch {
    return null;
  }
}
var BLOCK_RE = new RegExp(`${HOOK_BEGIN}[\\s\\S]*?${HOOK_END}\\n?`);
var SHELL_SHEBANG_RE = /^#!.*\b(ba|z|da|k)?sh\b/;
function mergeHookContent(existing) {
  if (existing === null || existing.trim() === "") {
    return { content: `#!/usr/bin/env bash
${POST_COMMIT_BLOCK}`, status: "installed" };
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
async function installPostCommitHook(cwd) {
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
  if ((mode & 73) !== 73) await chmod(hookPath, mode | 493);
  return { status, hookPath };
}

// src/cli.ts
var CANONICAL_AGENTS_MD = `# AGENTS.md \u2014 Ariadne Codebase Intelligence

You have access to **Ariadne MCP** \u2014 a knowledge graph of this codebase powered by FalkorDB. It knows every component, function, route, model, import, and prop contract. Use it **before** writing code, not after.

## First steps (every session)

\`\`\`
list_known_projects()
\`\`\`

This gives you project IDs, repo names, and branches. Use the \`roots[].id\` (repo ID) as \`projectId\` in multi-root projects, not the project UUID. If you're editing a file, pass \`currentFilePath\` instead \u2014 the server infers the project.

## Core workflow

\`\`\`
1. list_known_projects() \u2192 get_sync_status(projectId)  [STOP if stale before large refactors]
2. semantic_search("what you're looking for") \u2192 find relevant code & Ego-Graphs
3. get_file_context(filePath) or get_file_content(path) \u2192 read the file
4. validate_before_edit(nodeName) \u2192 check impact + contract
5. Edit the code
6. detect_changes() \u2192 pre-commit blast radius check
\`\`\`

## Planned change workflow (multi-file / refactors)

\`\`\`
1. get_sync_status \u2192 resync if stale
2. Gate 1: get_modification_plan(userDescription) \u2192 filesToModify + changePlanTemplate
3. Build ChangePlan JSON (include referencePlan from Gate 1)
4. Gate 2: validate_change_plan \u2192 STOP if verdict === BLOCKED
5. Per symbol: validate_before_edit + get_references
6. Edit \u2192 detect_changes before commit
\`\`\`

## Rules

1. **Always validate before editing** \u2014 \`validate_before_edit\` on the node you're about to touch. No exceptions.
2. **Resolve projectId early** \u2014 Cache it. Every tool that accepts \`projectId\` works better with it.
3. **Route to cheap tools** \u2014 If you know the symbol/path, use \`get_file_content\` / \`get_definitions\` / \`get_references\` instead of general chat.
4. **Live Local Sync** \u2014 The Ariadne daemon watches your local file changes automatically in real time without requiring commit/push.
`;
var CANONICAL_CURSOR_RULE_MDC = `---
description: Ariadne Codebase Intelligence governance & 2-gate workflow
globs: *
alwaysApply: true
---

# Ariadne Codebase Intelligence Governance

You are paired with **Ariadne MCP** (backed by FalkorDB). You MUST consult the codebase knowledge graph before creating, modifying, or refactoring code.

## Mandatory 2-Gate Workflow

1. **Verify Freshness**:
   - Call \`get_sync_status(projectId)\` before planning any multi-file change. If stale, resync.
2. **Gate 1 (Modification Plan)**:
   - Call \`get_modification_plan(userDescription)\`.
   - Never guess files; only modify \`filesToModify\` returned by the graph.
   - Address the business/technical questions returned in \`questionsToRefine\`.
3. **Gate 2 (ChangePlan Audit)**:
   - Formulate the structured \`ChangePlan\` JSON using \`changePlanTemplate\`.
   - Call \`validate_change_plan(changePlan)\`. If the verdict is \`BLOCKED\`, STOP immediately.
4. **Before Editing Any Symbol**:
   - ALWAYS call \`validate_before_edit(nodeName)\` to verify the prop contract and dependents.
5. **Pre-Commit Blast Radius**:
   - Call \`detect_changes()\` before committing to ensure no unintended dependents are broken.
`;
var CANONICAL_CLAUDE_MD = `# CLAUDE.md \u2014 Ariadne Codebase Intelligence

You are paired with **Ariadne MCP** \u2014 a FalkorDB-backed knowledge graph of this codebase tracking components, functions, routes, models, imports, and TypeScript prop contracts.

## First Step Every Session
\`\`\`
list_known_projects()
\`\`\`
Use the \`roots[].id\` as \`projectId\` in multi-root monorepos, or pass \`currentFilePath\` to let the server infer it.

## Core 2-Gate Workflow
1. \`get_sync_status(projectId)\` \u2192 Check if the graph is up-to-date.
2. **Gate 1**: \`get_modification_plan(userDescription)\` \u2192 Yields exact \`filesToModify\` and \`questionsToRefine\`.
3. **Code Inspection**: Read the relevant local files from \`filesToModify\`.
4. **Gate 2**: \`validate_change_plan(changePlanJson)\` \u2192 Mandatory before editing code. STOP if \`BLOCKED\`.
5. **Per Symbol**: \`validate_before_edit(nodeName)\` \u2192 Check impact and prop contracts before touching any function/component.
6. **Pre-Commit**: \`detect_changes()\` \u2192 Verify blast radius before committing.
`;
var CANONICAL_SKILL_MD = `---
name: ariadne
description: Ariadne FalkorDB knowledge graph governance, 2-gate refactor workflow, impact analysis, and TypeScript prop contracts. Use before writing, modifying, or refactoring code.
---

# Ariadne Codebase Intelligence

Use this skill whenever you explore architecture, plan changes, or modify code in this codebase.

## Quick Reference Tools
- \`list_known_projects()\`: Discover indexed projects and repository IDs.
- \`semantic_search(query)\`: Vector + lexical search with 1-hop Ego-Graphs.
- \`get_file_context(filePath)\`: File content + imports + exports.
- \`get_modification_plan(userDescription)\`: Gate 1 planning (files to modify + business questions).
- \`validate_change_plan(plan)\`: Gate 2 audit before multi-file edits.
- \`validate_before_edit(nodeName)\`: Mandatory contract check before editing any symbol.
- \`detect_changes()\`: Pre-commit blast radius inspection.
`;
function getGitRemoteOrigin() {
  try {
    const out = execSync("git remote get-url origin", { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim();
  } catch {
    return null;
  }
}
function parseArgs() {
  const args = process.argv.slice(2);
  let serverUrl = process.env.ARIADNE_URL || process.env.INGEST_URL || "http://localhost:3002";
  let token = process.env.ARIADNE_TOKEN || process.env.MCP_SECRET || "";
  let falkorHost = process.env.FALKORDB_HOST || "localhost";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--server" && args[i + 1]) {
      serverUrl = args[i + 1];
      i++;
    } else if (args[i] === "--token" && args[i + 1]) {
      token = args[i + 1];
      i++;
    } else if (args[i] === "--falkor" && args[i + 1]) {
      falkorHost = args[i + 1];
      i++;
    }
  }
  return { serverUrl: serverUrl.replace(/\/$/, ""), token, falkorHost };
}
async function runAriadneLink() {
  const cwd = process.cwd();
  const dirName = basename2(cwd);
  const gitOrigin = getGitRemoteOrigin();
  const { serverUrl, token, falkorHost } = parseArgs();
  console.log(`
\u{1F680} \x1B[1m\x1B[36mAriadne Codebase Intelligence \u2014 Quick Setup\x1B[0m
`);
  console.log(`\u{1F4C1} Directorio local:  \x1B[32m${cwd}\x1B[0m`);
  if (gitOrigin) {
    console.log(`\u{1F33F} Git Origin:        \x1B[34m${gitOrigin}\x1B[0m`);
  }
  console.log(`\u{1F517} Servidor Ariadne:  \x1B[33m${serverUrl}\x1B[0m
`);
  const cursorDir = join(cwd, ".cursor");
  const mcpJsonPath = join(cursorDir, "mcp.json");
  if (!existsSync2(cursorDir)) {
    await mkdir2(cursorDir, { recursive: true });
  }
  let mcpConfig = { mcpServers: {} };
  if (existsSync2(mcpJsonPath)) {
    try {
      const existingRaw = await readFile2(mcpJsonPath, "utf-8");
      mcpConfig = JSON.parse(existingRaw);
      if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};
    } catch {
    }
  }
  const isRemote = !serverUrl.includes("localhost") && !serverUrl.includes("127.0.0.1");
  if (isRemote) {
    const cleanUrl = serverUrl.replace(/\/mcp\/?$/, "");
    const headers = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    mcpConfig.mcpServers.ariadne = {
      url: `${cleanUrl}/mcp`,
      ...token ? { headers } : {}
    };
    console.log(`\u2705 \x1B[32mConfigurado .cursor/mcp.json\x1B[0m (conexi\xF3n HTTP remota a ${cleanUrl}/mcp)`);
  } else {
    const mcpEnv = {
      INGEST_URL: serverUrl,
      FALKORDB_HOST: falkorHost
    };
    if (token) {
      mcpEnv.ARIADNE_TOKEN = token;
    }
    let mcpCommand = "ariadne-mcp";
    let mcpArgs = ["--stdio"];
    try {
      execSync("which ariadne-mcp", { stdio: "ignore" });
    } catch {
      mcpCommand = "npx";
      mcpArgs = ["-y", "@kreodevs/ariadne", "--stdio"];
    }
    mcpConfig.mcpServers.ariadne = {
      command: mcpCommand,
      args: mcpArgs,
      env: mcpEnv
    };
    console.log(`\u2705 \x1B[32mConfigurado .cursor/mcp.json\x1B[0m (servidor STDIO local con auto-watcher)`);
  }
  await writeFile2(mcpJsonPath, JSON.stringify(mcpConfig, null, 2) + "\n", "utf-8");
  const agentsMdPath = join(cwd, "AGENTS.md");
  if (!existsSync2(agentsMdPath)) {
    await writeFile2(agentsMdPath, CANONICAL_AGENTS_MD, "utf-8");
    console.log(`\u2705 \x1B[32mCreado AGENTS.md\x1B[0m (instrucciones can\xF3nicas universales)`);
  } else {
    console.log(`\u2139\uFE0F  AGENTS.md ya existe en el proyecto (no se sobreescribi\xF3).`);
  }
  const claudeMdPath = join(cwd, "CLAUDE.md");
  if (!existsSync2(claudeMdPath)) {
    await writeFile2(claudeMdPath, CANONICAL_CLAUDE_MD, "utf-8");
    console.log(`\u2705 \x1B[32mCreado CLAUDE.md\x1B[0m (directivas para Claude Code)`);
  }
  const cursorRulesDir = join(cursorDir, "rules");
  if (!existsSync2(cursorRulesDir)) {
    await mkdir2(cursorRulesDir, { recursive: true });
  }
  const cursorRulePath = join(cursorRulesDir, "ariadne-governance.mdc");
  if (!existsSync2(cursorRulePath)) {
    await writeFile2(cursorRulePath, CANONICAL_CURSOR_RULE_MDC, "utf-8");
    console.log(`\u2705 \x1B[32mCreada regla Cursor (.cursor/rules/ariadne-governance.mdc)\x1B[0m (prioridad de sistema)`);
  }
  const antigravitySkillDir = join(cwd, ".agents", "skills", "ariadne");
  if (!existsSync2(antigravitySkillDir)) {
    await mkdir2(antigravitySkillDir, { recursive: true });
  }
  const antigravitySkillPath = join(antigravitySkillDir, "SKILL.md");
  if (!existsSync2(antigravitySkillPath)) {
    await writeFile2(antigravitySkillPath, CANONICAL_SKILL_MD, "utf-8");
    console.log(`\u2705 \x1B[32mCreado Skill Antigravity (.agents/skills/ariadne/SKILL.md)\x1B[0m`);
  }
  const cursorSkillDir = join(cursorDir, "skills", "ariadnespecs-mcp");
  if (!existsSync2(cursorSkillDir)) {
    await mkdir2(cursorSkillDir, { recursive: true });
  }
  const cursorSkillPath = join(cursorSkillDir, "SKILL.md");
  if (!existsSync2(cursorSkillPath)) {
    await writeFile2(cursorSkillPath, CANONICAL_SKILL_MD, "utf-8");
    console.log(`\u2705 \x1B[32mCreado Skill Cursor (.cursor/skills/ariadnespecs-mcp/SKILL.md)\x1B[0m`);
  }
  const ariadneDir = join(cwd, ".ariadne");
  if (!existsSync2(ariadneDir)) {
    await mkdir2(ariadneDir, { recursive: true });
  }
  const configJsonPath = join(ariadneDir, "config.json");
  const ariadneConfig = {
    projectName: dirName,
    gitOrigin: gitOrigin || void 0,
    serverUrl,
    linkedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await writeFile2(configJsonPath, JSON.stringify(ariadneConfig, null, 2) + "\n", "utf-8");
  console.log(`\u2705 \x1B[32mRegistrado .ariadne/config.json\x1B[0m`);
  const hook = await installPostCommitHook(cwd);
  const hookMsg = {
    installed: "\u2705 \x1B[32mInstalado hook git post-commit\x1B[0m",
    appended: "\u2705 \x1B[32mHook post-commit a\xF1adido al existente\x1B[0m (el contenido previo no se toc\xF3)",
    updated: "\u2705 \x1B[32mHook post-commit actualizado\x1B[0m",
    unchanged: "\u2139\uFE0F  Hook post-commit ya instalado y al d\xEDa.",
    "skipped-not-git": "\u2139\uFE0F  No es un repositorio git: hook post-commit omitido.",
    "skipped-foreign-shebang": "\u26A0\uFE0F  Ya existe un hook post-commit que no es shell: no se modific\xF3 (a\xF1ade el bloque a mano, ver scripts/git-hooks/README.md)."
  };
  console.log(`${hookMsg[hook.status]}${hook.hookPath && hook.status !== "skipped-foreign-shebang" ? ` (${hook.hookPath})` : ""}`);
  console.log(`
\u{1F389} \x1B[1m\x1B[32m\xA1Listo! Tu proyecto ahora est\xE1 conectado a Ariadne.\x1B[0m`);
  console.log(`
\u{1F449} \x1B[1mSiguientes pasos:\x1B[0m
   1. Abre Cursor en este proyecto.
   2. Cursor levantar\xE1 el servidor Ariadne y el \x1B[36mLive Watcher\x1B[0m autom\xE1ticamente en segundo plano.
   3. P\xEDdele al agente en el chat de Cursor: \x1B[33m"list_known_projects()"\x1B[0m o haz cualquier pregunta sobre tu arquitectura.
`);
}
void runAriadneLink().catch((err) => {
  console.error(`\x1B[31mError vinculando proyecto:\x1B[0m`, err);
  process.exit(1);
});
export {
  runAriadneLink
};
