#!/usr/bin/env node
/**
 * @fileoverview Ariadne Link CLI
 *
 * Comando de inicialización "Zero-Config" de un proyecto local hacia Ariadne y Cursor.
 * Uso:
 *   npx ariadne link [--server <url>] [--token <ari_...>]
 *   npx ariadne init
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { execSync } from "node:child_process";
import { installPostCommitHook, type HookInstallStatus } from "./git-hook.js";

const CANONICAL_AGENTS_MD = `# AGENTS.md — Ariadne Codebase Intelligence

You have access to **Ariadne MCP** — a knowledge graph of this codebase powered by FalkorDB. It knows every component, function, route, model, import, and prop contract. Use it **before** writing code, not after.

## First steps (every session)

\`\`\`
list_known_projects()
\`\`\`

This gives you project IDs, repo names, and branches. Use the \`roots[].id\` (repo ID) as \`projectId\` in multi-root projects, not the project UUID. If you're editing a file, pass \`currentFilePath\` instead — the server infers the project.

## Core workflow

\`\`\`
1. list_known_projects() → get_sync_status(projectId)  [STOP if stale before large refactors]
2. semantic_search("what you're looking for") → find relevant code & Ego-Graphs
3. get_file_context(filePath) or get_file_content(path) → read the file
4. validate_before_edit(nodeName) → check impact + contract
5. Edit the code
6. detect_changes() → pre-commit blast radius check
\`\`\`

## Planned change workflow (multi-file / refactors)

\`\`\`
1. get_sync_status → resync if stale
2. Gate 1: get_modification_plan(userDescription) → filesToModify + changePlanTemplate
3. Build ChangePlan JSON (include referencePlan from Gate 1)
4. Gate 2: validate_change_plan → STOP if verdict === BLOCKED
5. Per symbol: validate_before_edit + get_references
6. Edit → detect_changes before commit
\`\`\`

## Rules

1. **Always validate before editing** — \`validate_before_edit\` on the node you're about to touch. No exceptions.
2. **Resolve projectId early** — Cache it. Every tool that accepts \`projectId\` works better with it.
3. **Route to cheap tools** — If you know the symbol/path, use \`get_file_content\` / \`get_definitions\` / \`get_references\` instead of general chat.
4. **Live Local Sync** — The Ariadne daemon watches your local file changes automatically in real time without requiring commit/push.
`;

const CANONICAL_CURSOR_RULE_MDC = `---
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

const CANONICAL_CLAUDE_MD = `# CLAUDE.md — Ariadne Codebase Intelligence

You are paired with **Ariadne MCP** — a FalkorDB-backed knowledge graph of this codebase tracking components, functions, routes, models, imports, and TypeScript prop contracts.

## First Step Every Session
\`\`\`
list_known_projects()
\`\`\`
Use the \`roots[].id\` as \`projectId\` in multi-root monorepos, or pass \`currentFilePath\` to let the server infer it.

## Core 2-Gate Workflow
1. \`get_sync_status(projectId)\` → Check if the graph is up-to-date.
2. **Gate 1**: \`get_modification_plan(userDescription)\` → Yields exact \`filesToModify\` and \`questionsToRefine\`.
3. **Code Inspection**: Read the relevant local files from \`filesToModify\`.
4. **Gate 2**: \`validate_change_plan(changePlanJson)\` → Mandatory before editing code. STOP if \`BLOCKED\`.
5. **Per Symbol**: \`validate_before_edit(nodeName)\` → Check impact and prop contracts before touching any function/component.
6. **Pre-Commit**: \`detect_changes()\` → Verify blast radius before committing.
`;

const CANONICAL_SKILL_MD = `---
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

function getGitRemoteOrigin(): string | null {
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

export async function runAriadneLink(): Promise<void> {
  const cwd = process.cwd();
  const dirName = basename(cwd);
  const gitOrigin = getGitRemoteOrigin();
  const { serverUrl, token, falkorHost } = parseArgs();

  console.log(`\n🚀 \x1b[1m\x1b[36mAriadne Codebase Intelligence — Quick Setup\x1b[0m\n`);
  console.log(`📁 Directorio local:  \x1b[32m${cwd}\x1b[0m`);
  if (gitOrigin) {
    console.log(`🌿 Git Origin:        \x1b[34m${gitOrigin}\x1b[0m`);
  }
  console.log(`🔗 Servidor Ariadne:  \x1b[33m${serverUrl}\x1b[0m\n`);

  // 1. Configurar .cursor/mcp.json
  const cursorDir = join(cwd, ".cursor");
  const mcpJsonPath = join(cursorDir, "mcp.json");

  if (!existsSync(cursorDir)) {
    await mkdir(cursorDir, { recursive: true });
  }

  let mcpConfig: { mcpServers: Record<string, unknown> } = { mcpServers: {} };
  if (existsSync(mcpJsonPath)) {
    try {
      const existingRaw = await readFile(mcpJsonPath, "utf-8");
      mcpConfig = JSON.parse(existingRaw);
      if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};
    } catch {
      // Usar estructura base si estaba corrupto
    }
  }

  const isRemote = !serverUrl.includes("localhost") && !serverUrl.includes("127.0.0.1");

  if (isRemote) {
    // Modo Remoto (Dokploy / Servidor Cloud):
    // FalkorDB no está expuesto a internet. Cursor se conecta vía HTTP al servicio mcp-ariadne
    const cleanUrl = serverUrl.replace(/\/mcp\/?$/, "");
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    mcpConfig.mcpServers.ariadne = {
      url: `${cleanUrl}/mcp`,
      ...(token ? { headers } : {}),
    };
    console.log(`✅ \x1b[32mConfigurado .cursor/mcp.json\x1b[0m (conexión HTTP remota a ${cleanUrl}/mcp)`);
  } else {
    // Modo Local (Ariadne corriendo en localhost)
    const mcpEnv: Record<string, string> = {
      INGEST_URL: serverUrl,
      FALKORDB_HOST: falkorHost,
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
      env: mcpEnv,
    };
    console.log(`✅ \x1b[32mConfigurado .cursor/mcp.json\x1b[0m (servidor STDIO local con auto-watcher)`);
  }

  await writeFile(mcpJsonPath, JSON.stringify(mcpConfig, null, 2) + "\n", "utf-8");

  // 2. Colocar AGENTS.md si no existe (Universal)
  const agentsMdPath = join(cwd, "AGENTS.md");
  if (!existsSync(agentsMdPath)) {
    await writeFile(agentsMdPath, CANONICAL_AGENTS_MD, "utf-8");
    console.log(`✅ \x1b[32mCreado AGENTS.md\x1b[0m (instrucciones canónicas universales)`);
  } else {
    console.log(`ℹ️  AGENTS.md ya existe en el proyecto (no se sobreescribió).`);
  }

  // 3. Colocar CLAUDE.md si no existe (Claude Code / Anthropic)
  const claudeMdPath = join(cwd, "CLAUDE.md");
  if (!existsSync(claudeMdPath)) {
    await writeFile(claudeMdPath, CANONICAL_CLAUDE_MD, "utf-8");
    console.log(`✅ \x1b[32mCreado CLAUDE.md\x1b[0m (directivas para Claude Code)`);
  }

  // 4. Regla nativa de Cursor (.cursor/rules/ariadne-governance.mdc)
  const cursorRulesDir = join(cursorDir, "rules");
  if (!existsSync(cursorRulesDir)) {
    await mkdir(cursorRulesDir, { recursive: true });
  }
  const cursorRulePath = join(cursorRulesDir, "ariadne-governance.mdc");
  if (!existsSync(cursorRulePath)) {
    await writeFile(cursorRulePath, CANONICAL_CURSOR_RULE_MDC, "utf-8");
    console.log(`✅ \x1b[32mCreada regla Cursor (.cursor/rules/ariadne-governance.mdc)\x1b[0m (prioridad de sistema)`);
  }

  // 5. Skill nativo para Google Antigravity (.agents/skills/ariadne/SKILL.md)
  const antigravitySkillDir = join(cwd, ".agents", "skills", "ariadne");
  if (!existsSync(antigravitySkillDir)) {
    await mkdir(antigravitySkillDir, { recursive: true });
  }
  const antigravitySkillPath = join(antigravitySkillDir, "SKILL.md");
  if (!existsSync(antigravitySkillPath)) {
    await writeFile(antigravitySkillPath, CANONICAL_SKILL_MD, "utf-8");
    console.log(`✅ \x1b[32mCreado Skill Antigravity (.agents/skills/ariadne/SKILL.md)\x1b[0m`);
  }

  // 6. Skill para Cursor (.cursor/skills/ariadnespecs-mcp/SKILL.md)
  const cursorSkillDir = join(cursorDir, "skills", "ariadnespecs-mcp");
  if (!existsSync(cursorSkillDir)) {
    await mkdir(cursorSkillDir, { recursive: true });
  }
  const cursorSkillPath = join(cursorSkillDir, "SKILL.md");
  if (!existsSync(cursorSkillPath)) {
    await writeFile(cursorSkillPath, CANONICAL_SKILL_MD, "utf-8");
    console.log(`✅ \x1b[32mCreado Skill Cursor (.cursor/skills/ariadnespecs-mcp/SKILL.md)\x1b[0m`);
  }

  // 7. Crear .ariadne/config.json
  const ariadneDir = join(cwd, ".ariadne");
  if (!existsSync(ariadneDir)) {
    await mkdir(ariadneDir, { recursive: true });
  }
  const configJsonPath = join(ariadneDir, "config.json");
  const ariadneConfig = {
    projectName: dirName,
    gitOrigin: gitOrigin || undefined,
    serverUrl,
    linkedAt: new Date().toISOString(),
  };
  await writeFile(configJsonPath, JSON.stringify(ariadneConfig, null, 2) + "\n", "utf-8");
  console.log(`✅ \x1b[32mRegistrado .ariadne/config.json\x1b[0m`);

  // 8. Hook git post-commit (idempotente): sincroniza al grafo los archivos de cada commit
  const hook = await installPostCommitHook(cwd);
  const hookMsg: Record<HookInstallStatus, string> = {
    installed: "✅ \x1b[32mInstalado hook git post-commit\x1b[0m",
    appended: "✅ \x1b[32mHook post-commit añadido al existente\x1b[0m (el contenido previo no se tocó)",
    updated: "✅ \x1b[32mHook post-commit actualizado\x1b[0m",
    unchanged: "ℹ️  Hook post-commit ya instalado y al día.",
    "skipped-not-git": "ℹ️  No es un repositorio git: hook post-commit omitido.",
    "skipped-foreign-shebang": "⚠️  Ya existe un hook post-commit que no es shell: no se modificó (añade el bloque a mano, ver scripts/git-hooks/README.md).",
  };
  console.log(`${hookMsg[hook.status]}${hook.hookPath && hook.status !== "skipped-foreign-shebang" ? ` (${hook.hookPath})` : ""}`);

  console.log(`\n🎉 \x1b[1m\x1b[32m¡Listo! Tu proyecto ahora está conectado a Ariadne.\x1b[0m`);
  console.log(`
👉 \x1b[1mSiguientes pasos:\x1b[0m
   1. Abre Cursor en este proyecto.
   2. Cursor levantará el servidor Ariadne y el \x1b[36mLive Watcher\x1b[0m automáticamente en segundo plano.
   3. Pídele al agente en el chat de Cursor: \x1b[33m"list_known_projects()"\x1b[0m o haz cualquier pregunta sobre tu arquitectura.
`);
}

// Invocación CLI directa
void runAriadneLink().catch((err) => {
  console.error(`\x1b[31mError vinculando proyecto:\x1b[0m`, err);
  process.exit(1);
});

