#!/usr/bin/env node
/**
 * @fileoverview **AriadneSpecs Oracle** — servidor MCP (Model Context Protocol) con transporte HTTP streamable.
 *
 * Expone herramientas para IDEs y agentes: grafo de componentes, impacto legacy, validación pre-edición,
 * búsqueda semántica, contenido de archivos, análisis de proyecto, planes de modificación, etc.
 * Variables de entorno clave: `PORT`, `MCP_HTTP_ALLOW_UNAUTHENTICATED` (solo dev local), `FALKORDB_HOST`, `INGEST_URL`, `ARIADNE_API_URL`,
 * Bearer del cliente (Secret MCP `ari_…` o JWT web) solo por la petición HTTP a `/mcp` — se reenvía al Nest. Límites de logging:
 * `MCP_TOOL_LOG`, `MCP_TOOL_LOG_ARG_MAX`, `MCP_TOOL_LOG_RESPONSE_BLOCK_MAX`, `MCP_TOOL_LOG_RESPONSE_TOTAL_MAX`.
 *
 * @copyright 2026 Jorge Correa
 * @license Apache-2.0
 * @author Jorge Correa <jcorrea@e-personal.net>
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createLogger, isProjectShardingEnabled, guardCypherQuery, CypherGuardError } from "ariadne-common";
import { refreshFalkorRuntimeOverrides } from "./falkor-runtime-settings.js";
import { getGraph, closeFalkor, forEachProjectShardGraph } from "./falkor.js";
import { getMcpToolCache, closeRedis } from "./redis.js";
import { loadAriadneProjectConfig, loadAriadneProjectConfigNearFile, resolveAbsolutePath } from "./utils.js";
import {
  augmentScopeWithInferredRepo,
  fetchResolveRepoForPath,
  findBestProjectRepoForPathFromIngest,
  ingestProjectExists,
  toAbsoluteIdePath,
} from "./mcp-scope-enrichment.js";
import { mcpLimits } from "./mcp-tool-limits.js";
import { resolveGraphScopeFromProjectOrRepoId, whereProjectRepo } from "./resolve-graph-scope.js";
import { invokeIngestLegacyDocumentation, type LegacyDocumentationScope } from "./legacy-documentation.js";
import {
  fetchBrownfieldParityPack,
  fetchMergedProjectMdd,
  formatBrownfieldMcpEnvelope,
} from "./brownfield-mcp.util.js";
import {
  analyzeDiffImpact,
  emptyDiffMessage,
  formatDetectChangesMarkdown,
  resolveDetectChangesDiff,
  type GraphClient,
} from "./detect-changes-handler.js";

const MCP_PATH = "/mcp";

const logger = createLogger('mcp-ariadne');

interface SyncStatusJobDetail {
  id: string;
  type: string;
  status: string;
  startedAt: string;
}

interface SyncStatusResponse {
  status: string;
  lastSync: string | null;
  lastCommitSha: string | null;
  stale: boolean;
  staleAfterHours: number;
  recommendation: string | null;
  details: SyncStatusJobDetail[];
  repositories: Array<{ id: string; repoSlug: string; stale: boolean }>;
}

/** Bearer del cliente HTTP en esta petición (p. ej. Secret MCP `ari_…` en mcp.json) para reenviar al API Nest. */
type McpNestAuthStore = { clientBearerForNest?: string };
const mcpNestAuthAls = new AsyncLocalStorage<McpNestAuthStore>();

/** Base URL del API Nest (prefijo global `/api`). */
function ariadneApiBase(): string {
  return (process.env.ARIADNE_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Headers para `fetch` al API Nest (`Authorization: Bearer`).
 * Usa únicamente el mismo Bearer que el cliente envió a esta petición MCP (Cursor `mcp.json`: Secret MCP o JWT de sesión).
 */
function pickNestAuthToken(): string | undefined {
  return mcpNestAuthAls.getStore()?.clientBearerForNest?.trim() || undefined;
}

function ariadneApiFetchInit(extra: RequestInit = {}): RequestInit {
  const headers = new Headers(extra.headers as HeadersInit | undefined);
  const token = pickNestAuthToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return { ...extra, headers };
}

/** Respuesta JSON de `GET /api/graph/component/:name` (GraphService.getComponent). */
type ComponentGraphApiPayload = {
  componentName: string;
  depth: number;
  projectId?: string;
  dependencies: Array<{ name?: string; path?: string }>;
  nodes: Array<{ id: string; kind: string; name?: string; path?: string; projectId?: string }>;
  edges: Array<{ kind: string; source: string; target: string }>;
  graphHints?: { suggestResync?: boolean; messageEs?: string };
};

/** Markdown desde la respuesta JSON de `GET /api/graph/component/:name` (GraphService.getComponent). */
function formatComponentGraphFromApi(payload: ComponentGraphApiPayload): string {
  const lines: string[] = [
    "## Grafo de componente (API Nest — mismo criterio que el explorador)",
    "",
    `**componentName:** \`${payload.componentName}\` · **depth:** ${payload.depth}` +
      (payload.projectId ? ` · **projectId:** \`${payload.projectId}\`` : ""),
    "",
    "_Fuente: `GET /api/graph/component`_",
    "",
  ];
  if (payload.graphHints?.messageEs) {
    lines.push("### Aviso (graphHints)", "", String(payload.graphHints.messageEs), "");
    if (payload.graphHints.suggestResync) lines.push("_Sugerencia: considerar resync del proyecto._", "");
  }
  const nodeById = new Map(payload.nodes.map((n) => [n.id, n]));
  const fmtRef = (id: string) => {
    const n = nodeById.get(id);
    if (!n) return `\`${id}\``;
    const nm = n.name ?? id;
    const p = n.path ? ` — \`${n.path}\`` : "";
    return `\`${nm}\` (${n.kind})${p}`;
  };
  lines.push(`**Resumen:** ${payload.nodes.length} nodos · ${payload.edges.length} aristas · ${payload.dependencies.length} dependencias (lista)`, "");
  if (payload.edges.length > 0) {
    lines.push("### Aristas", "");
    const byKind = new Map<string, typeof payload.edges>();
    for (const e of payload.edges) {
      if (!byKind.has(e.kind)) byKind.set(e.kind, []);
      byKind.get(e.kind)!.push(e);
    }
    for (const [kind, es] of byKind) {
      lines.push(`**${kind}**`, "");
      for (const e of es) {
        lines.push(`- ${fmtRef(e.source)} → ${fmtRef(e.target)}`);
      }
      lines.push("");
    }
  }
  if (payload.dependencies.length > 0) {
    lines.push("### dependencies", "");
    for (const d of payload.dependencies) {
      lines.push(`- **${d.name ?? "?"}** — \`${d.path ?? ""}\``);
    }
    lines.push("");
  }
  if (payload.nodes.length > 0 && payload.edges.length === 0 && payload.dependencies.length === 0) {
    lines.push("### Nodos", "");
    for (const n of payload.nodes) {
      const nm = n.name ?? n.id;
      const p = n.path ? ` — \`${n.path}\`` : "";
      lines.push(`- \`${nm}\` (${n.kind})${p}`);
    }
  }
  return lines.join("\n").trimEnd();
}

function getTokenFromRequest(req: IncomingMessage): string | null {
  const m2m = req.headers["x-m2m-token"];
  if (typeof m2m === "string" && m2m.trim()) return m2m.trim();
  const auth = req.headers.authorization;
  return auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
}

/** Valida token MCP contra usuario en BD vía Ingest directo (fallback API Gateway). Retorna null si ok. */
async function validateAuth(req: IncomingMessage): Promise<string | null> {
  const clientToken = getTokenFromRequest(req);

  if (!clientToken) {
    return "Token no proporcionado (X-M2M-Token o Authorization: Bearer)";
  }

  // Validar contra token MCP de usuario vía Ingest directo (más rápido, sin pasar por API Gateway)
  try {
    const ingestUrl = process.env.INGEST_URL?.trim() || 'http://ingest:3002';
    const res = await fetch(`${ingestUrl}/internal/users/validate-mcp-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: clientToken }),
    });
    if (res.ok) {
      const data = await res.json() as { valid: boolean; user?: { id: string; email: string; role: string; name: string | null } };
      if (data.valid) {
        // Adjuntar usuario autenticado para logging/audit
        if (data.user) {
          (req as IncomingMessage & { authUser?: unknown }).authUser = data.user;
        }
        return null;
      }
      logger.warn(`[MCP] validateAuth: per-user validation returned valid=false (email=${data.user?.email ?? '?'})`);
    } else {
      const body = await res.text().catch(() => '<no body>');
      logger.warn(`[MCP] validateAuth: per-user fetch returned ${res.status} ${res.statusText}: ${body.slice(0, 500)}`);
    }
  } catch (err) {
    // Si falla, intentar por API Gateway como fallback (mantener backward compat)
    logger.warn(`[MCP] validateAuth: per-user fetch via ingest failed, trying API Gateway: ${err instanceof Error ? err.message : String(err)}`);
    try {
      const apiUrl = ariadneApiBase();
      const res = await fetch(`${apiUrl}/api/internal/users/validate-mcp-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: clientToken }),
      });
      if (res.ok) {
        const data = await res.json() as { valid: boolean; user?: { id: string; email: string; role: string; name: string | null } };
        if (data.valid) {
          if (data.user) {
            (req as IncomingMessage & { authUser?: unknown }).authUser = data.user;
          }
          return null;
        }
      }
    } catch (err2) {
      logger.error(`[MCP] validateAuth: per-user fetch failed (both ingest and api): ${err2 instanceof Error ? err2.message : String(err2)}`);
    }
  }

  return "Token MCP inválido";
}

const MCP_TOOL_LOG_ARG_MAX = (() => {
  const v = Number(process.env.MCP_TOOL_LOG_ARG_MAX ?? "12000");
  return Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), 500_000) : 12_000;
})();

const MCP_TOOL_LOG_RESPONSE_BLOCK_MAX = (() => {
  const v = Number(process.env.MCP_TOOL_LOG_RESPONSE_BLOCK_MAX ?? "32000");
  return Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), 2_000_000) : 32_000;
})();

const MCP_TOOL_LOG_RESPONSE_TOTAL_MAX = (() => {
  const v = Number(process.env.MCP_TOOL_LOG_RESPONSE_TOTAL_MAX ?? "120000");
  return Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), 5_000_000) : 120_000;
})();

function isMcpToolInvocationLoggingEnabled(): boolean {
  const v = (process.env.MCP_TOOL_LOG ?? "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off" && v !== "no";
}

function redactToolArgumentsForLog(value: unknown, depth = 0): unknown {
  if (depth > 10) return "[max-depth]";
  if (value == null) return value;
  if (typeof value === "string") {
    if (/^eyJ[A-Za-z0-9_-]+\.eyJ/.test(value)) return "[jwt:redacted]";
    const max = 4000;
    return value.length > max ? `${value.slice(0, max)}…(+${value.length - max} chars)` : value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((x) => redactToolArgumentsForLog(x, depth + 1));
  const o = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    const lk = k.toLowerCase();
    if (
      lk.includes("token") ||
      lk.includes("secret") ||
      lk.includes("password") ||
      lk === "authorization" ||
      lk.includes("bearer")
    ) {
      out[k] = "[redacted]";
    } else {
      out[k] = redactToolArgumentsForLog(v, depth + 1);
    }
  }
  return out;
}

function stringifyMcpToolLogPayload(obj: unknown): string {
  try {
    const s = JSON.stringify(obj);
    if (s.length <= MCP_TOOL_LOG_ARG_MAX) return s;
    return `${s.slice(0, MCP_TOOL_LOG_ARG_MAX)}…[log_truncated total_chars=${s.length}]`;
  } catch {
    return JSON.stringify({ error: "mcp_tool_log_stringify_failed" });
  }
}

type McpCallToolResultShape = {
  content?: Array<{ type?: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
  [key: string]: unknown;
};

function summarizeMcpToolResultForLog(result: McpCallToolResultShape): {
  isError: boolean;
  contentBlocks: number;
  approxTextChars: number;
  firstBlockType?: string;
} {
  const blocks = result.content ?? [];
  let approxTextChars = 0;
  for (const b of blocks) {
    if (b && typeof b === "object" && typeof b.text === "string") approxTextChars += b.text.length;
  }
  return {
    isError: Boolean(result.isError),
    contentBlocks: blocks.length,
    approxTextChars,
    firstBlockType: blocks[0]?.type,
  };
}

function redactInlineSecretsInResponseLogText(s: string): string {
  let o = s;
  o = o.replace(/Bearer\s+[A-Za-z0-9._+\/-]+/gi, "Bearer [redacted]");
  if (/^eyJ[A-Za-z0-9_-]+\.eyJ/.test(o.slice(0, 120))) return "[jwt:redacted]";
  return o;
}

function truncateForMcpResponseLog(s: string, max: number): { text: string; cut: boolean } {
  if (s.length <= max) return { text: s, cut: false };
  return { text: `${s.slice(0, max)}…[+${s.length - max} chars omitted]`, cut: true };
}

/** Serializa `content[]` de la respuesta MCP para logs (texto completo hasta los topes; bloques no-texto acotados). */
function buildMcpToolResponseBodyForLog(result: McpCallToolResultShape): {
  isError: boolean;
  content: unknown[];
  responseTruncated: boolean;
} {
  const blocks = result.content ?? [];
  let budget = MCP_TOOL_LOG_RESPONSE_TOTAL_MAX;
  let responseTruncated = false;
  const content: unknown[] = [];

  for (const b of blocks) {
    if (budget <= 0) {
      responseTruncated = true;
      break;
    }
    if (!b || typeof b !== "object") {
      content.push(b);
      continue;
    }
    const block = b as Record<string, unknown>;
    const typ = block.type;

    if (typ === "text" && typeof block.text === "string") {
      const maxThis = Math.min(MCP_TOOL_LOG_RESPONSE_BLOCK_MAX, budget);
      const redacted = redactInlineSecretsInResponseLogText(block.text);
      const { text, cut } = truncateForMcpResponseLog(redacted, maxThis);
      if (cut) responseTruncated = true;
      budget -= text.length;
      content.push({ type: "text", text });
      continue;
    }

    const shaped = redactToolArgumentsForLog(block) as Record<string, unknown>;
    for (const [k, v] of Object.entries(shaped)) {
      if (typeof v === "string" && v.length > 8000) {
        shaped[k] = `${v.slice(0, 8000)}…[+${v.length - 8000}]`;
        responseTruncated = true;
      }
    }
    const ser = JSON.stringify(shaped);
    budget -= Math.min(ser.length, 12_000);
    content.push(shaped);
  }

  if (blocks.length > content.length) responseTruncated = true;

  return {
    isError: Boolean(result.isError),
    content,
    responseTruncated,
  };
}

function mcpLogToolInvocationStart(toolName: string, args: unknown): void {
  const argObj = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const line = stringifyMcpToolLogPayload({
    ts: new Date().toISOString(),
    event: "mcp_tool_call_start",
    tool: toolName,
    argumentKeys: Object.keys(argObj),
    arguments: redactToolArgumentsForLog(args ?? {}),
  });
  logger.info(`[mcp-ariadne] ${line}`);
}

function mcpLogToolInvocationEnd(toolName: string, startedMs: number, result: McpCallToolResultShape): void {
  const ms = Date.now() - startedMs;
  const line = stringifyMcpToolLogPayload({
    ts: new Date().toISOString(),
    event: "mcp_tool_call_end",
    tool: toolName,
    ms,
    resultSummary: summarizeMcpToolResultForLog(result),
    result: buildMcpToolResponseBodyForLog(result),
  });
  logger.info(`[mcp-ariadne] ${line}`);
}

function mcpLogToolInvocationFailure(toolName: string, args: unknown, startedMs: number, err: unknown): void {
  const ms = Date.now() - startedMs;
  const line = stringifyMcpToolLogPayload({
    ts: new Date().toISOString(),
    event: "mcp_tool_call_error",
    tool: toolName,
    ms,
    arguments: redactToolArgumentsForLog(args ?? {}),
    error: err instanceof Error ? err.message : String(err),
  });
  console.error(`[mcp-ariadne] ${line}`);
}

/** Intervalo entre logs de progreso para `ask_codebase` (ingest puede tardar minutos). `0`/`off` desactiva. */
function mcpAskCodebaseProgressLogIntervalMs(): number {
  const raw = process.env.MCP_ASK_CODEBASE_PROGRESS_LOG_MS?.trim() ?? "";
  const lower = raw.toLowerCase();
  if (lower === "0" || lower === "off" || lower === "false" || lower === "no") return 0;
  const n = parseInt(raw || "60000", 10);
  return Number.isFinite(n) && n > 0 ? n : 60_000;
}

const MCP_INSTRUCTIONS = `AriadneSpecs Oracle: herramientas de análisis de código indexado en FalkorDB.

## API Nest (paridad con el explorador)

Las herramientas **get_component_graph** y **get_legacy_impact** pueden llamar a \`ARIADNE_API_URL\` (default http://localhost:3000). El API Nest acepta JWT de sesión web o **Secret MCP** (\`ari_…\`) en \`Authorization: Bearer\`. Configura Cursor con el mismo Bearer (Perfil → Secret MCP, o JWT) en los headers HTTP del servidor MCP — el proceso lo reenvía al Nest sin variables de sesión extra. Sin Bearer válido, esas llamadas fallan y el MCP usa fallback Falkor (resultados pueden diferir del UI).

## projectId (OBLIGATORIO)

Si existe \`.ariadne-project\` en la raíz del workspace, **léelo primero** y usa su \`projectId\` en **todas** las llamadas (get_project_analysis, get_legacy_impact, validate_before_edit, etc.). Sin projectId muchas herramientas fallan o devuelven resultados incorrectos.

Formato: \`{ "projectId": "uuid" }\`

Si no hay .ariadne-project: el servidor puede inferir el proyecto vía ingest (heurística \`projectKey\`/\`repoSlug\` en la ruta del IDE) o vía el grafo Falkor. Ejecuta \`list_known_projects\` cuando necesites elegir explícitamente. Nunca inventes ni asumas IDs.

## Brownfield / The Forge (multi-root)

\`list_known_projects\` devuelve \`id\` = **UUID del proyecto Ariadne** (workspace) y \`roots[]\` = repos Git indexados (\`roots[].id\`).

| Escenario | Tool MCP |
|-----------|----------|
| Import Forge con **varios repos** (front+back) | **\`export_brownfield_project_parity_pack\`** — \`projectId\` = UUID del **proyecto** (\`id\`, no \`roots[].id\`) |
| Solo MDD fusionado multi-root | **\`generate_merged_project_mdd\`** — mismo \`projectId\` |
| Un solo repo / MDD acotado | \`export_brownfield_parity_pack\` (\`repositoryId\`) o \`generate_legacy_documentation\` (\`scope.repoIds\`) |

El MDD incluye \`multi_root\` (repos, roles, \`cross_repo_links\`). Multi-repo en Git **no** implica deploy runtime independiente.

Guía completa: \`docs://guias/brownfield-forge-mcp\` (Docs MCP).`;

/**
 * Ensambla el servidor MCP con handlers para cada nombre de herramienta.
 *
 * @returns Instancia {@link Server} con `ListTools` y `CallTool` registrados.
 * @see {@link ./mcp-tools.doc.ts} catálogo JSDoc de todas las tools (revisiones y dependencias INGEST/API/Falkor).
 */
function createMcpServer(): Server {
  const srv = new Server(
    { name: "AriadneSpecs-Oracle", version: "1.0.0" },
    { capabilities: { tools: {} }, instructions: MCP_INSTRUCTIONS }
  );

  /**
   * Publica el manifiesto MCP (`tools[]`) con `name`, `description` e `inputSchema` JSON Schema.
   * Cada entrada tiene paridad 1:1 con el `switch`/`if` del handler {@link CallToolRequestSchema} más abajo.
   *
   * @see {@link ./mcp-tools.doc.ts}
   */
  srv.setRequestHandler(ListToolsRequestSchema, async () => {
    if (isMcpToolInvocationLoggingEnabled()) {
      console.log(
        `[mcp-ariadne] ${JSON.stringify({ ts: new Date().toISOString(), event: "mcp_list_tools" })}`,
      );
    }
    return {
  tools: [
    {
      name: "list_known_projects",
      description:
        "Lista workspaces indexados en Ariadne. Cada entrada: `id` = UUID **proyecto** Ariadne (usar en export_brownfield_project_parity_pack / generate_merged_project_mdd); `roots[]` = repos Git (`roots[].id` = UUID repo para tools mono-repo). Ejecutar al inicio de sesión Forge/Cursor. Ver docs://guias/brownfield-forge-mcp para import multi-root.",
      inputSchema: {
        type: "object" as const,
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "get_component_graph",
      description:
        "Árbol de dependencias de un componente. Preferencia: API Nest GET /api/graph/component (mismo grafo que el explorador: RENDERS, USES_HOOK, IMPORTS, graphHints). Auth: mismo \`Authorization: Bearer\` que envías al MCP desde Cursor (**Secret MCP** \`ari_…\` o JWT de sesión web); el servidor lo reenvía al Nest. Si la API no está disponible o falla, fallback Falkor genérico (puede diferir).",
      inputSchema: {
        type: "object" as const,
        properties: {
          componentName: { type: "string", description: "Nombre del componente" },
          depth: { type: "number", description: "Profundidad del grafo (default 2)" },
          projectId: { type: "string", description: "ID del proyecto (opcional). Usar list_known_projects para obtener IDs." },
          currentFilePath: { type: "string", description: "Ruta del archivo que el IDE está editando (opcional). Si no hay projectId, se infiere el proyecto." },
        },
        required: ["componentName"],
        additionalProperties: false,
      },
    },
    {
      name: "get_legacy_impact",
      description:
        "Dependientes de un nodo (quién lo llama o lo renderiza). Preferencia: API Nest GET /api/graph/impact (CALLS/RENDERS e IMPORTS entre shards). Auth: mismo `Authorization: Bearer` hacia MCP (Secret MCP `ari_…` de Perfil o JWT web), reenviado al Nest. Fallback Falkor: solo CALLS|RENDERS*.",
      inputSchema: {
        type: "object" as const,
        properties: {
          nodeName: { type: "string", description: "Nombre del componente o función" },
          projectId: { type: "string", description: "ID del proyecto (opcional). Usar list_known_projects para obtener IDs." },
          currentFilePath: { type: "string", description: "Ruta del archivo que el IDE está editando (opcional). Si no hay projectId, se infiere el proyecto." },
        },
        required: ["nodeName"],
        additionalProperties: false,
      },
    },
    {
      name: "get_contract_specs",
      description:
        "Extrae las Props y firmas detectadas por el Scanner para el componente. Forzar a la IA a usar nombres y tipos reales del grafo.",
      inputSchema: {
        type: "object" as const,
        properties: {
          componentName: { type: "string", description: "Nombre del componente" },
          projectId: { type: "string", description: "ID del proyecto (opcional). Usar list_known_projects para obtener IDs." },
          currentFilePath: { type: "string", description: "Ruta del archivo que el IDE está editando (opcional). Si no hay projectId, se infiere el proyecto." },
        },
        required: ["componentName"],
        additionalProperties: false,
      },
    },
    {
      name: "get_functions_in_file",
      description:
        "Lista las funciones (y componentes) que contiene un archivo según el grafo (File CONTAINS Function/Component). Requiere projectId o currentFilePath para evitar mezcla de proyectos.",
      inputSchema: {
        type: "object" as const,
        properties: {
          path: { type: "string", description: "Ruta del archivo (grafo o IDE)" },
          projectId: { type: "string", description: "ID del proyecto (requerido si no hay currentFilePath). Usar list_known_projects." },
          currentFilePath: { type: "string", description: "Ruta del archivo que el IDE está editando (requerido si no hay projectId). Se infiere el proyecto." },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
    {
      name: "get_import_graph",
      description:
        "Devuelve el grafo de imports de un archivo: qué importa (IMPORTS) y qué exporta (CONTAINS). Requiere projectId o currentFilePath para evitar mezcla de proyectos.",
      inputSchema: {
        type: "object" as const,
        properties: {
          filePath: { type: "string", description: "Ruta del archivo (grafo o IDE)" },
          projectId: { type: "string", description: "ID del proyecto (requerido si no hay currentFilePath). Usar list_known_projects." },
          currentFilePath: { type: "string", description: "Ruta del archivo que el IDE está editando (requerido si no hay projectId). Se infiere el proyecto." },
        },
        required: ["filePath"],
        additionalProperties: false,
      },
    },
    {
      name: "get_file_content",
      description:
        "Obtiene el contenido de un archivo del repo (Bitbucket/GitHub). Requiere INGEST_URL. Esquema BD: Prisma → prisma/schema.prisma; TypeORM → primero execute_cypher MATCH (m:Model) para obtener path. Rutas API: NestController. Env: .env.example.",
      inputSchema: {
        type: "object" as const,
        properties: {
          path: { type: "string", description: "Ruta del archivo (grafo, IDE o relativa)" },
          projectId: { type: "string", description: "ID del proyecto/repo (requerido si no hay currentFilePath)" },
          currentFilePath: { type: "string", description: "Ruta del IDE para inferir projectId (opcional)" },
          ref: { type: "string", description: "Rama (default: defaultBranch del repo)" },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
    {
      name: "validate_before_edit",
      description:
        "OBLIGATORIO antes de editar un componente o función. Devuelve impacto legacy + contrato de props. Usar para evitar alucinaciones y rupturas.",
      inputSchema: {
        type: "object" as const,
        properties: {
          nodeName: { type: "string", description: "Nombre del componente o función a modificar" },
          projectId: { type: "string", description: "ID del proyecto (opcional)" },
          currentFilePath: { type: "string", description: "Ruta del archivo (opcional, para inferir proyecto)" },
        },
        required: ["nodeName"],
        additionalProperties: false,
      },
    },
    {
      name: "semantic_search",
      description:
        "Búsqueda híbrida (vector + keyword) sobre el grafo. Sin projectId: alcance global. Con projectId: acepta **id del proyecto Ariadne** o **id del repositorio** (`roots[].id`); se resuelve vía ingest al `projectId` almacenado en Falkor y, en multi-root, se filtra por `repoId`.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Términos de búsqueda (ej. login, form, auth)" },
          projectId: {
            type: "string",
            description:
              "UUID de proyecto Ariadne o de repositorio (`list_known_projects`). En multi-root suele ser `roots[].id`; el servidor mapea al projectId de nodos Falkor.",
          },
          limit: { type: "number", description: "Máximo de resultados (default env MCP_SEMANTIC_SEARCH_DEFAULT o 200; tope MCP_SEMANTIC_SEARCH_MAX)" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "sync_local_file",
      description:
        "Sincronización Local Live: consume los eventos de guardado o buffer del editor (Cursor) para alimentar el grafo FalkorDB de inmediato sin commit ni push a Bitbucket.",
      inputSchema: {
        type: "object" as const,
        properties: {
          filePath: { type: "string", description: "Ruta del archivo (relativa al workspace o absoluta)" },
          content: { type: "string", description: "Contenido del archivo en el editor de Cursor (opcional; si se omite, se lee del disco local)" },
          projectId: { type: "string", description: "UUID de proyecto o repo (`roots[].id`). Opcional, se infiere si se omite." },
          repoId: { type: "string", description: "UUID de repositorio (opcional)" },
        },
        required: ["filePath"],
        additionalProperties: false,
      },
    },
    {
      name: "query_graph",
      description:
        "Ejecuta Cypher read-only contra FalkorDB (sin LLM). Rechaza MERGE/CREATE/DELETE/SET/REMOVE/DROP/CALL {. Con sharding activo, `projectId` es obligatorio. Añade LIMIT si falta (default 50).",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Consulta Cypher read-only (MATCH/RETURN)" },
          projectId: {
            type: "string",
            description: "UUID de proyecto o repo (`roots[].id`). Obligatorio con FALKOR_SHARD_BY_PROJECT.",
          },
          limit: { type: "number", description: "Máximo de filas (default 50)" },
          currentFilePath: { type: "string", description: "Ruta del IDE para inferir projectId (opcional)" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "get_project_analysis",
      description:
        "Obtiene diagnóstico de deuda técnica, código duplicado, recomendaciones de reingeniería o auditoría heurística de seguridad (secretos). Requiere INGEST_URL. Duplicados requiere embed-index previo. `projectId` puede ser el id del proyecto Ariadne o `roots[].id` (repo); si es proyecto multi-root, usa `currentFilePath` para resolver el repo o pasa el id del repo.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: {
            type: "string",
            description:
              "ID de proyecto Ariadne o de repositorio (list_known_projects). Si solo hay currentFilePath, se infiere el proyecto.",
          },
          currentFilePath: {
            type: "string",
            description:
              "Ruta del archivo en el IDE (opcional). Multi-root: necesaria si projectId es el proyecto y hay varios roots.",
          },
          mode: {
            type: "string",
            description: "diagnostico | duplicados | reingenieria | codigo_muerto | seguridad (default: diagnostico)",
            enum: ["diagnostico", "duplicados", "reingenieria", "codigo_muerto", "seguridad"],
          },
          scope: {
            type: "object",
            description:
              "Opcional: acotar análisis (repoIds = roots[].id, prefijos de path, globs de exclusión). Alineado con chat/modification-plan.",
            properties: {
              repoIds: { type: "array", items: { type: "string" } },
              includePathPrefixes: { type: "array", items: { type: "string" } },
              excludePathGlobs: { type: "array", items: { type: "string" } },
            },
            additionalProperties: false,
          },
          crossPackageDuplicates: {
            type: "boolean",
            description: "Modo duplicados: incluir pares con un solo extremo en el foco (cross-boundary).",
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: "generate_legacy_documentation",
      description:
        "**MDD de un repo o scope acotado** (TheForge SDD). Retrieve determinista + JSON MDD (`summary`, `openapi_spec`, `entities`, `api_contracts`, `business_logic`, `infrastructure`, `risk_report`, `evidence_paths`, opcional `multi_root`). **No uses esta tool para import Forge multi-root completo** — usa `export_brownfield_project_parity_pack` con el UUID del **proyecto** Ariadne. Requiere INGEST_URL. Parámetros: `projectId` (proyecto o `roots[].id`), opcional `scope.repoIds`, `currentFilePath`.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: {
            type: "string",
            description: "ID del proyecto Ariadne o roots[].id del repo (list_known_projects)",
          },
          currentFilePath: {
            type: "string",
            description: "Ruta absoluta en el IDE (opcional): ancla el repo en multi-root",
          },
          scope: {
            type: "object",
            description: "Acotar multi-root: repoIds, prefijos de path, globs de exclusión.",
            properties: {
              repoIds: { type: "array", items: { type: "string" } },
              includePathPrefixes: { type: "array", items: { type: "string" } },
              excludePathGlobs: { type: "array", items: { type: "string" } },
            },
            additionalProperties: false,
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: "ask_codebase",
      description:
        "Pregunta en lenguaje natural sobre el código (Q&A humano). **No uses esta tool para generar la documentación legacy de partida** — usa `generate_legacy_documentation`. Default MCP (sin `responseMode`): `default` — prosa + sintetizador + ReAct. responseMode=evidence_first: JSON MDD puntual. responseMode=raw_evidence: JSON crudo (debug). Requiere INGEST_URL. Para filesToModify usa get_modification_plan.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "string", description: "ID del proyecto (list_known_projects)" },
          question: { type: "string", description: "Pregunta en lenguaje natural (ej. qué hace este proyecto, cómo está implementado el login, qué tipos de cotizaciones hay)" },
          currentFilePath: { type: "string", description: "Ruta del archivo que el IDE está editando (opcional, para inferir projectId)" },
          scope: {
            type: "object",
            description: "Opcional: acotar multi-root (repoIds = roots[].id, prefijos de path, globs de exclusión).",
            properties: {
              repoIds: { type: "array", items: { type: "string" } },
              includePathPrefixes: { type: "array", items: { type: "string" } },
              excludePathGlobs: { type: "array", items: { type: "string" } },
            },
            additionalProperties: false,
          },
          twoPhase: {
            type: "boolean",
            description: "Si true, el ingest prioriza un JSON de retrieval antes del contexto bruto (sintetizador). Default: variable CHAT_TWO_PHASE en ingest.",
          },
          responseMode: {
            type: "string",
            enum: ["default", "evidence_first", "raw_evidence"],
            description:
              "Omitido → **raw_evidence** (igual que The Forge evidencia bruta). default: prosa + sintetizador. evidence_first: JSON MDD 7 secciones. raw_evidence: JSON crudo; con deterministicRetriever por defecto true salvo que pases false.",
          },
          deterministicRetriever: {
            type: "boolean",
            description:
              "Solo aplica con responseMode raw_evidence (incluido el default cuando omites responseMode). Default **true** (retrieve fijo sin LLM). Pon **false** para ReAct + LLM en retrieve.",
          },
        },
        required: ["question"],
        additionalProperties: false,
      },
    },
    {
      name: "get_modification_plan",
      description:
        "Plan de modificación para flujo legacy (MaxPrime): devuelve filesToModify (array de { path, repoId } del grafo) y questionsToRefine (solo negocio). En multi-root, pasar projectId = roots[].id del repo objetivo (p. ej. frontend), no solo el id del proyecto Ariadne, para no depender del orden de repos. repoId en la respuesta indica el root afectado.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: {
            type: "string",
            description:
              "ID de proyecto Ariadne o ID de repositorio (roots[].id de list_known_projects). Preferir roots[].id del repo donde vive el código en proyectos multi-root.",
          },
          userDescription: { type: "string", description: "Descripción en lenguaje natural de la modificación que el usuario quiere hacer" },
          currentFilePath: {
            type: "string",
            description:
              "Ruta absoluta del archivo en el IDE (opcional). Con projectId de **proyecto** multi-root, el ingest usa esta ruta para anclar el repositorio (junto con scope.repoIds).",
          },
          questionsMode: {
            type: "string",
            enum: ["business", "technical", "both"],
            description:
              "Preguntas de afinación: business (negocio, default), technical (implementación), both (mix acotado).",
          },
          scope: {
            type: "object",
            description: "Opcional: filtrar filesToModify por repoIds / prefijos / globs.",
            properties: {
              repoIds: { type: "array", items: { type: "string" } },
              includePathPrefixes: { type: "array", items: { type: "string" } },
              excludePathGlobs: { type: "array", items: { type: "string" } },
            },
            additionalProperties: false,
          },
        },
        required: ["userDescription"],
        additionalProperties: false,
      },
    },
    {
      name: "validate_change_plan",
      description:
        "Gate 2: audita un plan de cambio estructurado (ChangePlan JSON) contra el grafo indexado. Devuelve veredicto APPROVED | APPROVED_WITH_WARNINGS | BLOCKED, checks deterministas (archivos, símbolos, overlap con modification-plan, cobertura tasks). Usar tras generar tasks/MDD en The Forge o antes de editar en Cursor.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: {
            type: "string",
            description:
              "ID de proyecto Ariadne o roots[].id (multi-root). Preferir roots[].id del repo objetivo.",
          },
          schemaVersion: { type: "string", enum: ["1.0"] },
          source: { type: "string", enum: ["theforge", "cursor", "ci", "mcp"] },
          changeDescription: { type: "string" },
          changeScope: { type: "object" },
          files: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                repoId: { type: "string" },
                changeType: { type: "string", enum: ["add", "modify", "delete", "unknown"] },
                symbols: { type: "array", items: { type: "string" } },
              },
              required: ["path"],
            },
          },
          apiChanges: { type: "array" },
          tasks: { type: "array" },
          referencePlan: { type: "object" },
          scope: { type: "object" },
        },
        required: ["projectId", "files"],
        additionalProperties: true,
      },
    },
    {
      name: "validate_tasks_json",
      description:
        "Gate 2 post-deliverable: mapea Forge tasksJson (migration_tasks) a ChangePlan y valida contra el grafo. Si verdict===BLOCKED, no aceptar el deliverable. Usar tras legacy_generate_deliverables.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: {
            type: "string",
            description: "ID de proyecto Ariadne o roots[].id",
          },
          tasksJson: {
            type: "object",
            description: "Payload tasksJson v2 de Forge (o { tasks: [...] })",
          },
          changeDescription: { type: "string" },
        },
        required: ["projectId", "tasksJson"],
        additionalProperties: true,
      },
    },
    // --- Refactorización segura (árbol de llamadas) ---
    {
      name: "get_definitions",
      description:
        "Localiza el origen exacto de una clase o función (archivo, líneas). Evita que la IA asuma ubicaciones incorrectas al refactorizar.",
      inputSchema: {
        type: "object" as const,
        properties: {
          symbolName: { type: "string", description: "Nombre del componente, función o modelo" },
          projectId: { type: "string", description: "ID del proyecto (opcional). Usar list_known_projects." },
          currentFilePath: { type: "string", description: "Ruta del archivo (opcional, para inferir projectId)" },
        },
        required: ["symbolName"],
        additionalProperties: false,
      },
    },
    {
      name: "get_references",
      description:
        "Encuentra todos los lugares donde se usa un símbolo (archivos, líneas si disponible). Evita romper archivos no abiertos al renombrar.",
      inputSchema: {
        type: "object" as const,
        properties: {
          symbolName: { type: "string", description: "Nombre del componente o función" },
          projectId: { type: "string", description: "ID del proyecto (opcional)" },
          currentFilePath: { type: "string", description: "Ruta del archivo (opcional, para inferir projectId)" },
        },
        required: ["symbolName"],
        additionalProperties: false,
      },
    },
    {
      name: "get_implementation_details",
      description:
        "Expone la firma, tipos y contratos (props, descripción, endpoints) para asegurar que el nuevo código respete la estructura existente.",
      inputSchema: {
        type: "object" as const,
        properties: {
          symbolName: { type: "string", description: "Nombre del componente o función" },
          projectId: { type: "string", description: "ID del proyecto (opcional)" },
          currentFilePath: { type: "string", description: "Ruta del archivo (opcional)" },
        },
        required: ["symbolName"],
        additionalProperties: false,
      },
    },
    // --- Código muerto ---
    {
      name: "trace_reachability",
      description:
        "Rastrea qué funciones/componentes nunca son llamados desde puntos de entrada (rutas, index, main). Identifica código muerto.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "string", description: "ID del proyecto (list_known_projects)" },
          currentFilePath: { type: "string", description: "Ruta del archivo (opcional, para inferir projectId)" },
        },
        required: ["projectId"],
        additionalProperties: false,
      },
    },
    {
      name: "check_export_usage",
      description:
        "Identifica componentes o funciones exportadas que no tienen importaciones activas ni son usadas en el monorepo.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "string", description: "ID del proyecto" },
          filePath: { type: "string", description: "Archivo específico (opcional; si no se da, analiza todo el proyecto)" },
          currentFilePath: { type: "string", description: "Ruta del IDE (opcional)" },
        },
        required: ["projectId"],
        additionalProperties: false,
      },
    },
    // --- Análisis de impacto ---
    {
      name: "get_affected_scopes",
      description:
        "Si modificas la función/componente A, devuelve qué funciones B,C,D y archivos de tests se verían afectados.",
      inputSchema: {
        type: "object" as const,
        properties: {
          nodeName: { type: "string", description: "Nombre del componente o función a modificar" },
          projectId: { type: "string", description: "ID del proyecto (opcional)" },
          currentFilePath: { type: "string", description: "Ruta del archivo (opcional)" },
          includeTestFiles: { type: "boolean", description: "Incluir archivos *.test.* y *.spec.* (default true)" },
        },
        required: ["nodeName"],
        additionalProperties: false,
      },
    },
    {
      name: "check_breaking_changes",
      description:
        "Compara firma antes/después. Si la IA elimina un parámetro usado en N sitios, lanza alerta de contexto.",
      inputSchema: {
        type: "object" as const,
        properties: {
          nodeName: { type: "string", description: "Nombre del componente o función" },
          removedParams: { type: "array", items: { type: "string" }, description: "Parámetros que se planean eliminar" },
          projectId: { type: "string", description: "ID del proyecto (opcional)" },
          currentFilePath: { type: "string", description: "Ruta del archivo (opcional)" },
        },
        required: ["nodeName"],
        additionalProperties: false,
      },
    },
    // --- Código sin duplicación ---
    {
      name: "find_similar_implementations",
      description:
        "Búsqueda semántica: antes de escribir una función (ej. validación de email), consulta si ya existe código similar.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Descripción de lo que se busca (ej. validación de email, parse de fecha)" },
          projectId: { type: "string", description: "ID del proyecto (opcional, limita ámbito)" },
          limit: { type: "number", description: `Máximo resultados (default env MCP_FIND_SIMILAR_DEFAULT, típ. ${mcpLimits.findSimilarDefault}; tope MCP_FIND_SIMILAR_MAX)` },
          currentFilePath: { type: "string", description: "Ruta del archivo (opcional)" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "get_project_standards",
      description:
        "Recupera fragmentos de configuración (Prettier, ESLint, tsconfig) para que el nuevo código sea indistinguible del existente.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "string", description: "ID del proyecto (list_known_projects)" },
          currentFilePath: { type: "string", description: "Ruta del archivo (opcional)" },
        },
        required: ["projectId"],
        additionalProperties: false,
      },
    },
    // --- Workflow (paso 2: contexto) ---
    {
      name: "get_file_context",
      description:
        "Combina contenido del archivo + imports + exports. Paso 2 del flujo: search_codebase → get_file_context → validate/apply.",
      inputSchema: {
        type: "object" as const,
        properties: {
          filePath: { type: "string", description: "Ruta del archivo" },
          projectId: { type: "string", description: "ID del proyecto (requerido si no hay currentFilePath)" },
          currentFilePath: { type: "string", description: "Ruta del IDE (opcional)" },
          ref: { type: "string", description: "Rama (opcional)" },
        },
        required: ["filePath"],
        additionalProperties: false,
      },
    },
    // --- Pre-flight check (revisión quirúrgica preventiva) ---
    {
      name: "detect_changes",
      description:
        "Blast radius de cambios locales contra el grafo FalkorDB. Modos: staged (default, git diff --cached), unstaged (git diff), all (git diff HEAD). Devuelve JSON: changedFiles, affectedSymbols[], summary { high, medium, low }. Requiere workspaceRoot o diff/stagedDiff.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "string", description: "ID del proyecto (list_known_projects)" },
          mode: {
            type: "string",
            description: "staged | unstaged | all (default: staged)",
          },
          workspaceRoot: { type: "string", description: "Ruta del repo donde ejecutar git diff" },
          diff: { type: "string", description: "Salida cruda de git diff (alternativa remota)" },
          stagedDiff: { type: "string", description: "Alias de diff para compatibilidad con analyze_local_changes" },
          currentFilePath: { type: "string", description: "Ruta del archivo (opcional, inferir projectId)" },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: "analyze_local_changes",
      description:
        "[Deprecated — usar detect_changes] Pre-flight check: revisa cambios en stage contra FalkorDB. Equivalente a detect_changes con mode=staged; devuelve Markdown.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "string", description: "ID del proyecto en Ariadne (list_known_projects). Necesario para el grafo si no se pasa currentFilePath." },
          mode: { type: "string", description: "staged | unstaged | all (default: staged)" },
          workspaceRoot: { type: "string", description: "Ruta absoluta o relativa al directorio raíz del repo. Si se pasa, el MCP ejecuta git diff aquí." },
          stagedDiff: { type: "string", description: "Salida cruda de git diff --cached (alternativa cuando el MCP no tiene acceso al filesystem del repo, ej. MCP remoto)." },
          diff: { type: "string", description: "Salida cruda de git diff (alias de stagedDiff con mode explícito)" },
          currentFilePath: { type: "string", description: "Ruta del archivo que el IDE está editando (opcional, para inferir projectId)." },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: "get_sync_status",
      description:
        "Consulta el estado de la última sincronización del proyecto (en curso, completado, fallido). Útil para saber si el grafo está actualizado.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "string", description: "ID del proyecto (list_known_projects)" },
          currentFilePath: { type: "string", description: "Ruta del archivo para inferir proyecto (opcional)" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "get_c4_model",
      description:
        "Devuelve el modelo C4 (JSON) del proyecto. Niveles: context, container, component (Falkor). Si no hay snapshot, intenta POST generate.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "string", description: "UUID del proyecto Ariadne" },
          level: {
            type: "string",
            description: "Nivel C4",
            enum: ["context", "container", "component"],
          },
          regenerate: {
            type: "boolean",
            description: "Si true, fuerza POST /c4/generate antes de leer",
          },
          useLlm: {
            type: "boolean",
            description: "Solo context: narrativa LLM (actores + descripciones)",
          },
          containerKey: {
            type: "string",
            description: "Solo component: clave del container (ej. frontend, ingest)",
          },
        },
        required: ["projectId"],
        additionalProperties: false,
      },
    },
    {
      name: "generate_c4_diagram",
      description:
        "Regenera diagramas C4 (Archify HTML) y devuelve URLs relativas al ingest. Niveles: context, container, component.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "string", description: "UUID del proyecto Ariadne" },
          level: {
            type: "string",
            description: "Nivel C4 a regenerar",
            enum: ["context", "container", "component"],
          },
          levels: {
            type: "array",
            items: { type: "string", enum: ["context", "container", "component"] },
            description: "Varios niveles en una sola llamada (opcional)",
          },
          useLlm: {
            type: "boolean",
            description: "Solo context: narrativa LLM",
          },
          containerKey: {
            type: "string",
            description: "Solo component: clave del container",
          },
        },
        required: ["projectId"],
        additionalProperties: false,
      },
    },
    {
      name: "diff_c4_model",
      description:
        "Compara dos snapshots C4 (JSON diff + HTML Archify compare si está disponible). Requiere ids de GET /c4/snapshots.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "string", description: "UUID del proyecto Ariadne" },
          fromSnapshotId: { type: "string", description: "Snapshot origen (más antiguo)" },
          toSnapshotId: { type: "string", description: "Snapshot destino (más reciente)" },
        },
        required: ["projectId", "fromSnapshotId", "toSnapshotId"],
        additionalProperties: false,
      },
    },
    {
      name: "get_debt_report",
      description:
        "Genera un informe descriptivo sobre la deuda técnica: archivos huérfanos (dead code) y componentes con alta complejidad estructural.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "string", description: "ID del proyecto (list_known_projects)" },
          currentFilePath: { type: "string", description: "Ruta del archivo para inferir proyecto (opcional)" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "find_duplicates",
      description:
        "Busca fragmentos de lógica o componentes idénticos en el proyecto (análisis cross-package) basándose en huellas digitales de contenido.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "string", description: "ID del proyecto (list_known_projects)" },
          currentFilePath: { type: "string", description: "Ruta del archivo para inferir proyecto (opcional)" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "generate_navigation_map",
      description:
        "Genera un mapa de navegacion detallado del proyecto frontend. INPUT: projectId (obligatorio, de list_known_projects), scope (full|diff|diff-all), baselineSnapshot (Markdown previo para diff), showAll (bool). OUTPUT: Markdown estructurado con: framework detectado, cada ruta (URL, parametros, componente principal, subcomponentes, formularios con campos/tipos/validaciones, endpoints HTTP), y seccion de componentes compartidos entre rutas. Frameworks soportados: react-router-dom, next (pages + app router), tanstack-router, angular, vue-router, sveltekit, expo-router, remix. Detecta path aliases de tsconfig, apiClient centralizado, formularios estaticos y DynamicForm. Para cambios incrementales usa scope=diff con baselineSnapshot del stage previo.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "string", description: "ID del proyecto (list_known_projects) — requerido" },
          scope: { type: "string", description: "full (default, muestra todo) | diff (solo cambios) | diff-all (cambios + sin cambios)" },
          baselineSnapshot: { type: "string", description: "Snapshot Markdown previo para comparacion diff (opcional). Si no se pasa, scope=diff usa baselineStageId." },
          baselineStageId: { type: "string", description: "ID de la etapa base para recuperar snapshot de BD (opcional, solo si scope=diff y no hay baselineSnapshot)" },
          showAll: { type: "boolean", description: "En modo diff, incluir rutas sin cambios (default: false)" },
        },
        required: ["projectId"],
        additionalProperties: false,
      },
    },
    {
      name: "extract_design_tokens",
      description:
        "Busca en el codebase del proyecto archivos de tokens de diseño (Tailwind config, CSS custom properties, theme/token files), extrae y parsea sus valores, y retorna JSON estructurado con los tokens encontrados. No usa LLM — parse directo vía regex + Falkor.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "string", description: "ID del proyecto (list_known_projects) — requerido" },
        },
        required: ["projectId"],
        additionalProperties: false,
      },
    },
    {
      name: "export_brownfield_parity_pack",
      description:
        "Parity pack brownfield **mono-repo** (MDD + modificationPlanSeed + scaffold) para The Forge. Usa `repositoryId` = `roots[].id`. Para proyectos **multi-root** (front+back), preferir **`export_brownfield_project_parity_pack`** con UUID del proyecto. Alternativa legacy: `mergeProject: true` + `projectId` del proyecto. Snapshots post-sync por defecto (`preferSnapshots`); `live: true` fuerza rebuild.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: {
            type: "string",
            description: "UUID proyecto Ariadne (solo con mergeProject:true) o roots[].id si se usa como repo",
          },
          repositoryId: { type: "string", description: "UUID repositorio (roots[].id) — modo mono-repo" },
          mergeProject: {
            type: "boolean",
            description: "Legacy: true fusiona todos los roots. Preferir export_brownfield_project_parity_pack.",
          },
          preferSnapshots: {
            type: "boolean",
            description: "Usar snapshots MDD post-sync por repo (default true). false fuerza rebuild live.",
          },
          live: { type: "boolean", description: "Alias de preferSnapshots=false" },
          userDescription: { type: "string", description: "Descripción opcional para seed del modification-plan" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "export_brownfield_project_parity_pack",
      description:
        "**Import brownfield The Forge — proyecto multi-root.** Fusiona MDD de todos los repos del workspace Ariadne (front+back), incluye `multi_root`, `mddSources[]`, `mergeMode: project_multi_root`, modificationPlanSeed y scaffoldPreview. **Obligatorio:** `projectId` = UUID del **proyecto** (`list_known_projects[].id`, NO `roots[].id`). Consumidores: The Forge MCP, Cursor. Ver docs://guias/brownfield-forge-mcp.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: {
            type: "string",
            description: "UUID del proyecto Ariadne (campo id en list_known_projects, no roots[].id)",
          },
          userDescription: {
            type: "string",
            description: "Descripción para seed del modification-plan (default: brownfield baseline)",
          },
          preferSnapshots: {
            type: "boolean",
            description: "true (default): MDD persistido post-sync por repo. false: rebuild live por repo.",
          },
          live: { type: "boolean", description: "Si true, ignora snapshots y regenera MDD live por cada repo" },
        },
        required: ["projectId"],
        additionalProperties: false,
      },
    },
    {
      name: "generate_merged_project_mdd",
      description:
        "**MDD fusionado multi-root** sin parity pack completo. Une snapshots/live de cada repo + bloque `multi_root` con roles y enlaces cross-repo Falkor. **Obligatorio:** `projectId` = UUID del **proyecto** Ariadne. Usar cuando The Forge solo necesita el JSON MDD inicial (sin modificationPlanSeed). Ver docs://guias/brownfield-forge-mcp.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: {
            type: "string",
            description: "UUID del proyecto Ariadne (list_known_projects[].id)",
          },
          userDescription: { type: "string", description: "Texto de consulta en summary del MDD por repo" },
          preferSnapshots: { type: "boolean", description: "Default true — snapshots post-sync" },
          live: { type: "boolean", description: "true — rebuild live, ignora snapshots" },
        },
        required: ["projectId"],
        additionalProperties: false,
      },
    },
    {
      name: "generate_scaffold_from_mdd",
      description:
        "Genera esqueleto Nest/React/Prisma desde MDD persistido o live (sin lógica de negocio). Output: lista { path, content }.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "string", description: "roots[].id del repo" },
          repositoryId: { type: "string", description: "UUID repositorio" },
          targets: {
            type: "array",
            items: { type: "string", enum: ["nest", "react", "prisma"] },
            description: "Default: nest, react, prisma",
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: "review_diff",
      description:
        "Revisa cambios en código legacy y emite un reporte con hallazgos categorizados y puntuación de confianza. Acepta un diff en formato unificado (git diff) o URL de PR. Proyecto Ariadne para enriquecer con contexto legacy (dependencias, impacto, referencias). Ideal para revisar cambios hechos por agentes IA en sistemas sin tests.",
      inputSchema: {
        type: "object" as const,
        properties: {
          diff: { type: "string", description: "Texto del diff en formato unificado (git diff). Opcional si se proporciona prUrl." },
          prUrl: { type: "string", description: "URL del PR en GitHub/Bitbucket. Alternativa a diff." },
          projectId: { type: "string", description: "ID del proyecto Ariadne (opcional, para contexto del grafo)." },
          branch: { type: "string", description: "Rama base para comparación (default: main)." },
          repoPath: { type: "string", description: "Ruta absoluta del repo local (opcional)." },
        },
        required: [],
        additionalProperties: false,
      },
    },
  ],
};
  });

type GraphType = Awaited<ReturnType<typeof getGraph>>;

/** Verifica si existe un nodo con el nombre dado (Component, Function, Model, Hook). */
async function nodeExists(
  graph: GraphType,
  nodeName: string,
  projectId?: string | null
): Promise<boolean> {
  const params: Record<string, string> = { nodeName };
  if (projectId) params.projectId = projectId;
  const compWhere = projectId ? " WHERE n.projectId = $projectId" : "";
  const projFilter = projectId ? " AND n.projectId = $projectId" : "";
  const [cQ, fQ, mQ, hQ] = [
    `MATCH (n:Component {name: $nodeName})${compWhere} RETURN 1 AS x LIMIT 1`,
    `MATCH (n:Function) WHERE n.name = $nodeName${projFilter} RETURN 1 AS x LIMIT 1`,
    `MATCH (n:Model) WHERE n.name = $nodeName${projFilter} RETURN 1 AS x LIMIT 1`,
    `MATCH (n:Hook {name: $nodeName})${projectId ? " WHERE n.projectId = $projectId" : ""} RETURN 1 AS x LIMIT 1`,
  ];
  const [cR, fR, mR, hR] = await Promise.all([
    graph.query(cQ, { params }) as Promise<{ data?: unknown[][] }>,
    graph.query(fQ, { params }) as Promise<{ data?: unknown[][] }>,
    graph.query(mQ, { params }) as Promise<{ data?: unknown[][] }>,
    graph.query(hQ, { params }) as Promise<{ data?: unknown[][] }>,
  ]);
  if (((cR.data ?? []).length > 0) || ((fR.data ?? []).length > 0) || ((mR.data ?? []).length > 0) || ((hR.data ?? []).length > 0)) {
    return true;
  }
  // Component: parser infiere PascalCase desde path (usePauta.tsx → UsePauta)
  const pascalName = nodeName.charAt(0).toUpperCase() + nodeName.slice(1);
  if (pascalName !== nodeName) {
    const cPascalParams: Record<string, string> = { altName: pascalName };
    if (projectId) cPascalParams.projectId = projectId;
    const cPascalQ = `MATCH (n:Component {name: $altName})${compWhere} RETURN 1 AS x LIMIT 1`;
    const cPascalR = (await graph.query(cPascalQ, { params: cPascalParams })) as { data?: unknown[][] };
    if ((cPascalR.data ?? []).length > 0) return true;
  }
  return false;
}

/** Devuelve el nombre real en el grafo (ej. UsePauta para Component cuando se pasa usePauta). */
async function resolveNodeName(
  graph: GraphType,
  nodeName: string,
  projectId?: string | null
): Promise<string> {
  const params: Record<string, string> = { nodeName };
  if (projectId) params.projectId = projectId;
  const compWhere = projectId ? " WHERE n.projectId = $projectId" : "";
  const projFilter = projectId ? " AND n.projectId = $projectId" : "";
  const [cR, fR, mR, hR] = await Promise.all([
    graph.query(`MATCH (n:Component {name: $nodeName})${compWhere} RETURN 1 AS x LIMIT 1`, { params }) as Promise<{ data?: unknown[][] }>,
    graph.query(`MATCH (n:Function) WHERE n.name = $nodeName${projFilter} RETURN 1 AS x LIMIT 1`, { params }) as Promise<{ data?: unknown[][] }>,
    graph.query(`MATCH (n:Model) WHERE n.name = $nodeName${projFilter} RETURN 1 AS x LIMIT 1`, { params }) as Promise<{ data?: unknown[][] }>,
    graph.query(`MATCH (n:Hook {name: $nodeName})${projectId ? " WHERE n.projectId = $projectId" : ""} RETURN 1 AS x LIMIT 1`, { params }) as Promise<{ data?: unknown[][] }>,
  ]);
  if ((cR.data ?? []).length > 0 || (fR.data ?? []).length > 0 || (mR.data ?? []).length > 0 || (hR.data ?? []).length > 0) {
    return nodeName;
  }
  const pascalName = nodeName.charAt(0).toUpperCase() + nodeName.slice(1);
  if (pascalName !== nodeName) {
    const cPascalParams: Record<string, string> = { altName: pascalName };
    if (projectId) cPascalParams.projectId = projectId;
    const cPascalR = (await graph.query(`MATCH (n:Component {name: $altName})${compWhere} RETURN 1 AS x LIMIT 1`, { params: cPascalParams })) as { data?: unknown[][] };
    if ((cPascalR.data ?? []).length > 0) return pascalName;
  }
  return nodeName; // fallback
}

/**
 * Coincidencia para `semantic_search` fallback: frase completa O cualquier token (≥2 chars)
 * tras dividir por no-alfanumérico. Evita que consultas tipo "API routes endpoints" devuelvan 0
 * si ningún nodo contiene la frase literal entera.
 */
function textMatchesQuery(haystack: string, query: string): boolean {
  const h = haystack.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q || !h) return false;
  if (h.includes(q)) return true;
  const tokens = q.split(/[^a-z0-9áéíóúñü/_-]+/i).filter((t) => t.length >= 2);
  if (tokens.length === 0) return false;
  return tokens.some((t) => h.includes(t));
}

/** FalkorDB node client returns rows as objects {colName: value}, not arrays. */
function _rv<T>(row: Record<string, unknown> | unknown[], keyOrIdx: string | number): T | undefined {
  if (Array.isArray(row)) return (row as unknown[])[typeof keyOrIdx === "number" ? keyOrIdx : 0] as T | undefined;
  return (row as Record<string, unknown>)[String(keyOrIdx)] as T | undefined;
}

/** Normaliza fila (objeto o array) a valor por clave. Objeto usa key; array usa headers para mapear. */
function _gr(row: Record<string, unknown> | unknown[], key: string, headers?: string[]): unknown {
  const obj = row as Record<string, unknown>;
  if (obj != null && !Array.isArray(row) && key in obj) return obj[key];
  if (Array.isArray(row) && headers) {
    const i = headers.indexOf(key);
    return i >= 0 ? row[i] : row[0];
  }
  return Array.isArray(row) ? row[0] : undefined;
}

/** Cast FalkorDB data to object rows (client returns objects keyed by RETURN aliases). */
function asObjRows(data: unknown): Array<Record<string, unknown>> {
  return (data ?? []) as unknown as Array<Record<string, unknown>>;
}

async function handleDetectChangesTool(
  args: Record<string, unknown> | undefined,
  format: "json" | "markdown",
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const projectId = (args?.projectId as string) ?? "";
  let resolvedProjectId = projectId;
  if (!resolvedProjectId && (args?.currentFilePath as string)) {
    resolvedProjectId = (await applyShardingInference(undefined, (args?.currentFilePath as string) ?? "")) ?? "";
  }
  if (!resolvedProjectId) {
    return {
      content: [{ type: "text", text: "**Error:** Se requiere `projectId` o `currentFilePath` para consultar el grafo. Usa `list_known_projects` para IDs." }],
      isError: true,
    };
  }

  const diffResolved = await resolveDetectChangesDiff({
    projectId,
    workspaceRoot: args?.workspaceRoot as string | undefined,
    stagedDiff: args?.stagedDiff as string | undefined,
    diff: args?.diff as string | undefined,
    mode: args?.mode as string | undefined,
    currentFilePath: args?.currentFilePath as string | undefined,
  });
  if ("error" in diffResolved) {
    return { content: [{ type: "text", text: diffResolved.error }], isError: true };
  }

  const { rawDiff, mode } = diffResolved;
  if (!rawDiff) {
    return { content: [{ type: "text", text: emptyDiffMessage(mode) }] };
  }

  const graph = await getGraph(resolvedProjectId);
  const result = await analyzeDiffImpact(graph as unknown as GraphClient, resolvedProjectId, rawDiff, mode);
  const text =
    format === "markdown" ? formatDetectChangesMarkdown(result) : JSON.stringify(result, null, 2);
  return { content: [{ type: "text", text }] };
}

async function inferProjectIdFromPath(graph: GraphType, currentFilePath: string): Promise<string | null> {
  const normalized = currentFilePath.replace(/\\/g, "/");
  const projectsQ = `MATCH (p:Project) RETURN p.projectId AS id, p.rootPath AS rootPath`;
  const projectsRes = (await graph.query(projectsQ)) as { data?: Array<Record<string, unknown>> };
  const rows = (projectsRes.data ?? []);

  // 1. Exact match: rootPath equals path or path starts with rootPath/
  let best: { id: string; len: number } | null = null;
  for (const row of rows) {
    const id = _rv<string>(row, "id");
    const rootPath = String(_rv<string>(row, "rootPath") ?? "");
    const rootNorm = rootPath.replace(/\\/g, "/").replace(/\/$/, "");
    if (id && rootNorm && (normalized === rootNorm || normalized.startsWith(rootNorm + "/"))) {
      if (!best || rootNorm.length > best.len) best = { id, len: rootNorm.length };
    }
  }
  if (best) return best.id;

  // 2. Filesystem path: rootPath as segment (e.g. /Users/x/projects/repo-slug/src/...)
  for (const row of rows) {
    const id = _rv<string>(row, "id");
    const rootPath = String(_rv<string>(row, "rootPath") ?? "");
    const rootNorm = rootPath.replace(/\\/g, "/").replace(/\/$/, "");
    if (!id || !rootNorm) continue;
    if (normalized.includes("/" + rootNorm + "/") || normalized.endsWith("/" + rootNorm)) {
      if (!best || rootNorm.length > best.len) best = { id, len: rootNorm.length };
    }
  }
  if (best) return best.id;

  // 3. Match by File path: find File whose path is a suffix of the given path
  const filesQ = `MATCH (f:File) RETURN f.path AS path, f.projectId AS id`;
  const filesRes = (await graph.query(filesQ)) as { data?: Array<Record<string, unknown>> };
  const fileRows = (filesRes.data ?? []);
  let longest: { path: string; id: string } | null = null;
  for (const row of fileRows) {
    const path = _rv<string>(row, "path");
    const id = _rv<string>(row, "id");
    if (!path || !id) continue;
    const segment = "/" + path;
    if ((normalized.endsWith(path) || normalized.includes(segment)) && path.length > (longest?.path?.length ?? 0)) {
      longest = { path, id };
    }
  }
  if (longest) return longest.id;

  // 4. Fallback: exact File path match
  try {
    const fileRes = (await graph.query(
      `MATCH (f:File {path: $path}) RETURN f.projectId AS id LIMIT 1`,
      { params: { path: normalized } }
    )) as { data?: Array<Record<string, unknown>> };
    const exactRows = (fileRes.data ?? []);
    if (exactRows.length > 0) return _rv<string>(exactRows[0], "id") ?? null;
  } catch {
    // path might not match exact
  }
  return null;
}

async function collectCandidateProjectIdsFromIngest(): Promise<string[]> {
  const ingestUrl = process.env.INGEST_URL ?? process.env.ARIADNESPEC_INGEST_URL ?? "";
  if (!ingestUrl) return [];
  const base = ingestUrl.replace(/\/$/, "");
  const ids: string[] = [];
  try {
    const projectsRes = await fetch(`${base}/projects`, { signal: AbortSignal.timeout(5000) });
    if (projectsRes.ok) {
      const data = (await projectsRes.json()) as Array<{ id: string }>;
      for (const p of data) ids.push(p.id);
    }
    const reposRes = await fetch(`${base}/repositories`, { signal: AbortSignal.timeout(5000) });
    if (reposRes.ok) {
      const repos = (await reposRes.json()) as Array<{ id: string }>;
      const seen = new Set(ids);
      for (const r of repos) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          ids.push(r.id);
        }
      }
    }
  } catch {
    /* ignore */
  }
  return ids;
}

async function inferProjectIdWhenSharded(currentFilePath: string): Promise<string | null> {
  if (!currentFilePath || !isProjectShardingEnabled()) return null;
  const candidates = await collectCandidateProjectIdsFromIngest();
  for (const id of candidates) {
    let hit: string | null = null;
    await forEachProjectShardGraph(id, async (g) => {
      const h = await inferProjectIdFromPath(g as GraphType, currentFilePath);
      if (h) {
        hit = h;
        return true;
      }
    });
    if (hit) return hit;
  }
  return null;
}

async function queryFileRowsAllShards(
  projectId: string,
  filesQ: string,
): Promise<Array<Record<string, unknown>>> {
  const merged: Array<Record<string, unknown>> = [];
  await forEachProjectShardGraph(projectId, async (g, ctx) => {
    const filesRes = (await g.query(filesQ, { params: { projectId: ctx.cypherProjectId } })) as {
      data?: Array<Record<string, unknown>>;
    };
    for (const row of filesRes.data ?? []) merged.push(row);
  });
  return merged;
}

async function runOnProjectGraphs(
  projectId: string | undefined,
  fn: (g: GraphType, ctx: { cypherProjectId: string }) => Promise<void>,
): Promise<void> {
  if (!projectId) {
    await fn(await getGraph(undefined), { cypherProjectId: "" });
    return;
  }
  await forEachProjectShardGraph(projectId, async (g, ctx) => {
    await fn(g as GraphType, ctx);
  });
}

/**
 * Extrae y compacta el Ego-Graph (vecinos a 1-hop y contratos de tipos) para los nodos
 * encontrados en la búsqueda, serializándolos en un bloque TypeScript de alta densidad.
 */
async function buildEgoGraphSignatures(
  items: Array<{ type: string; name: string; rawName?: string; path?: string; projectId?: string }>,
  graphRouteId?: string,
  scopeRepoId?: string,
): Promise<string> {
  const topCandidates = items
    .filter((it) => ["Component", "Function", "Model"].includes(it.type))
    .slice(0, 5);
  if (topCandidates.length === 0) return "";

  const signatures: string[] = [];

  for (const item of topCandidates) {
    const rawName = item.rawName || item.name.split(" — ")[0]?.trim() || item.name;
    const path = item.path || (item.name.includes(" — ") ? item.name.split(" — ")[1]?.trim() : undefined);

    if (item.type === "Component") {
      let contract: string | null = null;
      let hooks: string[] = [];
      let renders: string[] = [];
      let renderedBy: string[] = [];

      await runOnProjectGraphs(graphRouteId, async (g) => {
        try {
          const cypher = `MATCH (c:Component {name: $name})
            WHERE ($path IS NULL OR c.path = $path)
            OPTIONAL MATCH (c)-[:USES_HOOK]->(h:Hook)
            OPTIONAL MATCH (c)-[:RENDERS]->(child:Component)
            OPTIONAL MATCH (parent:Component)-[:RENDERS]->(c)
            RETURN c.propsContract AS contract,
                   collect(DISTINCT h.name) AS hooks,
                   collect(DISTINCT child.name) AS renders,
                   collect(DISTINCT parent.name) AS renderedBy
            LIMIT 1`;
          const res = (await g.query(cypher, { params: { name: rawName, path: path ?? null } })) as {
            data?: Array<Record<string, unknown>>;
          };
          const row = res.data?.[0];
          if (row) {
            contract = _rv<string>(row, "contract") ?? contract;
            hooks = _rv<string[]>(row, "hooks") ?? hooks;
            renders = _rv<string[]>(row, "renders") ?? renders;
            renderedBy = _rv<string[]>(row, "renderedBy") ?? renderedBy;
          }
        } catch {
          /* ignore */
        }
      });

      const comments: string[] = [];
      comments.push(`// [Component] ${rawName}${path ? ` (${path})` : ""}`);
      if (renderedBy && renderedBy.length > 0) comments.push(`// Rendered by: ${renderedBy.filter(Boolean).slice(0, 5).join(", ")}`);
      if (renders && renders.length > 0) comments.push(`// Renders: ${renders.filter(Boolean).slice(0, 8).join(", ")}`);
      if (hooks && hooks.length > 0) comments.push(`// Hooks: ${hooks.filter(Boolean).slice(0, 8).join(", ")}`);

      let propsInterface = "";
      if (contract) {
        try {
          const parsedProps = JSON.parse(contract) as Array<{ name: string; type?: string; required?: boolean; description?: string }>;
          if (Array.isArray(parsedProps) && parsedProps.length > 0) {
            propsInterface =
              `export interface ${rawName}Props {\n` +
              parsedProps
                .map(
                  (p) =>
                    `  ${p.name}${p.required === false ? "?" : ""}: ${p.type || "unknown"};${p.description ? ` // ${p.description}` : ""}`,
                )
                .join("\n") +
              `\n}`;
          }
        } catch {
          /* ignore json parse error */
        }
      }

      const compDecl = propsInterface
        ? `${propsInterface}\nexport function ${rawName}(props: ${rawName}Props): JSX.Element;`
        : `export function ${rawName}(props?: Record<string, unknown>): JSX.Element;`;

      signatures.push(`${comments.join("\n")}\n${compDecl}`);
    } else if (item.type === "Function") {
      let calls: string[] = [];
      let calledBy: string[] = [];
      let loc: number | null = null;
      let complexity: number | null = null;
      let description: string | null = null;

      await runOnProjectGraphs(graphRouteId, async (g) => {
        try {
          const cypher = `MATCH (fn:Function {name: $name})
            WHERE ($path IS NULL OR fn.path = $path)
            OPTIONAL MATCH (fn)-[:CALLS]->(callee)
            OPTIONAL MATCH (caller)-[:CALLS]->(fn)
            RETURN fn.loc AS loc, fn.complexity AS complexity, fn.description AS description,
                   collect(DISTINCT callee.name) AS calls,
                   collect(DISTINCT caller.name) AS calledBy
            LIMIT 1`;
          const res = (await g.query(cypher, { params: { name: rawName, path: path ?? null } })) as {
            data?: Array<Record<string, unknown>>;
          };
          const row = res.data?.[0];
          if (row) {
            loc = _rv<number>(row, "loc") ?? loc;
            complexity = _rv<number>(row, "complexity") ?? complexity;
            description = _rv<string>(row, "description") ?? description;
            calls = _rv<string[]>(row, "calls") ?? calls;
            calledBy = _rv<string[]>(row, "calledBy") ?? calledBy;
          }
        } catch {
          /* ignore */
        }
      });

      const comments: string[] = [];
      comments.push(
        `// [Function] ${rawName}${path ? ` (${path})` : ""}${loc ? ` [${loc} lines]` : ""}${complexity ? ` [complexity: ${complexity}]` : ""}`,
      );
      if (description) comments.push(`// Description: ${description}`);
      if (calledBy && calledBy.length > 0) comments.push(`// Called by: ${calledBy.filter(Boolean).slice(0, 5).join(", ")}`);
      if (calls && calls.length > 0) comments.push(`// Calls: ${calls.filter(Boolean).slice(0, 8).join(", ")}`);

      const fnDecl = `export function ${rawName}(...args: unknown[]): unknown;`;
      signatures.push(`${comments.join("\n")}\n${fnDecl}`);
    } else if (item.type === "Model") {
      let fieldSummary: string | null = null;
      let tableName: string | null = null;
      let relations: string[] = [];

      await runOnProjectGraphs(graphRouteId, async (g) => {
        try {
          const cypher = `MATCH (m:Model {name: $name})
            WHERE ($path IS NULL OR m.path = $path)
            OPTIONAL MATCH (m)-[r:RELATES_TO]->(target:Model)
            RETURN m.tableName AS tableName, m.fieldSummary AS fieldSummary,
                   collect(DISTINCT target.name) AS relations
            LIMIT 1`;
          const res = (await g.query(cypher, { params: { name: rawName, path: path ?? null } })) as {
            data?: Array<Record<string, unknown>>;
          };
          const row = res.data?.[0];
          if (row) {
            tableName = _rv<string>(row, "tableName") ?? tableName;
            fieldSummary = _rv<string>(row, "fieldSummary") ?? fieldSummary;
            relations = _rv<string[]>(row, "relations") ?? relations;
          }
        } catch {
          /* ignore */
        }
      });

      const comments: string[] = [];
      comments.push(`// [Model] ${rawName}${tableName ? ` (table: ${tableName})` : ""}${path ? ` in ${path}` : ""}`);
      if (relations && relations.length > 0) comments.push(`// Relates to: ${relations.filter(Boolean).join(", ")}`);

      let fieldsStr = "  [key: string]: unknown;";
      if (fieldSummary) {
        try {
          const fields = JSON.parse(fieldSummary) as Array<{ name: string; type?: string }>;
          if (Array.isArray(fields) && fields.length > 0) {
            fieldsStr = fields.slice(0, 15).map((f) => `  ${f.name}: ${f.type || "unknown"};`).join("\n");
          }
        } catch {
          /* ignore */
        }
      }

      signatures.push(`${comments.join("\n")}\nexport interface ${rawName} {\n${fieldsStr}\n}`);
    }
  }

  if (signatures.length === 0) return "";
  return `### 🧠 Ego-Graph Context & Type Contracts (Graph-Augmented RAG)\n\`\`\`typescript\n${signatures.join("\n\n")}\n\`\`\``;
}

async function applyShardingInference(
  explicitProjectId: string | undefined,
  currentFilePath: string | undefined,
): Promise<string | undefined> {
  if (explicitProjectId) return explicitProjectId;
  if (!currentFilePath) return undefined;

  const cfg = loadAriadneProjectConfigNearFile(currentFilePath);
  if (cfg?.projectId?.trim()) return cfg.projectId.trim();

  const abs = toAbsoluteIdePath(currentFilePath);
  const fromIngest = await findBestProjectRepoForPathFromIngest(abs);
  if (fromIngest) return fromIngest.projectId;

  if (isProjectShardingEnabled()) {
    const fromShards = await inferProjectIdWhenSharded(currentFilePath);
    if (fromShards) return fromShards;
  }
  const g = await getGraph(undefined);
  return (await inferProjectIdFromPath(g, currentFilePath)) ?? undefined;
}

/** Resolve path (graph path o IDE path). Abre el grafo acorde a projectId (sharding). */
async function resolveFileForPath(
  pathParam: string,
  projectId?: string | null,
  currentFilePath?: string | null,
): Promise<{ graphPath: string; projectId: string | null; graph: GraphType }> {
  const normalized = pathParam.replace(/\\/g, "/");
  const isAbsoluteLike = normalized.startsWith("/") || /^[A-Za-z]:/.test(pathParam);

  let resolvedProjectId = projectId ?? null;
  if (!resolvedProjectId && currentFilePath) {
    resolvedProjectId = (await applyShardingInference(undefined, currentFilePath)) ?? null;
  }

  let graph = await getGraph(resolvedProjectId ?? undefined, {
    repoRelativePath: !isAbsoluteLike ? normalized : undefined,
  });

  if (!resolvedProjectId && isProjectShardingEnabled() && isAbsoluteLike) {
    resolvedProjectId = (await inferProjectIdWhenSharded(normalized)) ?? null;
    if (resolvedProjectId)
      graph = await getGraph(resolvedProjectId, { repoRelativePath: undefined });
  }

  if (isAbsoluteLike) {
    const filesQ = resolvedProjectId
      ? `MATCH (f:File {projectId: $projectId}) RETURN f.path AS path`
      : `MATCH (f:File) RETURN f.path AS path, f.projectId AS id`;
    let fileRows: Array<Record<string, unknown>>;
    if (resolvedProjectId && isProjectShardingEnabled()) {
      fileRows = await queryFileRowsAllShards(resolvedProjectId, filesQ);
    } else {
      const filesRes = resolvedProjectId
        ? ((await graph.query(filesQ, { params: { projectId: resolvedProjectId } })) as {
            data?: Array<Record<string, unknown>>;
          })
        : ((await graph.query(filesQ)) as { data?: Array<Record<string, unknown>> });
      fileRows = filesRes.data ?? [];
    }
    let best: { path: string; id?: string } | null = null;
    for (const row of fileRows) {
      const p = _rv<string>(row, "path");
      const id = _rv<string>(row, "id");
      if (!p) continue;
      const segment = "/" + p;
      const match = normalized.endsWith(p) || normalized.includes(segment);
      if (match && p.length > (best?.path?.length ?? 0)) {
        best = { path: p, id };
      }
    }
    if (best) {
      const pid = resolvedProjectId ?? best.id ?? null;
      const g2 = await getGraph(pid ?? undefined, { repoRelativePath: best.path });
      return { graphPath: best.path, projectId: pid, graph: g2 };
    }
  }

  const hasNoSlash = !normalized.includes("/");
  const searchSuffix = hasNoSlash ? normalized : normalized.split("/").pop() ?? normalized;
  if (hasNoSlash && searchSuffix) {
    const filesQ = resolvedProjectId
      ? `MATCH (f:File {projectId: $projectId}) RETURN f.path AS path, f.projectId AS id`
      : `MATCH (f:File) RETURN f.path AS path, f.projectId AS id`;
    let fileRows: Array<Record<string, unknown>>;
    if (resolvedProjectId && isProjectShardingEnabled()) {
      fileRows = await queryFileRowsAllShards(resolvedProjectId, filesQ);
    } else {
      const filesRes = resolvedProjectId
        ? ((await graph.query(filesQ, { params: { projectId: resolvedProjectId } })) as {
            data?: Array<Record<string, unknown>>;
          })
        : ((await graph.query(filesQ)) as { data?: Array<Record<string, unknown>> });
      fileRows = filesRes.data ?? [];
    }
    let bestShort: { path: string; id?: string } | null = null;
    for (const row of fileRows) {
      const p = _rv<string>(row, "path");
      const id = _rv<string>(row, "id");
      if (!p) continue;
      const matches = p === searchSuffix || p.endsWith("/" + searchSuffix);
      if (matches && p.length > (bestShort?.path?.length ?? 0)) {
        bestShort = { path: p, id };
      }
    }
    if (bestShort) {
      const pid = resolvedProjectId ?? bestShort.id ?? null;
      const g2 = await getGraph(pid ?? undefined, { repoRelativePath: bestShort.path });
      return { graphPath: bestShort.path, projectId: pid, graph: g2 };
    }
  }

  return {
    graphPath: normalized,
    projectId: resolvedProjectId,
    graph: await getGraph(resolvedProjectId ?? undefined, {
      repoRelativePath: !isAbsoluteLike ? normalized : undefined,
    }),
  };
}

/** Obtiene contenido de archivo desde ingest: intenta repo (repositories/:id/file) y si 404 intenta proyecto (projects/:id/file). */
async function fetchFileFromIngest(
  ingestBase: string,
  projectOrRepoId: string,
  graphPath: string,
  ref?: string,
): Promise<{ content: string } | { error: string }> {
  const base = ingestBase.replace(/\/$/, "");
  const pathQ = `path=${encodeURIComponent(graphPath)}`;
  const refQ = ref ? `&ref=${encodeURIComponent(ref)}` : "";
  let res = await fetch(`${base}/repositories/${projectOrRepoId}/file?${pathQ}${refQ}`);
  if (res.status === 404) {
    res = await fetch(`${base}/projects/${projectOrRepoId}/file?${pathQ}${refQ}`);
  }
  if (!res.ok) {
    const msg = await res.text();
    return { error: `HTTP ${res.status}: ${msg || res.statusText}` };
  }
  const data = (await res.json()) as { content?: string };
  return { content: data.content ?? "" };
}

  /**
   * Despacho central de herramientas: `request.params.name` decide la rama (ingest, API Nest, Falkor o mixto).
   * Los argumentos siguen el `inputSchema` publicado en `ListTools`. Errores HTTP se traducen a texto en `content`.
   *
   * @param request - Petición MCP estándar con `params.name` y `params.arguments`.
   * @returns Resultado MCP (`content[]` con partes `text` o tipos admitidos por el SDK).
   * @see {@link ./mcp-tools.doc.ts}
   */
  srv.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const __mcpCallStarted = Date.now();
  if (isMcpToolInvocationLoggingEnabled()) mcpLogToolInvocationStart(name, args);
  try {
  const __mcpResult = await (async () => {
  // Sharding/Falkor: misma configuración que ingest y API (system_settings), no solo process.env.
  await refreshFalkorRuntimeOverrides();
  let graph = await getGraph(undefined);

  if (name === "list_known_projects") {
    const ingestUrl = process.env.INGEST_URL ?? process.env.ARIADNESPEC_INGEST_URL ?? "";
    const cache = getMcpToolCache();
    const cacheKeyProjects = `ariadne:list_known_projects:v1`;
    const cachedProjects = await cache.get(cacheKeyProjects);
    if (cachedProjects) return { content: [{ type: "text", text: cachedProjects }] };
    if (ingestUrl) {
      try {
        const base = ingestUrl.replace(/\/$/, "");
        // 1) Proyectos (con repos asociados)
        const projectsRes = await fetch(`${base}/projects`, { signal: AbortSignal.timeout(5000) });
        let projects: Array<{ id: string; name: string; roots: Array<{ id: string; name: string; branch: string | null }> }> = [];
        if (projectsRes.ok) {
          const data = (await projectsRes.json()) as Array<{
            id: string;
            name: string | null;
            repositories: Array<{ id: string; projectKey: string; repoSlug: string; defaultBranch: string }>;
          }>;
          projects = data.map((p) => ({
            id: p.id,
            name: p.name ?? "",
            roots: p.repositories.map((r) => ({
              id: r.id,
              name: `${r.projectKey}/${r.repoSlug}`,
              branch: r.defaultBranch ?? null,
            })),
          }));
        }
        // 2) Repos standalone (no en ningún proyecto) — GET /repositories
        const reposRes = await fetch(`${base}/repositories`, { signal: AbortSignal.timeout(5000) });
        if (reposRes.ok) {
          const repos = (await reposRes.json()) as Array<{
            id: string;
            projectKey: string;
            repoSlug: string;
            defaultBranch?: string;
          }>;
          const repoIdsInProjects = new Set(projects.flatMap((p) => p.roots.map((r) => r.id)));
          for (const r of repos) {
            if (!repoIdsInProjects.has(r.id)) {
              projects.push({
                id: r.id,
                name: `${r.projectKey}/${r.repoSlug}`,
                roots: [
                  {
                    id: r.id,
                    name: `${r.projectKey}/${r.repoSlug}`,
                    branch: r.defaultBranch ?? null,
                  },
                ],
              });
            }
          }
        }
        const json = JSON.stringify(projects, null, 2);
        const projText = `## Proyectos indexados (multi-root)\n\nCada elemento tiene:\n- \`id\` — UUID **proyecto** Ariadne → usar en **\`export_brownfield_project_parity_pack\`** / **\`generate_merged_project_mdd\`** (The Forge multi-root)\n- \`roots[]\` — repos Git; \`roots[].id\` → mono-repo (\`export_brownfield_parity_pack\`, \`get_modification_plan\`, etc.)\n\nGuía Forge: \`docs://guias/brownfield-forge-mcp\`\n\n\`\`\`json\n${json}\n\`\`\``;
        await cache.set(cacheKeyProjects, projText, 60);
        return {
          content: [
            {
              type: "text",
              text: projText,
            },
          ],
        };
      } catch {
        // Fallback to graph
      }
    }
    graph = await getGraph(undefined);
    const q = `MATCH (p:Project) RETURN p.projectId AS id, p.projectName AS name, p.rootPath AS rootPath, p.branch AS branch`;
    const result = (await graph.query(q)) as { data?: Array<Record<string, unknown>> };
    const rows = (result.data ?? []) as Array<Record<string, unknown> | unknown[]>;
    const projectsFromGraph = rows.map((row) => {
      const id = _rv<string>(row, Array.isArray(row) ? 0 : "id");
      const name = _rv<string>(row, Array.isArray(row) ? 1 : "name");
      const rootPath = _rv<string>(row, Array.isArray(row) ? 2 : "rootPath");
      const branch = _rv<string | null>(row, Array.isArray(row) ? 3 : "branch");
      return {
        id: String(id ?? ""),
        name: String(name ?? ""),
        roots: [{ id: String(id ?? ""), name: String(rootPath ?? ""), branch: branch != null && branch !== "" ? String(branch) : null }],
      };
    });
    const json = JSON.stringify(projectsFromGraph, null, 2);
    const graphProjText = `## Proyectos indexados\n\n\`\`\`json\n${json}\n\`\`\``;
    await cache.set(cacheKeyProjects, graphProjText, 60);
    return {
      content: [{ type: "text", text: graphProjText }],
    };
  }

  if (name === "get_component_graph") {
    const componentName = (args?.componentName as string) ?? "";
    const depth = Math.min(Math.max(1, (args?.depth as number) ?? 2), 10);
    let projectId = args?.projectId as string | undefined;
    const currentFilePath = args?.currentFilePath as string | undefined;

    if (!projectId && currentFilePath) {
      projectId = (await applyShardingInference(undefined, currentFilePath)) ?? undefined;
    }

    const cache = getMcpToolCache();
    const cacheKey = `ariadne:component_graph:v3:${projectId ?? "global"}:${componentName}:${depth}`;
    const cached = await cache.get(cacheKey);
    if (cached) return { content: [{ type: "text", text: cached }] };

    graph = await getGraph(projectId ?? undefined);
    const exists = await nodeExists(graph, componentName, projectId ?? null);
    if (!exists) {
      return {
        content: [
          {
            type: "text",
            text: `[NOT_FOUND_IN_GRAPH]\n\n**Componente \`${componentName}\` no encontrado en el grafo.**\n\nVerifica el nombre o ejecuta sync/resync del proyecto. No proceder sin reindexar.`,
          },
        ],
        isError: true,
      };
    }
    const resolvedComponentName = await resolveNodeName(graph, componentName, projectId ?? null);

    const base = ariadneApiBase();
    const qs = new URLSearchParams();
    qs.set("depth", String(depth));
    if (projectId) qs.set("projectId", projectId);
    const apiUrl = `${base}/api/graph/component/${encodeURIComponent(resolvedComponentName)}?${qs}`;

    let apiAuthHint = "";
    try {
      const res = await fetch(apiUrl, ariadneApiFetchInit({ signal: AbortSignal.timeout(30_000) }));
      if (res.ok) {
        const payload = (await res.json()) as ComponentGraphApiPayload;
        const markdown = formatComponentGraphFromApi(payload);
        await cache.set(cacheKey, markdown, 120);
        return { content: [{ type: "text", text: markdown }] };
      }
      if (res.status === 401 || res.status === 403) {
        apiAuthHint =
          `> **API ${res.status}:** Rutas \`/api/graph/*\` requieren auth. Configura Cursor con \`Authorization: Bearer\` igual al **Secret MCP** (\`ari_…\`) de Perfil o al **JWT de sesión** tras login web; el proceso MCP lo reenvía al Nest.\n\n`;
      }
    } catch {
      /* fallback Falkor (red / timeout / DNS); si usas \`http://api:3000\` fuera de Docker, el host \`api\` no resuelve. */
    }

    const params: Record<string, string | number> = { componentName: resolvedComponentName };
    const compMatchProject = projectId ? ", projectId: $projectId" : "";
    if (projectId) params.projectId = projectId;
    const whereFilter = projectId
      ? ` WHERE (dependency.projectId = $projectId OR dependency.projectId IS NULL)`
      : "";
    const q = `MATCH (c:Component {name: $componentName${compMatchProject}})-[*1..${depth}]->(dependency)${whereFilter} RETURN c, dependency`;
    let result = (await graph.query(q, { params })) as {
      headers?: string[];
      data?: unknown[][];
    };
    let data = result.data ?? [];
    /** Fallback: foco :Hook — Falkor tiene aristas Component→Hook (USES_HOOK); la consulta genérica anterior no los incluye. */
    if (data.length === 0) {
      const hookGp = projectId
        ? `MATCH (h:Hook {name: $componentName, projectId: $projectId})<-[:USES_HOOK]-(consumer:Component {projectId: $projectId}) RETURN h AS c, consumer AS dependency`
        : `MATCH (h:Hook {name: $componentName})<-[:USES_HOOK]-(consumer:Component) RETURN h AS c, consumer AS dependency`;
      result = (await graph.query(hookGp, { params })) as {
        headers?: string[];
        data?: unknown[][];
      };
      data = result.data ?? [];
    }
    const headers = result.headers && result.headers.length ? result.headers : ["c", "dependency"];
    const fallbackNote =
      apiAuthHint +
      "> **Nota (fallback Falkor):** Si el foco es **Hook**, se listan consumidores vía `USES_HOOK`; si es **Component**, consulta genérica `-[*1..depth]->`. Sin API Nest no hay fusión IMPORTS multi-shard ni `graphHints`. Para paridad con el explorador: Bearer en Cursor (`Secret MCP` o JWT de sesión) + `ARIADNE_API_URL`.\n\n";
    const markdown = fallbackNote + formatComponentGraph(componentName, data, headers);

    await cache.set(cacheKey, markdown, 120);

    return { content: [{ type: "text", text: markdown }] };
  }

  if (name === "get_legacy_impact") {
    const nodeName = (args?.nodeName as string) ?? "";
    let projectId = args?.projectId as string | undefined;
    const legacyFilePath = args?.currentFilePath as string | undefined;
    if (!projectId && legacyFilePath) {
      projectId = (await applyShardingInference(undefined, legacyFilePath)) ?? undefined;
    }

    const cache = getMcpToolCache();
    const cacheKey = `ariadne:legacy_impact:v3:${projectId ?? "global"}:${nodeName}`;
    const cachedLegacy = await cache.get(cacheKey);
    if (cachedLegacy) return { content: [{ type: "text", text: cachedLegacy }] };

    graph = await getGraph(projectId ?? undefined);
    const exists = await nodeExists(graph, nodeName, projectId ?? null);
    if (!exists) {
      return {
        content: [
          {
            type: "text",
            text: `[NOT_FOUND_IN_GRAPH]\n\n**Nodo \`${nodeName}\` no encontrado en el grafo.**\n\nVerifica el nombre o ejecuta sync/resync del proyecto. Usa \`list_known_projects\` para el projectId. No proceder sin reindexar.`,
          },
        ],
        isError: true,
      };
    }
    const resolvedName = await resolveNodeName(graph, nodeName, projectId ?? null);

    const base = ariadneApiBase();
    const impactQs = new URLSearchParams();
    if (projectId) impactQs.set("projectId", projectId);
    const impactUrl = `${base}/api/graph/impact/${encodeURIComponent(resolvedName)}?${impactQs}`;

    let impactApiAuthHint = "";
    try {
      const res = await fetch(impactUrl, ariadneApiFetchInit({ signal: AbortSignal.timeout(30_000) }));
      if (res.ok) {
        const payload = (await res.json()) as {
          nodeId: string;
          dependents: Array<{ name?: unknown; labels?: unknown; distance?: unknown; callChain?: unknown }>;
        };
        const hasExtra = (payload.dependents ?? []).some((d) => d.distance !== undefined);
        const headers = hasExtra ? ["name", "labels", "distance", "callChain"] : ["name", "labels"];
        const data = (payload.dependents ?? []).map((d) =>
          hasExtra ? [d.name, d.labels, d.distance, d.callChain] : [d.name, d.labels],
        ) as unknown[][];
        const apiNote =
          "**Fuente:** API Nest `GET /api/graph/impact` (mismo criterio que GraphService.getImpact).\n\n";
        const markdown = apiNote + formatLegacyImpact(nodeName, data, headers);
        await cache.set(cacheKey, markdown, 120);
        return { content: [{ type: "text", text: markdown }] };
      }
      if (res.status === 401 || res.status === 403) {
        impactApiAuthHint =
          `> **API ${res.status}:** Falta o token inválido para \`/api/graph/impact\`. Envía desde Cursor \`Authorization: Bearer\` con el **Secret MCP** (\`ari_…\`) o el **JWT** de sesión web (cuando están vigentes).\n\n`;
      }
    } catch {
      /* fallback Falkor */
    }

    const params: Record<string, string | number> = { nodeName: resolvedName };
    const whereParts: string[] = [];
    if (projectId) {
      params.projectId = projectId;
      whereParts.push(
        "(n.projectId = $projectId OR n.projectId IS NULL)",
        "(dependent.projectId = $projectId OR dependent.projectId IS NULL)"
      );
    }
    const where = whereParts.length ? ` WHERE ${whereParts.join(" AND ")}` : "";
    const q = `MATCH path = (n {name: $nodeName})<-[:CALLS|RENDERS*1..3]-(dependent)${where}
WITH dependent, min(length(path)) AS distance, collect([x IN nodes(path) | x.name])[0] AS callChain
RETURN dependent.name AS name, labels(dependent) AS labels, distance, callChain
ORDER BY distance ASC
LIMIT 100`;
    const result = (await graph.query(q, { params })) as {
      headers?: string[];
      data?: unknown[][];
    };
    let data = result.data ?? [];
    /** Consumidores de hooks React sin aristas CALLS al hook (solo USES_HOOK desde componentes). */
    try {
      const hookImpactParams: Record<string, string> = { nodeName: resolvedName };
      if (projectId) hookImpactParams.projectId = projectId;
      const hookImpactQ = projectId
        ? `MATCH (h:Hook {name: $nodeName, projectId: $projectId})<-[:USES_HOOK]-(consumer:Component {projectId: $projectId}) RETURN consumer.name AS name, labels(consumer) AS labels, 1 AS distance, [consumer.name, h.name] AS callChain`
        : `MATCH (h:Hook {name: $nodeName})<-[:USES_HOOK]-(consumer:Component) RETURN consumer.name AS name, labels(consumer) AS labels, 1 AS distance, [consumer.name, h.name] AS callChain`;
      const hookImpactRes = (await graph.query(hookImpactQ, { params: hookImpactParams })) as {
        headers?: string[];
        data?: unknown[][];
      };
      const hookRows = hookImpactRes.data ?? [];
      if (hookRows.length > 0) data = [...data, ...hookRows];
    } catch {
      /* ignore */
    }
    const headers = result.headers ?? ["name", "labels", "distance", "callChain"];
    const fallbackNote =
      impactApiAuthHint +
      "> **Nota (fallback Falkor):** `CALLS|RENDERS*` más consumidores **`USES_HOOK`** si el foco es Hook; sin API Nest no hay fusión IMPORTS multi-shard. Envía Bearer (Secret MCP o JWT web) desde Cursor al MCP para reenvío al Nest.\n\n";
    const markdown = fallbackNote + formatLegacyImpact(nodeName, data, headers);

    await cache.set(cacheKey, markdown, 120);

    return { content: [{ type: "text", text: markdown }] };
  }

  if (name === "get_contract_specs") {
    const componentName = (args?.componentName as string) ?? "";
    let projectId = args?.projectId as string | undefined;
    const currentFilePath = args?.currentFilePath as string | undefined;
    if (!projectId && currentFilePath) {
      projectId = (await applyShardingInference(undefined, currentFilePath)) ?? undefined;
    }
    graph = await getGraph(projectId ?? undefined);
    const exists = await nodeExists(graph, componentName, projectId ?? null);
    if (!exists) {
      return {
        content: [{ type: "text", text: `[NOT_FOUND_IN_GRAPH]\n\n**Componente \`${componentName}\` no encontrado en el grafo.**\n\nVerifica el nombre o ejecuta sync/resync del proyecto. No proceder sin reindexar.` }],
        isError: true,
      };
    }
    const resolvedComponentName = await resolveNodeName(graph, componentName, projectId ?? null);
    const params: Record<string, string> = { componentName: resolvedComponentName };
    const matchProject = projectId ? ", projectId: $projectId" : "";
    if (projectId) params.projectId = projectId;
    const descQ = `MATCH (c:Component {name: $componentName${matchProject}}) RETURN c.description AS description, c.propsContract AS propsContract LIMIT 1`;
    const descRes = await graph.query(descQ, { params }) as { data?: Array<Record<string, unknown>> };
    const descRow = (descRes.data ?? [])[0] as Record<string, unknown> | undefined;
    const description = descRow ? _rv<string | null>(descRow, "description") : null;
    const propsContractRaw = descRow ? _rv<string | null>(descRow, "propsContract") : null;
    let data: unknown[][] = [];
    if (propsContractRaw) {
      try {
        const parsed = JSON.parse(propsContractRaw) as Array<{ name: string; required?: boolean }>;
        data = parsed.map((p) => [p.name, p.required ?? false]);
      } catch {
        /* fallback */
      }
    }
    if (data.length === 0) {
      const q = `MATCH (c:Component {name: $componentName${matchProject}})-[:HAS_PROP]->(p:Prop) RETURN p.name AS name, p.required AS required LIMIT 100`;
      const result = await graph.query(q, { params }) as {
        headers?: string[];
        data?: unknown[][];
      };
      data = result.data ?? [];
    }
    const headers = ["name", "required"];
    const markdown = formatContractSpecs(componentName, data, headers, description);
    return { content: [{ type: "text", text: markdown }] };
  }

  if (name === "get_functions_in_file") {
    const pathParam = (args?.path as string) ?? "";
    const projectId = args?.projectId as string | undefined;
    const currentFilePath = args?.currentFilePath as string | undefined;
    if (!projectId && !currentFilePath) {
      return {
        content: [{ type: "text", text: "[ERROR]\n\n**Se requiere `projectId` o `currentFilePath`** para evitar mezcla de proyectos. Usa `list_known_projects` para IDs." }],
        isError: true,
      };
    }
    const { graphPath, projectId: resolvedProjectId, graph: gFile } = await resolveFileForPath(
      pathParam,
      projectId,
      currentFilePath,
    );
    graph = gFile;
    const params: Record<string, string> = { path: graphPath };
    const matchProject = resolvedProjectId ? ", projectId: $projectId" : "";
    if (resolvedProjectId) params.projectId = resolvedProjectId;
    const existsFileQ = `MATCH (f:File {path: $path${matchProject}}) RETURN 1 AS x LIMIT 1`;
    const existsFileRes = (await graph.query(existsFileQ, { params })) as { data?: unknown[][] };
    if ((existsFileRes.data ?? []).length === 0) {
      return {
        content: [{ type: "text", text: `[NOT_FOUND_IN_GRAPH]\n\n**Archivo \`${graphPath}\` no encontrado en el grafo.**\n\nEjecuta sync/resync del proyecto.` }],
        isError: true,
      };
    }
    const q = `MATCH (f:File {path: $path${matchProject}})-[:CONTAINS]->(n) RETURN labels(n)[0] AS label, n.name AS name`;
    const result = await graph.query(q, { params }) as { data?: Array<Record<string, unknown>> };
    const data = (result.data ?? []);
    const markdown = formatFunctionsInFile(graphPath, data);
    return { content: [{ type: "text", text: markdown }] };
  }

  if (name === "get_import_graph") {
    const filePathParam = (args?.filePath as string) ?? "";
    const projectId = args?.projectId as string | undefined;
    const currentFilePath = args?.currentFilePath as string | undefined;
    if (!projectId && !currentFilePath) {
      return {
        content: [{ type: "text", text: "[ERROR]\n\n**Se requiere `projectId` o `currentFilePath`** para evitar mezcla de proyectos. Usa `list_known_projects` para IDs." }],
        isError: true,
      };
    }
    const { graphPath, projectId: resolvedProjectId, graph: gImp } = await resolveFileForPath(
      filePathParam,
      projectId,
      currentFilePath,
    );
    graph = gImp;
    const params: Record<string, string> = { path: graphPath };
    const matchProject = resolvedProjectId ? ", projectId: $projectId" : "";
    if (resolvedProjectId) params.projectId = resolvedProjectId;
    const importsQ = `MATCH (f:File {path: $path${matchProject}})-[:IMPORTS]->(imp:File) RETURN imp.path AS path`;
    const containsQ = `MATCH (f:File {path: $path${matchProject}})-[:CONTAINS]->(n) RETURN labels(n)[0] AS label, n.name AS name`;
    const existsFileQ = `MATCH (f:File {path: $path${matchProject}}) RETURN 1 AS x LIMIT 1`;
    const existsFileRes = (await graph.query(existsFileQ, { params })) as { data?: unknown[][] };
    if ((existsFileRes.data ?? []).length === 0) {
      return {
        content: [{ type: "text", text: `[NOT_FOUND_IN_GRAPH]\n\n**Archivo \`${graphPath}\` no encontrado en el grafo.**\n\nEjecuta sync/resync del proyecto.` }],
        isError: true,
      };
    }
    const [importsRes, containsRes] = await Promise.all([
      graph.query(importsQ, { params }),
      graph.query(containsQ, { params }),
    ]);
    const importsData = ((importsRes as { data?: Array<Record<string, unknown>> }).data ?? []);
    const containsData = ((containsRes as { data?: Array<Record<string, unknown>> }).data ?? []);
    const markdown = formatImportGraph(graphPath, importsData, containsData);
    return { content: [{ type: "text", text: markdown }] };
  }

  if (name === "get_file_content") {
    const pathParam = (args?.path as string) ?? "";
    let projectId = args?.projectId as string | undefined;
    const currentFilePath = args?.currentFilePath as string | undefined;
    const ref = args?.ref as string | undefined;
    if (!projectId && currentFilePath) {
      projectId = (await applyShardingInference(undefined, currentFilePath)) ?? undefined;
    }
    if (!projectId) {
      return {
        content: [{ type: "text", text: "**Error:** Se requiere `projectId` o `currentFilePath` para obtener el contenido del archivo." }],
        isError: true,
      };
    }
    const cache = getMcpToolCache();
    const cacheKeyFile = `ariadne:file_content:v1:${projectId}:${pathParam}:${ref ?? "HEAD"}`;
    const cachedFile = await cache.get(cacheKeyFile);
    if (cachedFile) return { content: [{ type: "text", text: cachedFile }] };
    const { graphPath } = await resolveFileForPath(pathParam, projectId, currentFilePath);
    const ingestUrl = process.env.INGEST_URL ?? process.env.ARIADNESPEC_INGEST_URL ?? "http://localhost:3002";
    try {
      const result = await fetchFileFromIngest(ingestUrl, projectId, graphPath, ref);
      if ("error" in result) {
        return {
          content: [{ type: "text", text: `**Error:** ${result.error}` }],
          isError: true,
        };
      }
      const fileText = `## Contenido: ${graphPath}\n\n\`\`\`\n${result.content}\n\`\`\``;
      await cache.set(cacheKeyFile, fileText, 120);
      return {
        content: [{ type: "text", text: fileText }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `**Error:** No se pudo obtener el archivo. ¿Está INGEST_URL configurado? ${msg}` }],
        isError: true,
      };
    }
  }

  if (name === "sync_local_file") {
    const rawPath = ((args?.filePath as string) ?? "").trim();
    let content = args?.content as string | undefined;
    let projectId = args?.projectId as string | undefined;
    const repoId = args?.repoId as string | undefined;

    if (!rawPath) {
      return {
        content: [{ type: "text", text: "**Error:** El parámetro `filePath` es requerido." }],
        isError: true,
      };
    }

    if (!projectId) {
      projectId = (await applyShardingInference(undefined, rawPath)) ?? undefined;
    }

    const ingestUrl = (process.env.INGEST_URL ?? process.env.ARIADNESPEC_INGEST_URL ?? "http://localhost:3002").replace(/\/$/, "");

    if (content === undefined) {
      try {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const absPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
        content = await fs.readFile(absPath, "utf-8");
      } catch {
        content = "";
      }
    }

    try {
      const res = await fetch(`${ingestUrl}/repositories/local-sync/file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: rawPath,
          content,
          projectId,
          repoId,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        return {
          content: [{ type: "text", text: `**Error ${res.status}:** No se pudo sincronizar el archivo localmente: ${text}` }],
          isError: true,
        };
      }

      const data = (await res.json()) as {
        status: string;
        path: string;
        componentsIndexed?: number;
        functionsIndexed?: number;
      };

      return {
        content: [
          {
            type: "text",
            text: `### ⚡ Sincronización Local Live Exitosa\n\n- **Archivo:** \`${data.path}\`\n- **Estado:** \`${data.status}\`\n- **Componentes indexados:** ${data.componentsIndexed ?? 0}\n- **Funciones indexadas:** ${data.functionsIndexed ?? 0}\n\n*El grafo delta local en FalkorDB ha sido actualizado sin requerir commit ni push remoto.*`,
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `**Error de conexión con Ingest:** ${msg}` }],
        isError: true,
      };
    }
  }

  if (name === "semantic_search") {
    const query = ((args?.query as string) ?? "").trim();
    const projectId = args?.projectId as string | undefined;
    const limit = Math.min(mcpLimits.semanticSearchMax, Math.max(1, (args?.limit as number) ?? mcpLimits.semanticSearchDefault));
    if (!query) {
      return {
        content: [{ type: "text", text: "**Error:** El parámetro `query` es requerido." }],
        isError: true,
      };
    }
    if (isProjectShardingEnabled() && !projectId) {
      return {
        content: [
          {
            type: "text",
            text: "**Error:** Con `FALKOR_SHARD_BY_PROJECT` activo debes pasar `projectId` en semantic_search.",
          },
        ],
        isError: true,
      };
    }
    const cache = getMcpToolCache();
    const cacheKeySem = `ariadne:semantic_search:v1:${projectId ?? "global"}:${query}:${limit}`;
    const cachedSem = await cache.get(cacheKeySem);
    if (cachedSem) return { content: [{ type: "text", text: cachedSem }] };
    const ingestUrl = process.env.INGEST_URL ?? process.env.ARIADNESPEC_INGEST_URL ?? "http://localhost:3002";
    /** Id pedido por el cliente (a menudo `roots[].id` = repo). */
    const requestedScopeId = projectId;
    let graphRouteId: string | undefined = requestedScopeId;
    let scopeRepoId: string | undefined;
    if (requestedScopeId) {
      const scope = await resolveGraphScopeFromProjectOrRepoId(ingestUrl, requestedScopeId);
      graphRouteId = scope.cypherProjectId;
      scopeRepoId = scope.repoId;
    }
    const hasRepoScope = Boolean(scopeRepoId);
    const results: { type: string; name: string; rawName?: string; path?: string; projectId?: string }[] = [];
    let usedVector = false;
    try {
      const embedParams = new URLSearchParams();
      embedParams.set("text", query);
      /** embed exige `repositories.id`; conservar el id original del caller. */
      if (requestedScopeId) embedParams.set("repositoryId", requestedScopeId);
      const embedRes = await fetch(`${ingestUrl.replace(/\/$/, "")}/embed?${embedParams.toString()}`);
      if (embedRes.ok) {
        const embedJson = (await embedRes.json()) as { embedding?: number[]; vectorProperty?: string };
        const { embedding } = embedJson;
        const vecProp = embedJson.vectorProperty ?? "embedding";
        const valid = Array.isArray(embedding) && embedding.every((v) => typeof v === "number" && Number.isFinite(v));
        if (valid && embedding!.length > 0) {
          const vecStr = `[${embedding!.join(",")}]`;
          const k = Math.min(Math.max(limit, 20), mcpLimits.semanticVectorKMax);
          const funcVecQ = `CALL db.idx.vector.queryNodes('Function', '${vecProp}', ${k}, vecf32(${vecStr})) YIELD node, score RETURN node.name AS name, node.path AS path, node.projectId AS projectId, node.repoId AS repoId, score`;
          const compVecQ = `CALL db.idx.vector.queryNodes('Component', '${vecProp}', ${k}, vecf32(${vecStr})) YIELD node, score RETURN node.name AS name, node.path AS path, node.projectId AS projectId, node.repoId AS repoId, score`;
          const docVecQ = `CALL db.idx.vector.queryNodes('Document', '${vecProp}', ${k}, vecf32(${vecStr})) YIELD node, score RETURN node.path AS path, node.heading AS heading, node.chunkIndex AS chunkIndex, node.projectId AS projectId, node.repoId AS repoId, score`;
          const sbVecQ = `CALL db.idx.vector.queryNodes('StorybookDoc', '${vecProp}', ${k}, vecf32(${vecStr})) YIELD node, score RETURN node.title AS name, node.sourcePath AS path, node.projectId AS projectId, node.repoId AS repoId, score`;
          const mdVecQ = `CALL db.idx.vector.queryNodes('MarkdownDoc', '${vecProp}', ${k}, vecf32(${vecStr})) YIELD node, score RETURN node.title AS name, node.sourcePath AS path, node.projectId AS projectId, node.repoId AS repoId, score`;
          const modelVecQ = `CALL db.idx.vector.queryNodes('Model', '${vecProp}', ${k}, vecf32(${vecStr})) YIELD node, score RETURN node.name AS name, node.path AS path, node.projectId AS projectId, node.repoId AS repoId, score`;
          const enumVecQ = `CALL db.idx.vector.queryNodes('Enum', '${vecProp}', ${k}, vecf32(${vecStr})) YIELD node, score RETURN node.name AS name, node.path AS path, node.projectId AS projectId, node.repoId AS repoId, score`;
          const openApiVecQ = `CALL db.idx.vector.queryNodes('OpenApiOperation', '${vecProp}', ${k}, vecf32(${vecStr})) YIELD node, score RETURN node.method AS method, node.pathTemplate AS pathTemplate, node.projectId AS projectId, node.repoId AS repoId, score`;
          const strapiCtVecQ = `CALL db.idx.vector.queryNodes('StrapiContentType', '${vecProp}', ${k}, vecf32(${vecStr})) YIELD node, score RETURN node.name AS name, node.path AS path, node.strapiUid AS strapiUid, node.projectId AS projectId, node.repoId AS repoId, score`;
          const strapiSrVecQ = `CALL db.idx.vector.queryNodes('StrapiRoute', '${vecProp}', ${k}, vecf32(${vecStr})) YIELD node, score RETURN node.method AS method, node.routePath AS routePath, node.path AS path, node.projectId AS projectId, node.repoId AS repoId, score`;
          try {
            const seen = new Set<string>();
            await runOnProjectGraphs(graphRouteId, async (g, ctx) => {
              try {
                const [fRes, cRes, dRes, sbRes, mdRes, modelVecRes, enumVecRes, openApiVecRes, strapiCtVecRes, strapiSrVecRes] = await Promise.all([
                  g.query(funcVecQ) as Promise<{ data?: Array<Record<string, unknown>> }>,
                  g.query(compVecQ) as Promise<{ data?: Array<Record<string, unknown>> }>,
                  g.query(docVecQ) as Promise<{ data?: Array<Record<string, unknown>> }>,
                  g.query(sbVecQ) as Promise<{ data?: Array<Record<string, unknown>> }>,
                  g.query(mdVecQ) as Promise<{ data?: Array<Record<string, unknown>> }>,
                  g.query(modelVecQ) as Promise<{ data?: Array<Record<string, unknown>> }>,
                  g.query(enumVecQ) as Promise<{ data?: Array<Record<string, unknown>> }>,
                  g.query(openApiVecQ) as Promise<{ data?: Array<Record<string, unknown>> }>,
                  g.query(strapiCtVecQ) as Promise<{ data?: Array<Record<string, unknown>> }>,
                  g.query(strapiSrVecQ) as Promise<{ data?: Array<Record<string, unknown>> }>,
                ]);
                if (
                  (fRes.data?.length ?? 0) +
                    (cRes.data?.length ?? 0) +
                    (dRes.data?.length ?? 0) +
                    (sbRes.data?.length ?? 0) +
                    (mdRes.data?.length ?? 0) +
                    (modelVecRes.data?.length ?? 0) +
                    (enumVecRes.data?.length ?? 0) +
                    (openApiVecRes.data?.length ?? 0) >
                  0
                )
                  usedVector = true;
                for (const row of asObjRows(fRes.data)) {
                  if (results.length >= limit) return;
                  const name = _rv<string>(row, "name") ?? "";
                  const path = _rv<string>(row, "path") ?? "";
                  const pid = _rv<string>(row, "projectId");
                  if (ctx.cypherProjectId && pid !== ctx.cypherProjectId) continue;
                  if (scopeRepoId && _rv<string>(row, "repoId") !== scopeRepoId) continue;
                  const key = `Function:${name}:${path}`;
                  if (seen.has(key)) continue;
                  seen.add(key);
                  results.push({
                    type: "Function",
                    name: path ? `${name ?? ""} — ${path}` : (name ?? ""),
                    rawName: name,
                    path,
                    projectId: pid,
                  });
                }
                for (const row of cRes.data ?? []) {
                  if (results.length >= limit) return;
                  const name = _rv<string>(row, "name") ?? "";
                  const path = _rv<string>(row, "path") ?? "";
                  const pid = _rv<string>(row, "projectId");
                  if (ctx.cypherProjectId && pid !== ctx.cypherProjectId) continue;
                  if (scopeRepoId && _rv<string>(row, "repoId") !== scopeRepoId) continue;
                  const key = `Component:${name}:${path}`;
                  if (seen.has(key)) continue;
                  seen.add(key);
                  results.push({
                    type: "Component",
                    name: path ? `${name} — ${path}` : name,
                    rawName: name,
                    path,
                    projectId: pid,
                  });
                }
                for (const row of dRes.data ?? []) {
                  if (results.length >= limit) return;
                  const path = _rv<string>(row, "path") ?? "";
                  const heading = _rv<string>(row, "heading") ?? "";
                  const ci = _rv<string>(row, "chunkIndex");
                  const pid = _rv<string>(row, "projectId");
                  if (ctx.cypherProjectId && pid !== ctx.cypherProjectId) continue;
                  if (scopeRepoId && _rv<string>(row, "repoId") !== scopeRepoId) continue;
                  const key = `Document:${path}:${ci ?? ""}`;
                  if (seen.has(key)) continue;
                  seen.add(key);
                  const label = heading ? `${heading} — ${path}` : path;
                  results.push({ type: "Document", name: label, projectId: pid });
                }
                for (const row of sbRes.data ?? []) {
                  if (results.length >= limit) return;
                  const name = _rv<string>(row, "name") ?? "";
                  const path = _rv<string>(row, "path") ?? "";
                  const pid = _rv<string>(row, "projectId");
                  if (ctx.cypherProjectId && pid !== ctx.cypherProjectId) continue;
                  if (scopeRepoId && _rv<string>(row, "repoId") !== scopeRepoId) continue;
                  const key = `StorybookDoc:${path}`;
                  if (seen.has(key)) continue;
                  seen.add(key);
                  results.push({
                    type: "StorybookDoc",
                    name: path ? `${name || "Storybook"} — ${path}` : name || path,
                    projectId: pid,
                  });
                }
                for (const row of mdRes.data ?? []) {
                  if (results.length >= limit) return;
                  const name = _rv<string>(row, "name") ?? "";
                  const path = _rv<string>(row, "path") ?? "";
                  const pid = _rv<string>(row, "projectId");
                  if (ctx.cypherProjectId && pid !== ctx.cypherProjectId) continue;
                  if (scopeRepoId && _rv<string>(row, "repoId") !== scopeRepoId) continue;
                  const key = `MarkdownDoc:${path}`;
                  if (seen.has(key)) continue;
                  seen.add(key);
                  results.push({
                    type: "MarkdownDoc",
                    name: path ? `${name || "Doc"} — ${path}` : name || path,
                    projectId: pid,
                  });
                }
                for (const row of modelVecRes.data ?? []) {
                  if (results.length >= limit) return;
                  const name = _rv<string>(row, "name") ?? "";
                  const path = _rv<string>(row, "path") ?? "";
                  const pid = _rv<string>(row, "projectId");
                  if (ctx.cypherProjectId && pid !== ctx.cypherProjectId) continue;
                  if (scopeRepoId && _rv<string>(row, "repoId") !== scopeRepoId) continue;
                  const key = `Model:${name}:${path}`;
                  if (seen.has(key)) continue;
                  seen.add(key);
                  results.push({
                    type: "Model",
                    name: path ? `${name} — ${path}` : name,
                    rawName: name,
                    path,
                    projectId: pid,
                  });
                }
                for (const row of enumVecRes.data ?? []) {
                  if (results.length >= limit) return;
                  const name = _rv<string>(row, "name") ?? "";
                  const path = _rv<string>(row, "path") ?? "";
                  const pid = _rv<string>(row, "projectId");
                  if (ctx.cypherProjectId && pid !== ctx.cypherProjectId) continue;
                  if (scopeRepoId && _rv<string>(row, "repoId") !== scopeRepoId) continue;
                  const key = `Enum:${name}:${path}`;
                  if (seen.has(key)) continue;
                  seen.add(key);
                  results.push({
                    type: "Enum",
                    name: path ? `${name} — ${path}` : name,
                    projectId: pid,
                  });
                }
                for (const row of openApiVecRes.data ?? []) {
                  if (results.length >= limit) return;
                  const method = _rv<string>(row, "method") ?? "";
                  const pathTemplate = _rv<string>(row, "pathTemplate") ?? "";
                  const pid = _rv<string>(row, "projectId");
                  if (ctx.cypherProjectId && pid !== ctx.cypherProjectId) continue;
                  if (scopeRepoId && _rv<string>(row, "repoId") !== scopeRepoId) continue;
                  const key = `OpenApiOperation:${method}:${pathTemplate}`;
                  if (seen.has(key)) continue;
                  seen.add(key);
                  results.push({
                    type: "OpenApiOperation",
                    name: `${method} ${pathTemplate}`.trim(),
                    projectId: pid,
                  });
                }
                for (const row of strapiCtVecRes.data ?? []) {
                  if (results.length >= limit) return;
                  const name = _rv<string>(row, "name") ?? "";
                  const path = _rv<string>(row, "path") ?? "";
                  const uid = _rv<string>(row, "strapiUid") ?? "";
                  const pid = _rv<string>(row, "projectId");
                  if (ctx.cypherProjectId && pid !== ctx.cypherProjectId) continue;
                  if (scopeRepoId && _rv<string>(row, "repoId") !== scopeRepoId) continue;
                  const key = `StrapiContentType:${uid || name}:${path}`;
                  if (seen.has(key)) continue;
                  seen.add(key);
                  results.push({
                    type: "StrapiContentType",
                    name: uid ? `${name} (${uid}) — ${path}` : path ? `${name} — ${path}` : name,
                    projectId: pid,
                  });
                }
                for (const row of strapiSrVecRes.data ?? []) {
                  if (results.length >= limit) return;
                  const method = _rv<string>(row, "method") ?? "";
                  const routePath = _rv<string>(row, "routePath") ?? "";
                  const path = _rv<string>(row, "path") ?? "";
                  const pid = _rv<string>(row, "projectId");
                  if (ctx.cypherProjectId && pid !== ctx.cypherProjectId) continue;
                  if (scopeRepoId && _rv<string>(row, "repoId") !== scopeRepoId) continue;
                  const key = `StrapiRoute:${method}:${routePath}:${path}`;
                  if (seen.has(key)) continue;
                  seen.add(key);
                  results.push({
                    type: "StrapiRoute",
                    name: `${method} ${routePath} — ${path}`.trim(),
                    projectId: pid,
                  });
                }
              } catch {
                /* vector index may not exist on this shard */
              }
            });
          } catch {
            /* vector index may not exist, fall through to keyword */
          }
        }
      }
    } catch {
      /* embed endpoint may not be configured */
    }
    const countAfterVector = results.length;
    /** Vector puede ejecutarse pero devolver 0 filas (proyecto, índice vacío o filtro projectId). */
    if (!usedVector || results.length === 0) {
      const kwLim = mcpLimits.semanticKeywordSubqueryLimit;
      const lowerQ = query.toLowerCase();
      const projFilter = requestedScopeId ? ` AND ${whereProjectRepo("n", hasRepoScope)}` : "";
      const compQ = `MATCH (n:Component) WHERE toLower(n.name) CONTAINS $q${projFilter} RETURN n.name AS name, n.path AS path LIMIT ${kwLim}`;
      const funcQ = `MATCH (n:Function) WHERE (toLower(n.name) CONTAINS $q OR toLower(coalesce(n.path, '')) CONTAINS $q)${projFilter} RETURN n.name AS name, n.path AS path LIMIT ${kwLim}`;
      const fileQ = `MATCH (n:File) WHERE toLower(n.path) CONTAINS $q${projFilter} RETURN n.path AS path LIMIT ${kwLim}`;
      const modelQ = `MATCH (n:Model) WHERE (toLower(n.name) CONTAINS $q OR toLower(coalesce(n.path, '')) CONTAINS $q)${projFilter} RETURN n.name AS name, n.path AS path LIMIT ${kwLim}`;
      const enumQ = `MATCH (n:Enum) WHERE (toLower(n.name) CONTAINS $q OR toLower(coalesce(n.path, '')) CONTAINS $q)${projFilter} RETURN n.name AS name, n.path AS path LIMIT ${kwLim}`;
      const nestQ = requestedScopeId
        ? `MATCH (n) WHERE (n:NestController OR n:NestService OR n:NestModule) AND (toLower(n.name) CONTAINS $q OR toLower(coalesce(n.path, '')) CONTAINS $q) AND ${whereProjectRepo("n", hasRepoScope)} RETURN labels(n)[0] AS typ, n.name AS name, n.path AS path, n.route AS route LIMIT ${kwLim}`
        : `MATCH (n) WHERE (n:NestController OR n:NestService OR n:NestModule) AND (toLower(n.name) CONTAINS $q OR toLower(coalesce(n.path, '')) CONTAINS $q) RETURN labels(n)[0] AS typ, n.name AS name, n.path AS path, n.route AS route LIMIT ${kwLim}`;
      const routeQ = `MATCH (n:Route) WHERE (toLower(n.path) CONTAINS $q OR toLower(coalesce(n.componentName, '')) CONTAINS $q)${projFilter} RETURN n.path AS path, n.componentName AS componentName LIMIT ${kwLim}`;
      const domainQ = `MATCH (n:DomainConcept) WHERE toLower(n.name) CONTAINS $q${projFilter} RETURN n.name AS name, n.category AS category LIMIT ${kwLim}`;
      const sbQ = `MATCH (n:StorybookDoc) WHERE (toLower(n.title) CONTAINS $q OR toLower(coalesce(n.sourcePath, '')) CONTAINS $q)${projFilter} RETURN n.title AS title, n.sourcePath AS path LIMIT ${kwLim}`;
      const mdQ = `MATCH (n:MarkdownDoc) WHERE (toLower(n.title) CONTAINS $q OR toLower(coalesce(n.sourcePath, '')) CONTAINS $q)${projFilter} RETURN n.title AS title, n.sourcePath AS path LIMIT ${kwLim}`;
      const mergeRows = async (q: string) => {
        const rows: unknown[] = [];
        await runOnProjectGraphs(graphRouteId, async (g, ctx) => {
          const p = {
            params: {
              q: lowerQ,
              ...(requestedScopeId ? { projectId: ctx.cypherProjectId, ...(hasRepoScope ? { repoId: scopeRepoId! } : {}) } : {}),
            },
          };
          const res = (await g.query(q, p)) as { data?: unknown[] };
          for (const row of res.data ?? []) rows.push(row);
        });
        return { data: rows as unknown[][] };
      };
      const [compRes, funcRes, fileRes, modelRes, enumRes, nestRes, routeRes, domainRes, sbRes, mdRes] =
        await Promise.all([
        mergeRows(compQ),
        mergeRows(funcQ),
        mergeRows(fileQ),
        mergeRows(modelQ),
        mergeRows(enumQ),
        mergeRows(nestQ),
        mergeRows(routeQ),
        mergeRows(domainQ),
        mergeRows(sbQ),
        mergeRows(mdQ),
      ]);
      const seenKeys = new Set(results.map((r) => `${r.type}:${r.name}`));
      const pushUnique = (type: string, name: string, pid?: string, rawName?: string, path?: string) => {
        if (results.length >= limit) return;
        const key = `${type}:${name}`;
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        results.push({ type, name, rawName, path, projectId: pid });
      };
      for (const row of asObjRows(compRes.data)) {
        const n = _rv<string>(row, "name");
        const path = _rv<string>(row, "path") ?? "";
        if (n != null && textMatchesQuery(n, query)) {
          pushUnique("Component", path ? `${n} — ${path}` : n, undefined, n, path);
        }
      }
      for (const row of asObjRows(funcRes.data)) {
        const name = _rv<string>(row, "name") ?? "";
        const path = _rv<string>(row, "path") ?? "";
        const blob = [name, path].filter(Boolean).join(" ");
        if (textMatchesQuery(blob, query)) {
          pushUnique("Function", path ? `${name} — ${path}` : name, undefined, name, path);
        }
      }
      for (const row of asObjRows(fileRes.data)) {
        const path = _rv<string>(row, "path") ?? "";
        if (textMatchesQuery(path, query)) pushUnique("File", path);
      }
      for (const row of asObjRows(modelRes.data)) {
        const name = _rv<string>(row, "name") ?? "";
        const path = _rv<string>(row, "path") ?? "";
        const blob = [name, path].filter(Boolean).join(" ");
        if (textMatchesQuery(blob, query)) {
          pushUnique("Model", path ? `${name} — ${path}` : name, undefined, name, path);
        }
      }
      for (const row of asObjRows(enumRes.data)) {
        const name = _rv<string>(row, "name");
        const path = _rv<string>(row, "path");
        const blob = [name, path].filter(Boolean).join(" ");
        if (textMatchesQuery(blob, query)) {
          pushUnique("Enum", path ? `${name ?? ""} — ${path}` : (name ?? ""));
        }
      }
      for (const row of asObjRows(nestRes.data)) {
        const typ = _rv<string>(row, "typ");
        const name = _rv<string>(row, "name");
        const path = _rv<string>(row, "path");
        const route = _rv<string>(row, "route");
        const searchable = [typ, name, path, route].filter(Boolean).join(" ");
        if (searchable && textMatchesQuery(searchable, query)) {
          const routeStr = route ? ` [${route}]` : "";
          pushUnique(typ ?? "Nest", `${name ?? ""} — ${path ?? ""}${routeStr}`);
        }
      }
      for (const row of asObjRows(routeRes.data)) {
        const path = _rv<string>(row, "path");
        const comp = _rv<string>(row, "componentName");
        const searchable = [path, comp].filter(Boolean).join(" ");
        if (searchable && textMatchesQuery(searchable, query)) {
          pushUnique("Route", `${path ?? "/"} → ${comp ?? ""}`);
        }
      }
      for (const row of asObjRows(domainRes.data)) {
        const name = _rv<string>(row, "name");
        const cat = _rv<string>(row, "category");
        const searchable = [name, cat].filter(Boolean).join(" ");
        if (searchable && textMatchesQuery(searchable, query)) {
          pushUnique("DomainConcept", cat ? `${name ?? ""} (${cat})` : (name ?? ""));
        }
      }
      for (const row of asObjRows(sbRes.data)) {
        const title = _rv<string>(row, "title") ?? "";
        const path = _rv<string>(row, "path") ?? "";
        const searchable = [title, path].filter(Boolean).join(" ");
        if (searchable && textMatchesQuery(searchable, query)) {
          pushUnique("StorybookDoc", path ? `${title || "Storybook"} — ${path}` : title || path);
        }
      }
      for (const row of asObjRows(mdRes.data)) {
        const title = _rv<string>(row, "title") ?? "";
        const path = _rv<string>(row, "path") ?? "";
        const searchable = [title, path].filter(Boolean).join(" ");
        if (searchable && textMatchesQuery(searchable, query)) {
          pushUnique("MarkdownDoc", path ? `${title || "Doc"} — ${path}` : title || path);
        }
      }
    }

    /** OpenApiOperation sin embedding aún cae en keyword fallback si hay cupo tras vector. */
    if (requestedScopeId && results.length < limit) {
      const kwOp = Math.min(200, mcpLimits.semanticKeywordSubqueryLimit);
      const openApiQ = `MATCH (op:OpenApiOperation) WHERE ${whereProjectRepo("op", hasRepoScope)} RETURN op.method AS method, op.pathTemplate AS pathTemplate, op.specPath AS specPath LIMIT ${kwOp}`;
      const opRows: unknown[] = [];
      await runOnProjectGraphs(graphRouteId, async (g, ctx) => {
        const p = {
          params: { projectId: ctx.cypherProjectId, ...(hasRepoScope ? { repoId: scopeRepoId! } : {}) },
        };
        const res = (await g.query(openApiQ, p)) as { data?: unknown[] };
        for (const row of res.data ?? []) opRows.push(row);
      });
      const seenOp = new Set(results.map((r) => `${r.type}:${r.name}`));
      const pushOp = (type: string, name: string) => {
        if (results.length >= limit) return;
        const k = `${type}:${name}`;
        if (seenOp.has(k)) return;
        seenOp.add(k);
        results.push({ type, name });
      };
      const apiIntent = /\b(api|routes?|endpoints?|controllers?|services|openapi|swagger|nest|http)\b/i.test(query);
      for (const row of asObjRows(opRows)) {
        const method = _rv<string>(row, "method");
        const pathTemplate = _rv<string>(row, "pathTemplate");
        const specPath = _rv<string>(row, "specPath");
        const blob = [method, pathTemplate, specPath].filter(Boolean).join(" ");
        if (!blob) continue;
        if (apiIntent || textMatchesQuery(blob, query)) {
          pushOp("OpenApiOperation", `${method ?? ""} ${pathTemplate ?? ""} — ${specPath ?? ""}`.trim());
        }
      }
    }

    const vectorContributed = countAfterVector > 0;
    const modeLabel =
      vectorContributed
        ? " (vector)"
        : usedVector
          ? results.length > 0
            ? " (keyword tras vector sin coincidencias)"
            : " (vector sin hits)"
          : " (keyword)";
    const lines = [`## Búsqueda: "${query}"${modeLabel}`, "", ...results.slice(0, limit).map((r) => `- **${r.type}:** ${r.name}`)];
    if (results.length === 0) {
      lines.push(
        "No se encontraron resultados.",
        "",
        "_Sugerencias: `projectId` puede ser el id del **repositorio** (`roots[].id`); el MCP resuelve el `projectId` de Falkor. Si sigue vacío: `POST /repositories/:id/embed-index`, términos del código (p. ej. `paciente`, `cita`) o Cypher._",
      );
    } else {
      const egoSignatures = await buildEgoGraphSignatures(results.slice(0, limit), graphRouteId, scopeRepoId);
      if (egoSignatures) {
        lines.push("", egoSignatures);
      }
    }
    const semText = lines.join("\n");
    await cache.set(cacheKeySem, semText, 300);
    return { content: [{ type: "text", text: semText }] };
  }

  if (name === "get_sync_status") {
    let projectId = args?.projectId as string | undefined;
    const currentFilePath = args?.currentFilePath as string | undefined;
    if (!projectId && currentFilePath) {
      projectId = (await applyShardingInference(undefined, currentFilePath)) ?? undefined;
    }
    if (!projectId) {
      return {
        content: [{ type: "text", text: "**Error:** Se requiere `projectId` (list_known_projects) o `currentFilePath`." }],
        isError: true,
      };
    }
    const ingestUrl = (process.env.INGEST_URL ?? process.env.ARIADNESPEC_INGEST_URL ?? "http://localhost:3002").replace(/\/$/, "");
    const cache = getMcpToolCache();
    const cacheKey = `ariadne:sync_status:${projectId}`;

    const cachedSync = await cache.get(cacheKey);
    if (cachedSync) {
      return { content: [{ type: "text", text: `### Estado de Sincronización (Cached)\n\n${cachedSync}` }] };
    }

    try {
      const res = await fetch(`${ingestUrl}/projects/${projectId}/sync-status`);
      if (!res.ok) {
        return { content: [{ type: "text", text: `**Error ${res.status}:** No se pudo obtener el estado del proyecto.` }], isError: true };
      }
      const data = (await res.json()) as SyncStatusResponse;
      const statusIcon =
        data.status === "up_to_date" ? "✅" : data.status === "syncing" ? "⏳" : data.stale ? "⚠️" : "❌";
      const staleLine = data.stale
        ? `\n- **Stale:** sí (> ${data.staleAfterHours}h o nunca sync). ${data.recommendation ?? "Ejecuta resync."}`
        : "\n- **Stale:** no";
      const text = `${statusIcon} **Estatus:** \`${data.status}\`\n- **Última Sincronización:** ${data.lastSync ? new Date(data.lastSync).toLocaleString() : "Nunca"}\n- **Commit indexado:** ${data.lastCommitSha ?? "—"}${staleLine}\n\n**Repos:**\n${(data.repositories ?? []).map((r) => `- \`${r.repoSlug}\` (${r.id.slice(0, 8)}…) — ${r.stale ? "⚠️ stale" : "✅ OK"}`).join("\n") || "—"}\n\n**Jobs Recientes:**\n${(data.details || []).slice(0, mcpLimits.syncStatusRecentJobsMax).map((j: SyncStatusJobDetail) => `- [${j.type}] ${j.status === "completed" ? "✅" : "❌"} (${new Date(j.startedAt).toLocaleDateString()})`).join("\n")}`;
      
      await cache.set(cacheKey, text, 30);
      return { content: [{ type: "text", text: `### Estado de Sincronización\n\n${text}` }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `**Error de red (Ingest):** ${err.message}` }], isError: true };
    }
  }

  if (name === "get_c4_model") {
    const projectId = args?.projectId as string | undefined;
    const level = ((args?.level as string) ?? "container").toLowerCase();
    const regenerate = Boolean(args?.regenerate);
    const useLlm = Boolean(args?.useLlm);
    const containerKey = args?.containerKey as string | undefined;
    const genBody = {
      level,
      useLlm: level === "context" ? useLlm : undefined,
      containerKey: level === "component" ? containerKey : undefined,
    };
    if (!projectId) {
      return {
        content: [{ type: "text", text: "**Error:** Se requiere `projectId` (list_known_projects)." }],
        isError: true,
      };
    }
    const ingestUrl = (process.env.INGEST_URL ?? process.env.ARIADNESPEC_INGEST_URL ?? "http://localhost:3002").replace(/\/$/, "");
    try {
      if (regenerate) {
        const gen = await fetch(`${ingestUrl}/projects/${projectId}/c4/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(genBody),
        });
        if (!gen.ok) {
          const errText = await gen.text();
          return { content: [{ type: "text", text: `**Error ${gen.status}:** ${errText}` }], isError: true };
        }
      }
      let res = await fetch(`${ingestUrl}/projects/${projectId}/c4?level=${encodeURIComponent(level)}`);
      if (res.status === 404 && !regenerate) {
        const gen = await fetch(`${ingestUrl}/projects/${projectId}/c4/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(genBody),
        });
        if (!gen.ok) {
          const errText = await gen.text();
          return { content: [{ type: "text", text: `**Error ${gen.status}:** ${errText}` }], isError: true };
        }
        res = await fetch(`${ingestUrl}/projects/${projectId}/c4?level=${encodeURIComponent(level)}`);
      }
      if (!res.ok) {
        const errText = await res.text();
        return { content: [{ type: "text", text: `**Error ${res.status}:** ${errText}` }], isError: true };
      }
      const data = await res.json();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return { content: [{ type: "text", text: `**Error C4:** ${err.message}` }], isError: true };
    }
  }

  if (name === "generate_c4_diagram") {
    const projectId = args?.projectId as string | undefined;
    const level = args?.level as string | undefined;
    const levels = args?.levels as string[] | undefined;
    const useLlm = Boolean(args?.useLlm);
    const containerKey = args?.containerKey as string | undefined;
    if (!projectId) {
      return {
        content: [{ type: "text", text: "**Error:** Se requiere `projectId` (list_known_projects)." }],
        isError: true,
      };
    }
    const ingestUrl = (process.env.INGEST_URL ?? process.env.ARIADNESPEC_INGEST_URL ?? "http://localhost:3002").replace(/\/$/, "");
    const genBody: Record<string, unknown> = {};
    if (levels?.length) genBody.levels = levels;
    else if (level) genBody.level = level;
    if (useLlm) genBody.useLlm = true;
    if (containerKey) genBody.containerKey = containerKey;
    try {
      const gen = await fetch(`${ingestUrl}/projects/${projectId}/c4/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(genBody),
      });
      if (!gen.ok) {
        const errText = await gen.text();
        return { content: [{ type: "text", text: `**Error ${gen.status}:** ${errText}` }], isError: true };
      }
      const result = await gen.json();
      const generatedLevels: string[] = result.levels
        ? Object.keys(result.levels)
        : level
          ? [level]
          : levels?.length
            ? levels
            : ["container"];
      const htmlUrls = generatedLevels.map((lv) => ({
        level: lv,
        htmlUrl: `${ingestUrl}/projects/${projectId}/c4/html?level=${encodeURIComponent(lv)}`,
      }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ projectId, generated: result, htmlUrls }, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return { content: [{ type: "text", text: `**Error generate C4:** ${err.message}` }], isError: true };
    }
  }

  if (name === "diff_c4_model") {
    const projectId = args?.projectId as string | undefined;
    const fromSnapshotId = args?.fromSnapshotId as string | undefined;
    const toSnapshotId = args?.toSnapshotId as string | undefined;
    if (!projectId || !fromSnapshotId || !toSnapshotId) {
      return {
        content: [{ type: "text", text: "**Error:** Se requieren projectId, fromSnapshotId y toSnapshotId." }],
        isError: true,
      };
    }
    const ingestUrl = (process.env.INGEST_URL ?? process.env.ARIADNESPEC_INGEST_URL ?? "http://localhost:3002").replace(/\/$/, "");
    try {
      const res = await fetch(
        `${ingestUrl}/projects/${projectId}/c4/diff?from=${encodeURIComponent(fromSnapshotId)}&to=${encodeURIComponent(toSnapshotId)}`,
      );
      if (!res.ok) {
        const errText = await res.text();
        return { content: [{ type: "text", text: `**Error ${res.status}:** ${errText}` }], isError: true };
      }
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `**Error diff C4:** ${err.message}` }], isError: true };
    }
  }

  if (name === "get_debt_report") {
    let projectId = args?.projectId as string | undefined;
    const currentFilePath = args?.currentFilePath as string | undefined;
    if (!projectId && currentFilePath) {
      projectId = (await applyShardingInference(undefined, currentFilePath)) ?? undefined;
    }
    if (!projectId) {
      return { content: [{ type: "text", text: "**Error:** Se requiere `projectId`." }], isError: true };
    }
    const cache = getMcpToolCache();
    const cacheKeyDebt = `ariadne:debt_report:v1:${projectId}`;
    const cachedDebt = await cache.get(cacheKeyDebt);
    if (cachedDebt) return { content: [{ type: "text", text: cachedDebt }] };

    try {
      const q = `
        MATCH (n)
        WHERE (n.projectId = $projectId OR n.repositoryId = $projectId) AND (n:Function OR n:Component)
        WITH n, size((n)-[:CALLS]->()) AS outDegree, size((n)<-[:CALLS]-()) AS inDegree
        WHERE outDegree = 0 AND inDegree = 0
        RETURN n.name AS nodeName, n.path AS filePath
        LIMIT ${mcpLimits.debtReportIsolatedLimit}
      `;
      const res = await graph.query(q, { params: { projectId } });
      const isolated = res.data as Array<Record<string, any>> || [];
      const lines = isolated.map((r) => `- \`${r.nodeName}\` en \`${r.filePath}\``);
      const text = lines.length ? lines.join("\n") : "No se encontró código muerto o aislado evidente.";
      const debtText = `### Informe de Deuda Técnica (Nativo)\n\n**Posibles nodos huérfanos/muertos:**\n${text}`;
      await cache.set(cacheKeyDebt, debtText, 300);
      return { content: [{ type: "text", text: debtText }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `**Error:** ${err.message}` }], isError: true };
    }
  }

  if (name === "find_duplicates") {
    let projectId = args?.projectId as string | undefined;
    const currentFilePath = args?.currentFilePath as string | undefined;
    if (!projectId && currentFilePath) {
      projectId = (await applyShardingInference(undefined, currentFilePath)) ?? undefined;
    }
    if (!projectId) {
      return { content: [{ type: "text", text: "**Error:** Se requiere `projectId`." }], isError: true };
    }
    const cache = getMcpToolCache();
    const cacheKeyDup = `ariadne:find_duplicates:v1:${projectId}`;
    const cachedDup = await cache.get(cacheKeyDup);
    if (cachedDup) return { content: [{ type: "text", text: cachedDup }] };
    
    try {
      const q = `
        MATCH (f:File)
        WHERE (f.projectId = $projectId OR f.repositoryId = $projectId) AND f.contentHash IS NOT NULL
        WITH f.contentHash AS cHash, collect(f.path) AS files, count(f) AS count
        WHERE count > 1
        RETURN cHash, files, count
        ORDER BY count DESC LIMIT ${mcpLimits.findDuplicatesGroupLimit}
      `;
      const res = await graph.query(q, { params: { projectId } });
      const duplicates = res.data as Array<Record<string, any>> || [];
      if (duplicates.length === 0) {
        const noDupText = "No se encontraron duplicados exactos basados en hash de contenido.";
        await cache.set(cacheKeyDup, noDupText, 300);
        return { content: [{ type: "text", text: noDupText }] };
      }

      const text = duplicates.map((r, i) => 
        `#### Grupo ${i+1} (${r.count} archivos)\n- **Hash:** \`${String(r.cHash).substring(0, 8)}\`\n- **Archivos:**\n${(r.files as string[]).map(f => `  - \`${f}\``).join("\n")}`
      ).join("\n\n");

      const dupText = `### Análisis de Duplicados (Nativo)\n\nSe encontraron ${duplicates.length} grupos de archivos idénticos en el proyecto.\n\n${text}`;
      await cache.set(cacheKeyDup, dupText, 300);
      return { content: [{ type: "text", text: dupText }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `**Error:** ${err.message}` }], isError: true };
    }
  }

  if (name === "get_project_analysis") {
    let projectOrRepoId = (args?.projectId as string | undefined)?.trim() ?? "";
    const currentFilePath = args?.currentFilePath as string | undefined;
    const mode = ((args?.mode as string) ?? "diagnostico") as
      | "diagnostico"
      | "duplicados"
      | "reingenieria"
      | "codigo_muerto"
      | "seguridad";
    const scope = args?.scope as
      | { repoIds?: string[]; includePathPrefixes?: string[]; excludePathGlobs?: string[] }
      | undefined;
    const crossPackageDuplicates = args?.crossPackageDuplicates === true;
    if (!projectOrRepoId && currentFilePath) {
      projectOrRepoId = (await applyShardingInference(undefined, currentFilePath)) ?? "";
    }
    if (!projectOrRepoId) {
      return {
        content: [
          {
            type: "text",
            text: "**Error:** Se requiere `projectId` o `currentFilePath` (list_known_projects / inferencia).",
          },
        ],
        isError: true,
      };
    }
    const ingestUrl = process.env.INGEST_URL ?? process.env.ARIADNESPEC_INGEST_URL ?? "http://localhost:3002";
    const base = ingestUrl.replace(/\/$/, "");
    const isProject = await ingestProjectExists(projectOrRepoId);
    const idePath = currentFilePath?.trim() ? toAbsoluteIdePath(currentFilePath) : undefined;
    const url = isProject
      ? `${base}/projects/${encodeURIComponent(projectOrRepoId)}/analyze`
      : `${base}/repositories/${encodeURIComponent(projectOrRepoId)}/analyze`;
    const scopeBody =
      scope && (scope.repoIds?.length || scope.includePathPrefixes?.length || scope.excludePathGlobs?.length)
        ? { scope }
        : {};
    const dupFlag = crossPackageDuplicates ? { crossPackageDuplicates: true } : {};
    const body = isProject
      ? { mode, ...(idePath ? { idePath } : {}), ...scopeBody, ...dupFlag }
      : { mode, ...scopeBody, ...dupFlag };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const msg = await res.text();
        return { content: [{ type: "text", text: `**Error ${res.status}:** ${msg || res.statusText}` }], isError: true };
      }
      const data = (await res.json()) as { mode: string; summary: string; reportMeta?: Record<string, unknown> };
      const title =
        data.mode === "diagnostico" ? "Deuda técnica" :
        data.mode === "duplicados" ? "Código duplicado" :
        data.mode === "codigo_muerto" ? "Código muerto" :
        data.mode === "seguridad" ? "Auditoría de seguridad" :
        "Reingeniería";
      const passthrough =
        data.mode === "codigo_muerto"
          ? "[Presentar este análisis tal cual, sin reformatear ni añadir categorías. Es la clasificación oficial.]\n\n"
          : "";

      let summary = data.summary;
      let idForPathPrefixes = projectOrRepoId;
      if (isProject && idePath) {
        const resolved = await fetchResolveRepoForPath(projectOrRepoId, idePath);
        if (resolved?.repoId) idForPathPrefixes = resolved.repoId;
      }
      const config = loadAriadneProjectConfigNearFile(currentFilePath) ?? loadAriadneProjectConfig(process.cwd());
      if (config) {
        summary = summary.replace(/`([^`\n]+\.[a-zA-Z0-9]{1,4})`/g, (match, p1) => {
          if (p1.includes("/") || p1.includes("\\")) {
            const abs = resolveAbsolutePath(p1, idForPathPrefixes, config);
            if (abs && abs.startsWith("/")) {
              return `[${match}](file://${abs})`;
            }
          }
          return match;
        });
      }

      const metaBlock =
        data.reportMeta && Object.keys(data.reportMeta).length > 0
          ? `\n\n\`\`\`json\n${JSON.stringify({ reportMeta: data.reportMeta }, null, 2)}\n\`\`\`\n`
          : "";
      return { content: [{ type: "text", text: `## ${title}\n\n${passthrough}${summary}${metaBlock}` }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `**Error:** No se pudo obtener el análisis. ¿INGEST_URL configurado? ${msg}` }], isError: true };
    }
  }

  if (name === "generate_legacy_documentation") {
    let projectId = args?.projectId as string | undefined;
    const currentFilePath = args?.currentFilePath as string | undefined;
    if (!projectId && currentFilePath) {
      projectId = (await applyShardingInference(undefined, currentFilePath)) ?? undefined;
    }
    if (!projectId) {
      return {
        content: [
          {
            type: "text",
            text: "**Error:** Se requiere `projectId` o `currentFilePath`. Usa list_known_projects para IDs.",
          },
        ],
        isError: true,
      };
    }
    const ingestUrl = process.env.INGEST_URL ?? process.env.ARIADNESPEC_INGEST_URL ?? "http://localhost:3002";
    const scopeRaw = args?.scope;
    let scope: LegacyDocumentationScope | undefined =
      scopeRaw && typeof scopeRaw === "object" && !Array.isArray(scopeRaw)
        ? (scopeRaw as LegacyDocumentationScope)
        : undefined;
    if (projectId && currentFilePath) {
      const augmented = await augmentScopeWithInferredRepo(projectId, currentFilePath, scope as Record<string, unknown> | undefined);
      scope = augmented as LegacyDocumentationScope;
    }
    const timeoutMs = (() => {
      const raw = process.env.MCP_LEGACY_DOCUMENTATION_TIMEOUT_MS?.trim() ?? process.env.MCP_ASK_CODEBASE_TIMEOUT_MS?.trim();
      if (!raw) return 900_000;
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n >= 60_000 ? n : 900_000;
    })();
    const result = await invokeIngestLegacyDocumentation({
      ingestUrl,
      projectId,
      scope,
      currentFilePath,
      timeoutMs,
    });
    if (!result.ok) {
      const rateHint = result.status === 429 ? "\n\n_(Límite de tasa LLM/orquestador.)_" : "";
      return {
        content: [{ type: "text", text: `**Error:** ${result.error}${rateHint}` }],
        isError: true,
      };
    }
    const envelope = {
      format: "legacy_mdd_v1",
      source: "generate_legacy_documentation",
      mddDocument: (() => {
        try {
          return JSON.parse(result.answer.trim());
        } catch {
          return null;
        }
      })(),
      answer: result.answer,
    };
    const parts = [JSON.stringify(envelope, null, 2)];
    if (result.cypher) parts.push("", "```cypher", result.cypher, "```");
    return { content: [{ type: "text", text: parts.join("\n") }] };
  }

  if (name === "ask_codebase") {
    const question = (args?.question as string) ?? "";
    let projectId = args?.projectId as string | undefined;
    const currentFilePath = args?.currentFilePath as string | undefined;
    if (!question) {
      return { content: [{ type: "text", text: "**Error:** Se requiere `question`." }], isError: true };
    }
    if (!projectId && currentFilePath) {
      projectId = (await applyShardingInference(undefined, currentFilePath)) ?? undefined;
    }
    if (!projectId) {
      return {
        content: [{ type: "text", text: "**Error:** Se requiere `projectId` o `currentFilePath` para inferir el proyecto. Usa list_known_projects para IDs." }],
        isError: true,
      };
    }
    const ingestUrl = process.env.INGEST_URL ?? process.env.ARIADNESPEC_INGEST_URL ?? "http://localhost:3002";
    const base = ingestUrl.replace(/\/$/, "");
    const scopeRaw = args?.scope;
    let scope: Record<string, unknown> | undefined =
      scopeRaw && typeof scopeRaw === "object" && !Array.isArray(scopeRaw)
        ? (scopeRaw as Record<string, unknown>)
        : undefined;
    if (projectId && currentFilePath) {
      scope = await augmentScopeWithInferredRepo(projectId, currentFilePath, scope);
    }
    const rm = ((args?.responseMode as string) ?? "").trim().toLowerCase();
    const responseMode: "default" | "evidence_first" | "raw_evidence" =
      rm === "evidence_first"
        ? "evidence_first"
        : rm === "raw_evidence"
          ? "raw_evidence"
          : rm === "default"
            ? "default"
            : !rm
              ? "default"
              : "default";
    const deterministicRetriever =
      responseMode === "raw_evidence" || responseMode === "evidence_first" ? args?.deterministicRetriever !== false : undefined;
    const body = JSON.stringify({
      message: question,
      ...(scope && Object.keys(scope).length > 0 ? { scope } : {}),
      ...(typeof args?.twoPhase === "boolean" ? { twoPhase: args.twoPhase } : {}),
      responseMode,
      ...(responseMode === "raw_evidence" || responseMode === "evidence_first" ? { deterministicRetriever } : {}),
    });
    const askTimeoutMs = (() => {
      const raw = process.env.MCP_ASK_CODEBASE_TIMEOUT_MS?.trim();
      const def = responseMode === "raw_evidence" ? 900_000 : 300_000;
      if (!raw) return def;
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n >= 30_000 ? n : def;
    })();
    const opts = {
      method: "POST" as const,
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(askTimeoutMs),
    };
    const progressEvery = mcpAskCodebaseProgressLogIntervalMs();
    let progressTimer: ReturnType<typeof setInterval> | undefined;
    const ingestFetchStarted = Date.now();
    if (isMcpToolInvocationLoggingEnabled() && progressEvery > 0) {
      progressTimer = setInterval(() => {
        const now = Date.now();
        console.log(
          `[mcp-ariadne] ${stringifyMcpToolLogPayload({
            ts: new Date().toISOString(),
            event: "mcp_tool_call_progress",
            tool: "ask_codebase",
            phase: "ingest_chat_fetch",
            elapsedIngestFetchMs: now - ingestFetchStarted,
            elapsedSinceToolStartMs: now - __mcpCallStarted,
            responseMode,
            projectIdPrefix: projectId ? `${String(projectId).slice(0, 8)}…` : null,
            ingestAbortAfterMs: askTimeoutMs,
            note:
              "mcp_tool_call_end con ms total llega al terminar este POST a ingest/orchestrator; si solo ves progress, el pipeline sigue en curso.",
          })}`,
        );
      }, progressEvery);
    }
    try {
      let res = await fetch(`${base}/projects/${projectId}/chat`, opts);
      if (res.status === 404) res = await fetch(`${base}/repositories/${projectId}/chat`, opts);
      if (!res.ok) {
        const msg = await res.text();
        const rateHint =
          res.status === 429
            ? "\n\n_(Límite de tasa OpenRouter u orquestador: `LLM_MAX_CONCURRENT`, `LLM_MIN_REQUEST_INTERVAL_MS`; evita otras cargas con la misma API key.)_"
            : "";
        return {
          content: [{ type: "text", text: `**Error ${res.status}:** ${msg || res.statusText}${rateHint}` }],
          isError: true,
        };
      }
      const data = (await res.json()) as { answer: string; cypher?: string; result?: unknown };
      const parts: string[] = [data.answer];
      if (data.cypher) parts.push("", "```cypher", data.cypher, "```");
      return { content: [{ type: "text", text: parts.join("\n") }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout =
        /AbortError|timeout|ETIMEDOUT|HeadersTimeoutError|BodyTimeoutError/i.test(msg);
      const hint = isTimeout
        ? " Timeout de red o `AbortSignal` (sube `MCP_ASK_CODEBASE_TIMEOUT_MS` o `THEFORGE_MCP_TIMEOUT_MS` en el cliente). Si el ingest devolvió **429**, es límite de tasa del proveedor (p. ej. OpenRouter), no timeout MCP."
        : "";
      return {
        content: [
          {
            type: "text",
            text: `**Error:** No se pudo completar ask_codebase vía ingest. ¿INGEST_URL y orchestrator activos? ${msg}${hint}`,
          },
        ],
        isError: true,
      };
    } finally {
      if (progressTimer) clearInterval(progressTimer);
    }
  }

  if (name === "get_modification_plan") {
    const userDescription = (args?.userDescription as string) ?? "";
    let projectId = args?.projectId as string | undefined;
    const currentFilePath = args?.currentFilePath as string | undefined;
    if (!userDescription) {
      return { content: [{ type: "text", text: "**Error:** Se requiere `userDescription` (descripción de la modificación)." }], isError: true };
    }
    if (!projectId && currentFilePath) {
      projectId = (await applyShardingInference(undefined, currentFilePath)) ?? undefined;
    }
    if (!projectId) {
      return {
        content: [{ type: "text", text: "**Error:** Se requiere `projectId` o `currentFilePath` para inferir el proyecto. Usa list_known_projects para IDs." }],
        isError: true,
      };
    }
    const ingestUrl = process.env.INGEST_URL ?? process.env.ARIADNESPEC_INGEST_URL ?? "http://localhost:3002";
    const url = `${ingestUrl.replace(/\/$/, "")}/projects/${projectId}/modification-plan`;
    const scopeRaw = args?.scope;
    let scope: Record<string, unknown> | undefined =
      scopeRaw && typeof scopeRaw === "object" && !Array.isArray(scopeRaw)
        ? (scopeRaw as Record<string, unknown>)
        : undefined;
    if (projectId && currentFilePath) {
      scope = await augmentScopeWithInferredRepo(projectId, currentFilePath, scope);
    }
    const questionsMode = args?.questionsMode as "business" | "technical" | "both" | undefined;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userDescription,
          ...(scope && Object.keys(scope).length > 0 ? { scope } : {}),
          ...(currentFilePath?.trim() ? { currentFilePath: currentFilePath.trim() } : {}),
          ...(questionsMode === "technical" || questionsMode === "both" ? { questionsMode } : {}),
        }),
      });
      if (!res.ok) {
        const msg = await res.text();
        return { content: [{ type: "text", text: `**Error ${res.status}:** ${msg || res.statusText}` }], isError: true };
      }
      const data = (await res.json()) as {
        filesToModify: Array<{ path: string; repoId: string }>;
        questionsToRefine: string[];
        warnings?: string[];
        diagnostic?: { code: string; message: string; candidates?: unknown[] };
        graphEvidenceBundle?: unknown;
        changePlanTemplate?: {
          schemaVersion?: string;
          source?: string;
          projectId?: string;
          changeDescription?: string;
          referencePlan?: unknown;
          files?: Array<{ path: string; repoId?: string; changeType?: string; symbols?: string[] }>;
          tasks?: unknown[];
        };
      };
      const filesToModify = data.filesToModify ?? [];
      const questionsToRefine = data.questionsToRefine ?? [];
      const changePlanTemplate = data.changePlanTemplate ?? {
        schemaVersion: "1.0",
        source: "cursor",
        projectId,
        changeDescription: userDescription,
        referencePlan: { filesToModify, questionsToRefine },
        files: filesToModify.map((f) => ({
          path: f.path,
          repoId: f.repoId,
          changeType: "modify",
          symbols: [],
        })),
        tasks: [],
      };
      const text = JSON.stringify(
        {
          filesToModify,
          questionsToRefine,
          changePlanTemplate,
          ...(data.graphEvidenceBundle ? { graphEvidenceBundle: data.graphEvidenceBundle } : {}),
          ...(data.warnings?.length ? { warnings: data.warnings } : {}),
          ...(data.diagnostic ? { diagnostic: data.diagnostic } : {}),
        },
        null,
        2,
      );
      const taskCount = Array.isArray(changePlanTemplate.tasks) ? changePlanTemplate.tasks.length : 0;
      const hint = filesToModify.length > 0
        ? `\n\nUsa \`changePlanTemplate\` (tasks=${taskCount}, symbols pre-poblados) como base para Gate 2 (\`validate_change_plan\`). Cada archivo incluye \`path\` y \`repoId\`.`
        : "\n\nGate 2: tras editar el plan, llama `validate_change_plan` antes de modificar código.";
      return { content: [{ type: "text", text: text + hint }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `**Error:** No se pudo conectar al ingest. ¿INGEST_URL configurado? ${msg}` }], isError: true };
    }
  }

  if (name === "validate_change_plan") {
    let projectId = args?.projectId as string | undefined;
    const currentFilePath = args?.currentFilePath as string | undefined;
    const files = args?.files;
    if (!Array.isArray(files) || files.length === 0) {
      return {
        content: [{ type: "text", text: "**Error:** Se requiere `files` (array no vacío con al menos `path` por ítem)." }],
        isError: true,
      };
    }
    if (!projectId && currentFilePath) {
      projectId = (await applyShardingInference(undefined, currentFilePath)) ?? undefined;
    }
    if (!projectId) {
      return {
        content: [{
          type: "text",
          text: "**Error:** Se requiere `projectId` o `currentFilePath`. Usa list_known_projects.",
        }],
        isError: true,
      };
    }
    const ingestUrl = process.env.INGEST_URL ?? process.env.ARIADNESPEC_INGEST_URL ?? "http://localhost:3002";
    const url = `${ingestUrl.replace(/\/$/, "")}/projects/${encodeURIComponent(projectId)}/validate-change-plan`;
    const body = {
      schemaVersion: "1.0",
      projectId,
      source: (args?.source as string) ?? "mcp",
      changeDescription: args?.changeDescription,
      changeScope: args?.changeScope,
      files,
      apiChanges: args?.apiChanges,
      tasks: args?.tasks,
      referencePlan: args?.referencePlan,
      scope: args?.scope,
    };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const msg = await res.text();
        return { content: [{ type: "text", text: `**Error ${res.status}:** ${msg || res.statusText}` }], isError: true };
      }
      const data = await res.json();
      return {
        content: [{
          type: "text",
          text: JSON.stringify(data, null, 2),
        }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `**Error:** validate_change_plan: ${msg}` }], isError: true };
    }
  }

  if (name === "validate_tasks_json") {
    const projectId = args?.projectId as string | undefined;
    const tasksJson = args?.tasksJson;
    if (!projectId) {
      return {
        content: [{ type: "text", text: "**Error:** Se requiere `projectId`. Usa list_known_projects." }],
        isError: true,
      };
    }
    if (tasksJson == null) {
      return {
        content: [{ type: "text", text: "**Error:** Se requiere `tasksJson` (objeto Forge o `{ tasks: [...] }`)." }],
        isError: true,
      };
    }
    const ingestUrl = process.env.INGEST_URL ?? process.env.ARIADNESPEC_INGEST_URL ?? "http://localhost:3002";
    const url = `${ingestUrl.replace(/\/$/, "")}/projects/${encodeURIComponent(projectId)}/validate-tasks-json`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tasksJson,
          changeDescription: args?.changeDescription,
        }),
      });
      if (!res.ok) {
        const msg = await res.text();
        return { content: [{ type: "text", text: `**Error ${res.status}:** ${msg || res.statusText}` }], isError: true };
      }
      const data = await res.json();
      const verdict = (data as { verdict?: string }).verdict;
      const hint =
        verdict === "BLOCKED"
          ? "\n\n**BLOCKED** — no aceptar migration_tasks; corregir tasksJson y revalidar."
          : "";
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) + hint }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `**Error:** validate_tasks_json: ${msg}` }], isError: true };
    }
  }

  if (name === "validate_before_edit") {
    const nodeName = (args?.nodeName as string) ?? "";
    let projectId = args?.projectId as string | undefined;
    const currentFilePath = args?.currentFilePath as string | undefined;
    if (!projectId && currentFilePath) {
      projectId = (await applyShardingInference(undefined, currentFilePath)) ?? undefined;
    }
    graph = await getGraph(projectId ?? undefined);
    const cache = getMcpToolCache();
    const cacheKeyVal = `ariadne:validate_before_edit:v1:${projectId ?? "global"}:${nodeName}`;
    const cachedVal = await cache.get(cacheKeyVal);
    if (cachedVal) return { content: [{ type: "text", text: cachedVal }] };
    const exists = await nodeExists(graph, nodeName, projectId ?? null);
    if (!exists) {
      return {
        content: [{ type: "text", text: `[NOT_FOUND_IN_GRAPH]\n\n**Nodo \`${nodeName}\` no encontrado en el grafo.**\n\nVerifica el nombre o ejecuta sync/resync del proyecto. No proceder con la edición sin reindexar.` }],
        isError: true,
      };
    }
    const resolvedName = await resolveNodeName(graph, nodeName, projectId ?? null);
    const params: Record<string, string | number> = { nodeName: resolvedName };
    const whereParts: string[] = [];
    if (projectId) {
      params.projectId = projectId;
      whereParts.push(
        "(n.projectId = $projectId OR n.projectId IS NULL)",
        "(dependent.projectId = $projectId OR dependent.projectId IS NULL)"
      );
    }
    const where = whereParts.length ? ` WHERE ${whereParts.join(" AND ")}` : "";
    const impactQ = `MATCH path = (n {name: $nodeName})<-[:CALLS|RENDERS*1..3]-(dependent)${where}
WITH dependent, min(length(path)) AS distance, collect([x IN nodes(path) | x.name])[0] AS callChain
RETURN dependent.name AS name, labels(dependent) AS labels, distance, callChain
ORDER BY distance ASC
LIMIT 100`;
    const impactRes = (await graph.query(impactQ, { params })) as { data?: unknown[][] };
    const impactData = impactRes.data ?? [];
    const contractParams: Record<string, string> = { componentName: resolvedName };
    const matchProject = projectId ? ", projectId: $projectId" : "";
    if (projectId) contractParams.projectId = projectId;
    const contractQ = `MATCH (c:Component {name: $componentName${matchProject}}) RETURN c.propsContract AS propsContract LIMIT 1`;
    const contractRes = await graph.query(contractQ, { params: contractParams }) as { data?: Array<Record<string, unknown>> };
    let contractData: unknown[][] = [];
    const propsContractRaw = (contractRes.data ?? [])[0] ? _rv<string | null>((contractRes.data ?? [])[0], "propsContract") : null;
    if (propsContractRaw) {
      try {
        const parsedProps = JSON.parse(propsContractRaw) as Array<{ name: string; required?: boolean }>;
        contractData = parsedProps.map((p) => [p.name, p.required ?? false]);
      } catch {
        /* fallback */
      }
    }
    if (contractData.length === 0) {
      const fallbackContractQ = `MATCH (c:Component {name: $componentName${matchProject}})-[:HAS_PROP]->(p:Prop) RETURN p.name AS name, p.required AS required LIMIT 100`;
      const fallbackRes = await graph.query(fallbackContractQ, { params: contractParams }) as { data?: unknown[][] };
      contractData = fallbackRes.data ?? [];
    }
    const funcParams: Record<string, string> = { nodeName: resolvedName };
    if (projectId) funcParams.projectId = projectId;
    const funcProjFilter = projectId ? " AND f.projectId = $projectId" : "";
    const funcQ = `MATCH (f:Function) WHERE f.name = $nodeName${funcProjFilter} RETURN f.path AS path, f.description AS description, f.endpointCalls AS endpointCalls LIMIT ${mcpLimits.implementationFunctionsLimit}`;
    const funcRes = (await graph.query(funcQ, { params: funcParams })) as { data?: unknown[][] };
    const funcData = asObjRows(funcRes.data);
    const lines: string[] = [
      `## Validación pre-edit: ${nodeName}`,
      "",
      "### 1. Impacto (dependientes)",
    ];
    if (impactData.length === 0) {
      lines.push("Ningún dependiente encontrado.");
    } else {
      const seen = new Set<string>();
      for (const row of asObjRows(impactData)) {
        const name = _rv<string>(row, "name") ?? (Array.isArray(row) ? row[0] : null);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const distance = _rv<number | string>(row, "distance") ?? (Array.isArray(row) ? row[2] : null);
        const callChain = _rv<string[]>(row, "callChain") ?? (Array.isArray(row) ? row[3] : null);
        let extra = "";
        if (distance != null) {
          extra += ` [hop ${distance}]`;
        }
        if (Array.isArray(callChain) && callChain.length > 1) {
          extra += ` (vía: ${callChain.slice().reverse().join(" -> ")})`;
        }
        lines.push(`- **${name}**${extra}`);
      }
    }
    lines.push("", "### 2. Contrato (props)");
    if (contractData.length === 0) {
      lines.push("Sin props en el grafo (puede ser una función o modelo).");
    } else {
      for (const row of asObjRows(contractData)) {
        const name = _rv<string>(row, "name") ?? (Array.isArray(row) ? row[0] : null);
        const required = _rv<unknown>(row, "required") ?? (Array.isArray(row) ? row[1] : null);
        const reqStr = required === true || required === "true" ? "requerido" : "opcional";
        lines.push(`- **${name}** (${reqStr})`);
      }
    }
    if (funcData.length > 0) {
      lines.push("", "### 3. Funciones (path, descripción, endpoints)");
      const seen = new Set<string>();
      for (const row of funcData) {
        const path = _rv<string | null>(row, "path");
        const description = _rv<string | null>(row, "description");
        const endpointCallsRaw = _rv<string | null>(row, "endpointCalls");
        const key = `${path ?? ""}:${nodeName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const endpointCalls = (() => {
          try {
            const parsed = typeof endpointCallsRaw === "string" ? JSON.parse(endpointCallsRaw) : endpointCallsRaw;
            return Array.isArray(parsed) ? parsed as Array<{ method: string; line?: number }> : [];
          } catch { return []; }
        })();
        const endpointStr = endpointCalls.length
          ? ` — endpoints: ${endpointCalls.map((e) => `${e.method}${e.line ? `:L${e.line}` : ""}`).join(", ")}`
          : "";
        lines.push(`- **${path ?? "(sin path)"}**${description ? ` — ${String(description).slice(0, mcpLimits.implementationInlineDescChars)}` : ""}${endpointStr}`);
      }
    }
    lines.push("", "---", "**Antes de editar:** usa las props/firmas reales del grafo y considera el impacto en los dependientes.");
    const valText = lines.join("\n");
    await cache.set(cacheKeyVal, valText, 120);
    return { content: [{ type: "text", text: valText }] };
  }

  // --- get_definitions ---
  if (name === "get_definitions") {
    const symbolName = (args?.symbolName as string) ?? "";
    let projectId = args?.projectId as string | undefined;
    const currentFilePath = args?.currentFilePath as string | undefined;
    if (!projectId && currentFilePath) {
      projectId = (await applyShardingInference(undefined, currentFilePath)) ?? undefined;
    }
    const cache = getMcpToolCache();
    const cacheKeyDefs = `ariadne:definitions:v1:${projectId ?? "global"}:${symbolName}`;
    const cachedDefs = await cache.get(cacheKeyDefs);
    if (cachedDefs) return { content: [{ type: "text", text: cachedDefs }] };
    graph = await getGraph(projectId ?? undefined);
    const params: Record<string, string> = { symbolName };
    if (projectId) params.projectId = projectId;
    const compProj = projectId ? ", projectId: $projectId" : "";
    const compProjWhere = projectId ? " AND n.projectId = $projectId" : "";
    const projFilter = projectId ? " AND n.projectId = $projectId" : "";
    
    // Cargamos config local para resolución de paths
    const config = loadAriadneProjectConfig();

    const defLim = mcpLimits.definitionsPerKindLimit;
    const compQ = `MATCH (f:File)-[:CONTAINS]->(n:Component {name: $symbolName${compProj}}) RETURN f.path AS path, n.name AS name, 'Component' AS kind, n.repoId AS repoId LIMIT ${defLim}`;
    const compFallbackQ = `MATCH (n:Component {name: $symbolName}) WHERE 1=1${compProjWhere} OPTIONAL MATCH (f:File)-[:CONTAINS]->(n) WITH coalesce(f.path, '(sin path)') AS path, n.name AS name, n.repoId AS repoId RETURN path, name, 'Component' AS kind, repoId LIMIT ${defLim}`;
    const funcQ = `MATCH (n:Function) WHERE n.name = $symbolName${projFilter} RETURN n.path AS path, n.name AS name, n.startLine AS startLine, n.endLine AS endLine, 'Function' AS kind, n.repoId AS repoId LIMIT ${defLim}`;
    const modelQ = `MATCH (n:Model) WHERE n.name = $symbolName${projFilter} RETURN n.path AS path, n.name AS name, 'Model' AS kind, n.repoId AS repoId LIMIT ${defLim}`;
    
    const [compRes, funcRes, modelRes] = await Promise.all([
      graph.query(compQ, { params }) as Promise<{ data?: unknown[][] }>,
      graph.query(funcQ, { params }) as Promise<{ data?: unknown[][] }>,
      graph.query(modelQ, { params }) as Promise<{ data?: unknown[][] }>,
    ]);
    // Fallback: Component existe pero sin File-CONTAINS (indexación parcial)
    let compData = asObjRows(compRes.data);
    if (compData.length === 0) {
      const fallbackRes = (await graph.query(compFallbackQ, { params })) as { data?: unknown[][] };
      compData = asObjRows(fallbackRes.data);
    }
    const results: string[] = [];
    for (const row of compData) {
      const rawPath = _rv<string>(row, "path");
      const n = _rv<string>(row, "name");
      const repoId = _rv<string>(row, "repoId");
      const resolvedPath = rawPath ? resolveAbsolutePath(rawPath, repoId, config) : "(sin path)";
      if (n) results.push(`**Component** \`${n}\` → \`${resolvedPath}\``);
    }
    for (const row of asObjRows(funcRes.data)) {
      const rawPath = _rv<string>(row, "path");
      const n = _rv<string>(row, "name");
      const repoId = _rv<string>(row, "repoId");
      const startLine = _rv<number | null>(row, "startLine");
      const endLine = _rv<number | null>(row, "endLine");
      if (rawPath && n) {
        const resolvedPath = resolveAbsolutePath(rawPath, repoId, config);
        const lineInfo = startLine != null && endLine != null ? ` (L${startLine}-${endLine})` : "";
        results.push(`**Function** \`${n}\` → \`${resolvedPath}\`${lineInfo}`);
      }
    }
    for (const row of asObjRows(modelRes.data)) {
      const rawPath = _rv<string>(row, "path");
      const n = _rv<string>(row, "name");
      const repoId = _rv<string>(row, "repoId");
      if (rawPath && n) {
        const resolvedPath = resolveAbsolutePath(rawPath, repoId, config);
        results.push(`**Model** \`${n}\` → \`${resolvedPath}\``);
      }
    }
    if (results.length === 0) {
      return {
        content: [{ type: "text", text: `[NOT_FOUND_IN_GRAPH]\n\n**Símbolo \`${symbolName}\` no encontrado.** Verifica el nombre o reindexa.` }],
        isError: true,
      };
    }
    const defText = `## Definiciones: ${symbolName}\n\n${results.join("\n")}`;
    await cache.set(cacheKeyDefs, defText, 120);
    return { content: [{ type: "text", text: defText }] };
  }

  // --- get_references ---
  if (name === "get_references") {
    const symbolName = (args?.symbolName as string) ?? "";
    let projectId = args?.projectId as string | undefined;
    const currentFilePath = args?.currentFilePath as string | undefined;
    if (!projectId && currentFilePath) {
      projectId = (await applyShardingInference(undefined, currentFilePath)) ?? undefined;
    }
    const cache = getMcpToolCache();
    const cacheKeyRefs = `ariadne:references:v1:${projectId ?? "global"}:${symbolName}`;
    const cachedRefs = await cache.get(cacheKeyRefs);
    if (cachedRefs) return { content: [{ type: "text", text: cachedRefs }] };
    graph = await getGraph(projectId ?? undefined);
    const exists = await nodeExists(graph, symbolName, projectId ?? null);
    if (!exists) {
      return {
        content: [{ type: "text", text: `[NOT_FOUND_IN_GRAPH]\n\n**Símbolo \`${symbolName}\` no encontrado.**` }],
        isError: true,
      };
    }
    const params: Record<string, string> = { symbolName };
    if (projectId) params.projectId = projectId;
    const whereParts = projectId
      ? ["(n.projectId = $projectId OR n.projectId IS NULL)", "(dep.projectId = $projectId OR dep.projectId IS NULL)"]
      : [];
    const where = whereParts.length ? ` WHERE ${whereParts.join(" AND ")}` : "";
    const refsQ = `MATCH (n {name: $symbolName})<-[:CALLS|RENDERS]-(dep)${where}
      RETURN labels(dep)[0] AS kind, dep.name AS name, dep.path AS path, dep.repoId AS repoId`;
    const refsRes = (await graph.query(refsQ, { params })) as { data?: unknown[][] };
    const data = (refsRes.data ?? []);
    
    // Config local para resolución
    const config = loadAriadneProjectConfig();

    const seen = new Set<string>();
    const lines = [`## Referencias: ${symbolName}`, ""];
    for (const row of data) {
      const kind = _rv<string>(row, "kind");
      const depName = _rv<string>(row, "name");
      const rawPath = _rv<string | null>(row, "path");
      const repoId = _rv<string | null>(row, "repoId");
      
      const resolvedPath = rawPath ? resolveAbsolutePath(rawPath, repoId, config) : null;
      const key = `${kind}:${depName}:${resolvedPath ?? ""}`;
      
      if (seen.has(key)) continue;
      seen.add(key);
      const pathStr = resolvedPath ? ` — \`${resolvedPath}\`` : "";
      lines.push(`- **${kind}** \`${depName}\`${pathStr}`);
    }
    if (lines.length === 2) lines.push("Ninguna referencia encontrada (nadie lo llama ni lo renderiza).");
    const refText = lines.join("\n");
    await cache.set(cacheKeyRefs, refText, 120);
    return { content: [{ type: "text", text: refText }] };
  }

  // --- get_implementation_details ---
  if (name === "get_implementation_details") {
    const symbolName = (args?.symbolName as string) ?? "";
    let projectId = args?.projectId as string | undefined;
    const currentFilePath = args?.currentFilePath as string | undefined;
    if (!projectId && currentFilePath) {
      projectId = (await applyShardingInference(undefined, currentFilePath)) ?? undefined;
    }
    const cache = getMcpToolCache();
    const cacheKeyImpl = `ariadne:impl_details:v1:${projectId ?? "global"}:${symbolName}`;
    const cachedImpl = await cache.get(cacheKeyImpl);
    if (cachedImpl) return { content: [{ type: "text", text: cachedImpl }] };
    graph = await getGraph(projectId ?? undefined);
    const exists = await nodeExists(graph, symbolName, projectId ?? null);
    if (!exists) {
      return {
        content: [{ type: "text", text: `[NOT_FOUND_IN_GRAPH]\n\n**Símbolo \`${symbolName}\` no encontrado.**` }],
        isError: true,
      };
    }
    const params: Record<string, string> = { symbolName };
    const matchProj = projectId ? ", projectId: $projectId" : "";
    if (projectId) params.projectId = projectId;
    const propsQ = `MATCH (c:Component {name: $symbolName${matchProj}})-[:HAS_PROP]->(p:Prop) RETURN p.name AS name, p.required AS required`;
    const descQ = `MATCH (c:Component {name: $symbolName${matchProj}}) RETURN c.description AS description`;
    const funcQ = `MATCH (f:Function) WHERE f.name = $symbolName${projectId ? " AND f.projectId = $projectId" : ""} RETURN f.path AS path, f.description AS description, f.startLine AS startLine, f.endLine AS endLine, f.complexity AS complexity, f.endpointCalls AS endpointCalls LIMIT ${mcpLimits.implementationFunctionsLimit}`;
    const [propsRes, descRes, funcRes] = await Promise.all([
      graph.query(propsQ, { params }) as Promise<{ data?: unknown[][] }>,
      graph.query(descQ, { params }) as Promise<{ data?: unknown[][] }>,
      graph.query(funcQ, { params }) as Promise<{ data?: unknown[][] }>,
    ]);
    const lines = [`## Implementación: ${symbolName}`, ""];
    const descRows = asObjRows(descRes.data);
    const descRow = descRows[0];
    if (descRow && _rv<string>(descRow, "description")) lines.push(`**Descripción:** ${String(_rv(descRow, "description")).slice(0, mcpLimits.implementationDescChars)}`, "");
    const props = asObjRows(propsRes.data);
    if (props.length > 0) {
      lines.push("**Props (contrato):**", ...props.map((r) => `- ${_rv(r, "name")} (${_rv(r, "required") ? "requerido" : "opcional"})`), "");
    }
    const funcs = asObjRows(funcRes.data);
    if (funcs.length > 0) {
      lines.push("**Funciones (firma):**");
      for (const row of funcs) {
        const path = _rv<string>(row, "path");
        const description = _rv<string | null>(row, "description");
        const startLine = _rv<number | null>(row, "startLine");
        const endLine = _rv<number | null>(row, "endLine");
        const complexity = _rv<number | null>(row, "complexity");
        const endpointCallsRaw = _rv<string | null>(row, "endpointCalls");
        const loc = startLine != null && endLine != null ? ` L${startLine}-${endLine}` : "";
        const comp = complexity != null ? ` complexity=${complexity}` : "";
        let endpoints = "";
        try {
          const ec = typeof endpointCallsRaw === "string" ? JSON.parse(endpointCallsRaw) : endpointCallsRaw;
          if (Array.isArray(ec) && ec.length) endpoints = ` endpoints=${ec.map((e: { method?: string }) => e.method).join(",")}`;
        } catch { /* ignore */ }
        lines.push(`- \`${path ?? "(sin path)"}\`${loc}${comp}${endpoints}`);
        if (description) lines.push(`  ${String(description).slice(0, mcpLimits.implementationInlineDescChars)}`);
      }
    }
    const implText = lines.join("\n");
    await cache.set(cacheKeyImpl, implText, 120);
    return { content: [{ type: "text", text: implText }] };
  }

  // --- trace_reachability ---
  if (name === "trace_reachability") {
    const projectId = (args?.projectId as string) ?? "";
    let resolvedProjectId = projectId;
    const currentFilePath = args?.currentFilePath as string | undefined;
    if (!resolvedProjectId && currentFilePath) {
      resolvedProjectId = (await applyShardingInference(undefined, currentFilePath)) ?? "";
    }
    if (!resolvedProjectId) {
      return {
        content: [{ type: "text", text: "**Error:** Se requiere projectId o currentFilePath." }],
        isError: true,
      };
    }
    const cache = getMcpToolCache();
    const cacheKeyTrace = `ariadne:trace_reachability:v1:${resolvedProjectId}`;
    const cachedTrace = await cache.get(cacheKeyTrace);
    if (cachedTrace) return { content: [{ type: "text", text: cachedTrace }] };
    graph = await getGraph(resolvedProjectId);
    const params = { projectId: resolvedProjectId };
    const entryComponentsQ = `MATCH (r:Route {projectId: $projectId}) RETURN r.componentName AS name`;
    const entryFilesQ = `MATCH (f:File {projectId: $projectId}) WHERE f.path CONTAINS 'index.' OR f.path CONTAINS 'main.' OR f.path CONTAINS 'App.' RETURN f.path AS path`;
    const [routeRes, fileRes] = await Promise.all([
      graph.query(entryComponentsQ, { params }) as Promise<{ data?: unknown[][] }>,
      graph.query(entryFilesQ, { params }) as Promise<{ data?: unknown[][] }>,
    ]);
    const entryNames = new Set<string>();
    for (const row of (routeRes.data ?? [])) {
      const n = _rv<string>(row, "name");
      if (n) entryNames.add(n);
    }
    const allCompsQ = `MATCH (c:Component {projectId: $projectId}) RETURN c.name AS name`;
    const allFuncsQ = `MATCH (fn:Function {projectId: $projectId}) RETURN fn.name AS name, fn.path AS path`;
    const [allCompsRes, allFuncsRes] = await Promise.all([
      graph.query(allCompsQ, { params }) as Promise<{ data?: Array<Record<string, unknown>> }>,
      graph.query(allFuncsQ, { params }) as Promise<{ data?: Array<Record<string, unknown>> }>,
    ]);
    const allComponents = new Set(asObjRows(allCompsRes.data).map((r) => _rv<string>(r, "name")).filter((x): x is string => !!x));
    const allFuncs = new Map<string, string>();
    for (const row of (allFuncsRes.data ?? [])) {
      const n = _rv<string>(row, "name");
      const p = _rv<string>(row, "path");
      if (n && p) allFuncs.set(`${p}::${n}`, p);
    }
    const reachable = new Set<string>(entryNames);
    let changed = true;
    while (changed) {
      changed = false;
      for (const name of [...reachable]) {
        const callsQ = `MATCH (n {name: $name})-[r:CALLS|RENDERS]->(dep) WHERE (n.projectId = $projectId OR n.projectId IS NULL) AND (dep.projectId = $projectId OR dep.projectId IS NULL) RETURN dep.name AS name`;
        const res = (await graph.query(callsQ, { params: { ...params, name } })) as { data?: Array<Record<string, unknown>> };
        for (const row of (res.data ?? [])) {
          const depName = _rv<string>(row, "name");
          if (depName && !reachable.has(depName)) {
            reachable.add(depName);
            changed = true;
          }
        }
      }
    }
    const unreachableComps = [...allComponents].filter((c) => !reachable.has(c));
    const uncalledFuncsQ = `MATCH (fn:Function {projectId: $projectId}) WHERE NOT (fn)<-[:CALLS]-() RETURN fn.name AS name, fn.path AS path LIMIT ${mcpLimits.traceUncalledFuncsQueryLimit}`;
    const uncalledRes = (await graph.query(uncalledFuncsQ, { params })) as { data?: unknown[][] };
    const unreachableFuncs = ((uncalledRes.data ?? [])).map((r) => {
      const n = _rv<string>(r, "name");
      const p = _rv<string>(r, "path");
      return n && p ? `${n} (${p})` : "";
    }).filter(Boolean);
    const lines = [
      "## Código potencialmente muerto",
      "",
      "**Puntos de entrada:** Rutas + index/main/App",
      "",
      "**Componentes sin referencias desde entrada:**",
      ...(unreachableComps.length ? unreachableComps.map((c) => `- ${c}`).slice(0, mcpLimits.traceUnreachableComponentsMax) : ["(ninguno)"]),
      "",
      "**Funciones sin referencias:** (muestra)",
      ...(unreachableFuncs.length ? unreachableFuncs.slice(0, mcpLimits.traceUnreachableFuncsMax).map((f) => `- ${f}`) : ["(ninguna detectada)"]),
    ];
    const traceText = lines.join("\n");
    await cache.set(cacheKeyTrace, traceText, 300);
    return { content: [{ type: "text", text: traceText }] };
  }

  // --- check_export_usage ---
  if (name === "check_export_usage") {
    const projectId = (args?.projectId as string) ?? "";
    const filePath = args?.filePath as string | undefined;
    let resolvedProjectId = projectId;
    const currentFilePath = args?.currentFilePath as string | undefined;
    if (!resolvedProjectId && currentFilePath) {
      resolvedProjectId = (await applyShardingInference(undefined, currentFilePath)) ?? "";
    }
    if (!resolvedProjectId) {
      return {
        content: [{ type: "text", text: "**Error:** Se requiere projectId." }],
        isError: true,
      };
    }
    const cache = getMcpToolCache();
    const cacheKeyExp = `ariadne:export_usage:v1:${resolvedProjectId}`;
    const cachedExp = await cache.get(cacheKeyExp);
    if (cachedExp) return { content: [{ type: "text", text: cachedExp }] };
    graph = await getGraph(resolvedProjectId);
    const params: Record<string, string> = { projectId: resolvedProjectId };
    if (filePath) params.filePath = filePath;
    // Never inject " AND f.path ..." between the File node and -[:CONTAINS]-> (invalid Cypher). Optional path filter belongs in WHERE after the pattern.
    const pathFilter = filePath ? " AND f.path = $filePath" : "";
    const exportsQ = `MATCH (f:File {projectId: $projectId})-[:CONTAINS]->(n)
      WHERE (n:Component OR n:Function)${pathFilter}
      RETURN f.path AS filePath, labels(n)[0] AS kind, n.name AS name`;
    const exportsRes = (await graph.query(exportsQ, { params })) as { data?: unknown[][] };
    const routeCompsQ = `MATCH (r:Route {projectId: $projectId}) RETURN r.componentName AS name`;
    const routeRes = (await graph.query(routeCompsQ, { params })) as { data?: Array<Record<string, unknown>> };
    const routeNames = new Set(((routeRes.data ?? [])).map((r) => _rv<string>(r, "name")).filter(Boolean));
    const exportsData = (exportsRes.data ?? []);
    const unused: string[] = [];
    for (const row of exportsData) {
      const fp = _rv<string>(row, "filePath") ?? "";
      const kind = _rv<string>(row, "kind") ?? "";
      const n = _rv<string>(row, "name") ?? "";
      let hasDep = false;
      if (kind === "Component") {
        const depQ = `MATCH (dep)-[:RENDERS]->(c:Component {name: $name, projectId: $projectId}) RETURN 1 LIMIT 1`;
        const depRes = (await graph.query(depQ, { params: { ...params, name: n || "" } })) as { data?: unknown[][] };
        hasDep = (depRes.data ?? []).length > 0;
      } else {
        const depQ = `MATCH (caller:Function)-[:CALLS]->(callee:Function) WHERE callee.name = $name AND callee.path = $filePath AND callee.projectId = $projectId RETURN 1 LIMIT 1`;
        const depRes = (await graph.query(depQ, { params: { ...params, name: n || "", filePath: fp || "" } })) as { data?: unknown[][] };
        hasDep = (depRes.data ?? []).length > 0;
      }
      const inRoute = kind === "Component" && routeNames.has(n);
      if (!hasDep && !inRoute) unused.push(`${kind} \`${n}\` en \`${fp}\``);
    }
    const lines = [
      "## Exports sin uso activo",
      "",
      ...(unused.length ? unused.slice(0, mcpLimits.unusedExportsMax).map((u) => `- ${u}`) : ["No se detectaron exports obvios sin uso."]),
    ];
    const expText = lines.join("\n");
    await cache.set(cacheKeyExp, expText, 120);
    return { content: [{ type: "text", text: expText }] };
  }

  // --- get_affected_scopes ---
  if (name === "get_affected_scopes") {
    const nodeName = (args?.nodeName as string) ?? "";
    let projectId = args?.projectId as string | undefined;
    const currentFilePath = args?.currentFilePath as string | undefined;
    const includeTestFiles = (args?.includeTestFiles as boolean) ?? true;
    if (!projectId && currentFilePath) {
      projectId = (await applyShardingInference(undefined, currentFilePath)) ?? undefined;
    }
    graph = await getGraph(projectId ?? undefined);
    const cache = getMcpToolCache();
    const cacheKeyScopes = `ariadne:affected_scopes:v1:${projectId ?? "global"}:${nodeName}:${includeTestFiles}`;
    const cachedScopes = await cache.get(cacheKeyScopes);
    if (cachedScopes) return { content: [{ type: "text", text: cachedScopes }] };
    const exists = await nodeExists(graph, nodeName, projectId ?? null);
    if (!exists) {
      return {
        content: [{ type: "text", text: `[NOT_FOUND_IN_GRAPH]\n\n**Nodo \`${nodeName}\` no encontrado.**` }],
        isError: true,
      };
    }
    const params: Record<string, string | number> = { nodeName };
    const whereParts = projectId
      ? ["(n.projectId = $projectId OR n.projectId IS NULL)", "(dep.projectId = $projectId OR dep.projectId IS NULL)"]
      : [];
    const where = whereParts.length ? ` WHERE ${whereParts.join(" AND ")}` : "";
    if (projectId) params.projectId = projectId;
    const impactQ = `MATCH (n {name: $nodeName})<-[:CALLS|RENDERS*]-(dep)${where} RETURN dep.name AS name, labels(dep) AS labels, dep.path AS path`;
    const impactRes = (await graph.query(impactQ, { params })) as { data?: unknown[][] };
    const data = (impactRes.data ?? []);
    const affectedFiles = new Set<string>();
    const affectedNodes: string[] = [];
    for (const row of data) {
      const depName = _rv<string>(row, "name") ?? "";
      const labels = _rv<string[] | string>(row, "labels");
      const path = _rv<string | null>(row, "path");
      const labelsStr = Array.isArray(labels) ? labels.join(",") : String(labels ?? "");
      affectedNodes.push(`${labelsStr || "Node"} \`${depName}\``);
      if (path) affectedFiles.add(path);
    }
    const lines = [
      `## Ámbitos afectados: ${nodeName}`,
      "",
      "**Nodos dependientes:**",
      ...(affectedNodes.length ? [...new Set(affectedNodes)].map((n) => `- ${n}`).slice(0, mcpLimits.affectedNodesMax) : ["(ninguno)"]),
      "",
      "**Archivos afectados:**",
      ...(affectedFiles.size ? [...affectedFiles].map((f) => `- ${f}`).slice(0, mcpLimits.affectedFilesMax) : ["(ninguno)"]),
      ...(includeTestFiles ? ["", "💡 Revisar también archivos *.test.* y *.spec.* en directorios afectados."] : []),
    ];
    const scopesText = lines.join("\n");
    await cache.set(cacheKeyScopes, scopesText, 120);
    return { content: [{ type: "text", text: scopesText }] };
  }

  // --- check_breaking_changes ---
  if (name === "check_breaking_changes") {
    const nodeName = (args?.nodeName as string) ?? "";
    const removedParams = (args?.removedParams as string[]) ?? [];
    const removedFunctionParams = (args?.removedFunctionParams as string[]) ?? [];
    const changeType = (args?.changeType as string) ?? "props";
    let projectId = args?.projectId as string | undefined;
    const currentFilePath = args?.currentFilePath as string | undefined;
    if (!projectId && currentFilePath) {
      projectId = (await applyShardingInference(undefined, currentFilePath)) ?? undefined;
    }
    graph = await getGraph(projectId ?? undefined);
    const cache = getMcpToolCache();
    const rmParamsKey = removedParams.sort().join(",");
    const cacheKeyBreak = `ariadne:breaking_changes:v1:${projectId ?? "global"}:${nodeName}:${rmParamsKey}`;
    const cachedBreak = await cache.get(cacheKeyBreak);
    if (cachedBreak) return { content: [{ type: "text", text: cachedBreak }] };
    const exists = await nodeExists(graph, nodeName, projectId ?? null);
    if (!exists) {
      return {
        content: [{ type: "text", text: `[NOT_FOUND_IN_GRAPH]\n\n**Nodo \`${nodeName}\` no encontrado.**` }],
        isError: true,
      };
    }
    const params: Record<string, string> = { nodeName };
    if (projectId) params.projectId = projectId;
    const whereParts = projectId
      ? ["(n.projectId = $projectId OR n.projectId IS NULL)", "(dep.projectId = $projectId OR dep.projectId IS NULL)"]
      : [];
    const where = whereParts.length ? ` WHERE ${whereParts.join(" AND ")}` : "";
    const countQ = `MATCH (n {name: $nodeName})<-[:CALLS|RENDERS*]-(dep)${where} RETURN count(dep) AS cnt`;
    const countRes = (await graph.query(countQ, { params })) as { data?: Array<Record<string, unknown>> };
    const firstRow = (countRes.data ?? [])[0] as Record<string, unknown> | undefined;
    const depCount = firstRow ? Number(_rv(firstRow, "cnt") ?? _rv(firstRow, 0) ?? 0) : 0;
    const propsQ = `MATCH (c:Component {name: $nodeName})-[:HAS_PROP]->(p:Prop) RETURN p.name AS name`;
    const propsRes = (await graph.query(propsQ, { params })) as { data?: Array<Record<string, unknown>> };
    const currentProps = new Set(((propsRes.data ?? [])).map((r) => _rv<string>(r, "name")).filter(Boolean));
    const removed = removedParams.filter((p) => currentProps.has(p));
    const fnCallQ = `MATCH (caller)-[:CALLS]->(f:Function {name: $nodeName}) RETURN caller.name AS caller, caller.path AS path LIMIT 15`;
    const fnCallRes = (await graph.query(fnCallQ, { params })) as { data?: Array<Record<string, unknown>> };
    const callers = (fnCallRes.data ?? []).map((r) => String(_rv(r, "path") ?? _rv(r, "caller") ?? "")).filter(Boolean);
    const lines = [
      `## Análisis de cambios: ${nodeName}`,
      "",
      `**Dependientes (CALLS|RENDERS):** ${depCount}`,
      `**Tipo de cambio:** ${changeType}`,
      "",
      ...(removed.length
        ? [
            "⚠️ **Props:** parámetros en contrato que se planean eliminar:",
            ...removed.map((p) => `- \`${p}\``),
            "",
          ]
        : []),
      ...(removedFunctionParams.length
        ? [
            "⚠️ **Function params:** revisar call sites manualmente:",
            ...removedFunctionParams.map((p) => `- \`${p}\``),
            "",
          ]
        : []),
      ...(callers.length
        ? ["**Call sites (Function CALLS, top 15):**", ...callers.map((p) => `- \`${p}\``), ""]
        : []),
      ...(removed.length || removedFunctionParams.length
        ? [`Esto podría romper ${depCount} sitio(s) que usan este nodo. Revisar cada llamada antes de aplicar.`]
        : removedParams.length
          ? ["(Los parámetros indicados no existen en el contrato actual; revisar nombres.)"]
          : ["Sin parámetros indicados para eliminar. Si cambias la firma, verificar manualmente los dependientes."]),
    ];
    const breakText = lines.join("\n");
    await cache.set(cacheKeyBreak, breakText, 120);
    return { content: [{ type: "text", text: breakText }] };
  }

  // --- find_similar_implementations ---
  if (name === "find_similar_implementations") {
    const query = (args?.query as string) ?? "";
    const projectId = args?.projectId as string | undefined;
    const limit = Math.min(mcpLimits.findSimilarMax, Math.max(1, (args?.limit as number) ?? mcpLimits.findSimilarDefault));
    const currentFilePath = args?.currentFilePath as string | undefined;
    let resolvedProjectId = projectId;
    if (!resolvedProjectId && currentFilePath) {
      resolvedProjectId = (await applyShardingInference(undefined, currentFilePath)) ?? undefined;
    }
    if (!query.trim()) {
      return {
        content: [{ type: "text", text: "**Error:** Se requiere `query`." }],
        isError: true,
      };
    }
    if (isProjectShardingEnabled() && !resolvedProjectId) {
      return {
        content: [
          {
            type: "text",
            text: "**Error:** Con `FALKOR_SHARD_BY_PROJECT` activo debes pasar `projectId` o `currentFilePath` en find_similar_implementations.",
          },
        ],
        isError: true,
      };
    }
    const cache = getMcpToolCache();
    const cacheKeySim = `ariadne:find_similar:v1:${resolvedProjectId ?? "global"}:${query}:${limit}`;
    const cachedSim = await cache.get(cacheKeySim);
    if (cachedSim) return { content: [{ type: "text", text: cachedSim }] };
    const ingestUrl = process.env.INGEST_URL ?? process.env.ARIADNESPEC_INGEST_URL ?? "http://localhost:3002";
    /** Mismo criterio que semantic_search: el id puede ser proyecto Falkor o `repositories.id` (roots[].id). */
    const requestedScopeId = resolvedProjectId;
    let graphRouteId: string | undefined = requestedScopeId;
    let scopeRepoId: string | undefined;
    if (requestedScopeId) {
      const scope = await resolveGraphScopeFromProjectOrRepoId(ingestUrl, requestedScopeId);
      graphRouteId = scope.cypherProjectId;
      scopeRepoId = scope.repoId;
    }
    const hasRepoScope = Boolean(scopeRepoId);
    const results: { type: string; name: string; projectId?: string }[] = [];
    let usedVector = false;
    try {
      const embedParams = new URLSearchParams();
      embedParams.set("text", query);
      if (requestedScopeId) embedParams.set("repositoryId", requestedScopeId);
      const embedRes = await fetch(`${ingestUrl.replace(/\/$/, "")}/embed?${embedParams.toString()}`);
      if (embedRes.ok) {
        const embedJson = (await embedRes.json()) as { embedding?: number[]; vectorProperty?: string };
        const { embedding } = embedJson;
        const vecProp = embedJson.vectorProperty ?? "embedding";
        const valid = Array.isArray(embedding) && embedding.every((v) => typeof v === "number" && Number.isFinite(v));
        if (valid && embedding!.length > 0) {
          const vecStr = `[${embedding!.join(",")}]`;
          const k = Math.min(Math.max(limit * 2, 20), mcpLimits.findSimilarVectorKMax);
          const funcVecQ = `CALL db.idx.vector.queryNodes('Function', '${vecProp}', ${k}, vecf32(${vecStr})) YIELD node, score RETURN node.name AS name, node.path AS path, node.projectId AS projectId, node.repoId AS repoId, score`;
          const compVecQ = `CALL db.idx.vector.queryNodes('Component', '${vecProp}', ${k}, vecf32(${vecStr})) YIELD node, score RETURN node.name AS name, node.projectId AS projectId, node.repoId AS repoId, score`;
          const modelVecQ = `CALL db.idx.vector.queryNodes('Model', '${vecProp}', ${k}, vecf32(${vecStr})) YIELD node, score RETURN node.name AS name, node.path AS path, node.projectId AS projectId, node.repoId AS repoId, score`;
          const enumVecQ = `CALL db.idx.vector.queryNodes('Enum', '${vecProp}', ${k}, vecf32(${vecStr})) YIELD node, score RETURN node.name AS name, node.path AS path, node.projectId AS projectId, node.repoId AS repoId, score`;
          try {
            const seen = new Set<string>();
            await runOnProjectGraphs(graphRouteId, async (g, ctx) => {
              try {
                const [fRes, cRes, modelVecRes, enumVecRes] = await Promise.all([
                  g.query(funcVecQ) as Promise<{ data?: Array<Record<string, unknown>> }>,
                  g.query(compVecQ) as Promise<{ data?: Array<Record<string, unknown>> }>,
                  g.query(modelVecQ) as Promise<{ data?: Array<Record<string, unknown>> }>,
                  g.query(enumVecQ) as Promise<{ data?: Array<Record<string, unknown>> }>,
                ]);
                for (const row of asObjRows(fRes.data)) {
                  if (results.length >= limit) return;
                  const name = _rv<string>(row, "name");
                  const path = _rv<string>(row, "path");
                  const pid = _rv<string>(row, "projectId");
                  if (ctx.cypherProjectId && pid !== ctx.cypherProjectId) continue;
                  if (scopeRepoId && _rv<string>(row, "repoId") !== scopeRepoId) continue;
                  const key = `Function:${name}:${path}`;
                  if (seen.has(key)) continue;
                  seen.add(key);
                  results.push({ type: "Function", name: path ? `${name ?? ""} — ${path}` : (name ?? ""), projectId: pid });
                  if (results.length >= limit) break;
                }
                for (const row of asObjRows(cRes.data)) {
                  if (results.length >= limit) break;
                  const name = _rv<string>(row, "name");
                  const pid = _rv<string>(row, "projectId");
                  if (ctx.cypherProjectId && pid !== ctx.cypherProjectId) continue;
                  if (scopeRepoId && _rv<string>(row, "repoId") !== scopeRepoId) continue;
                  const key = `Component:${name}`;
                  if (seen.has(key)) continue;
                  seen.add(key);
                  results.push({ type: "Component", name: name ?? "", projectId: pid });
                }
                for (const row of asObjRows(modelVecRes.data)) {
                  if (results.length >= limit) break;
                  const name = _rv<string>(row, "name");
                  const path = _rv<string>(row, "path");
                  const pid = _rv<string>(row, "projectId");
                  if (ctx.cypherProjectId && pid !== ctx.cypherProjectId) continue;
                  if (scopeRepoId && _rv<string>(row, "repoId") !== scopeRepoId) continue;
                  const key = `Model:${name}:${path}`;
                  if (seen.has(key)) continue;
                  seen.add(key);
                  results.push({
                    type: "Model",
                    name: path ? `${name ?? ""} — ${path}` : (name ?? ""),
                    projectId: pid,
                  });
                }
                for (const row of asObjRows(enumVecRes.data)) {
                  if (results.length >= limit) break;
                  const name = _rv<string>(row, "name");
                  const path = _rv<string>(row, "path");
                  const pid = _rv<string>(row, "projectId");
                  if (ctx.cypherProjectId && pid !== ctx.cypherProjectId) continue;
                  if (scopeRepoId && _rv<string>(row, "repoId") !== scopeRepoId) continue;
                  const key = `Enum:${name}:${path}`;
                  if (seen.has(key)) continue;
                  seen.add(key);
                  results.push({
                    type: "Enum",
                    name: path ? `${name ?? ""} — ${path}` : (name ?? ""),
                    projectId: pid,
                  });
                }
                usedVector = true;
              } catch {
                /* vector index may not exist on this shard */
              }
            });
          } catch {
            /* vector index may not exist */
          }
        }
      }
    } catch { /* embed endpoint may not be configured */ }
    if (!usedVector) {
      const qLower = query.toLowerCase();
      const projFilter = requestedScopeId ? ` WHERE ${whereProjectRepo("n", hasRepoScope)}` : "";
      const mergeRows = async (q: string) => {
        const rows: unknown[] = [];
        await runOnProjectGraphs(graphRouteId, async (g, ctx) => {
          const p = requestedScopeId
            ? { params: { projectId: ctx.cypherProjectId, ...(hasRepoScope ? { repoId: scopeRepoId! } : {}) } }
            : {};
          const res = (await g.query(q, p)) as { data?: unknown[] };
          for (const row of res.data ?? []) rows.push(row);
        });
        return { data: rows as unknown[][] };
      };
      const fsk = mcpLimits.findSimilarKeywordLimit;
      const compQ = `MATCH (n:Component)${projFilter} RETURN n.name AS name LIMIT ${fsk}`;
      const funcQ = `MATCH (n:Function)${projFilter} RETURN n.name AS name, n.path AS path LIMIT ${fsk}`;
      const modelQ = `MATCH (n:Model)${projFilter} RETURN n.name AS name, n.path AS path, n.source AS source LIMIT ${fsk}`;
      const enumQ = `MATCH (n:Enum)${projFilter} RETURN n.name AS name, n.path AS path LIMIT ${fsk}`;
      const [compRes, funcRes, modelResKw, enumResKw] = await Promise.all([
        mergeRows(compQ),
        mergeRows(funcQ),
        mergeRows(modelQ),
        mergeRows(enumQ),
      ]);
      for (const row of asObjRows(compRes.data)) {
        if (results.length >= limit) break;
        const n = _rv<string>(row, "name");
        if (n?.toLowerCase().includes(qLower)) results.push({ type: "Component", name: n ?? "" });
      }
      for (const row of asObjRows(funcRes.data)) {
        if (results.length >= limit) break;
        const name = _rv<string>(row, "name");
        const path = _rv<string>(row, "path");
        if (name?.toLowerCase().includes(qLower) || path?.toLowerCase().includes(qLower)) {
          results.push({ type: "Function", name: path ? `${name ?? ""} — ${path}` : (name ?? "") });
        }
      }
      for (const row of asObjRows(modelResKw.data)) {
        if (results.length >= limit) break;
        const name = _rv<string>(row, "name");
        const path = _rv<string>(row, "path");
        const source = _rv<string>(row, "source");
        const hay = `${name ?? ""} ${path ?? ""} ${source ?? ""}`.toLowerCase();
        if (hay.includes(qLower)) {
          results.push({ type: "Model", name: path ? `${name ?? ""} — ${path}` : (name ?? "") });
        }
      }
      for (const row of asObjRows(enumResKw.data)) {
        if (results.length >= limit) break;
        const name = _rv<string>(row, "name");
        const path = _rv<string>(row, "path");
        if (name?.toLowerCase().includes(qLower) || path?.toLowerCase().includes(qLower)) {
          results.push({ type: "Enum", name: path ? `${name ?? ""} — ${path}` : (name ?? "") });
        }
      }
    }
    const lines = [`## Implementaciones similares: "${query}"${usedVector ? " (vector)" : ""}`, "", ...results.slice(0, limit).map((r) => `- **${r.type}:** ${r.name}`)];
    const simText = lines.join("\n");
    await cache.set(cacheKeySim, simText, 300);
    return { content: [{ type: "text", text: simText }] };
  }

  // --- get_project_standards ---
  if (name === "get_project_standards") {
    const projectId = (args?.projectId as string) ?? "";
    let resolvedProjectId = projectId;
    const currentFilePath = args?.currentFilePath as string | undefined;
    if (!resolvedProjectId && currentFilePath) {
      resolvedProjectId = (await applyShardingInference(undefined, currentFilePath)) ?? "";
    }
    if (!resolvedProjectId) {
      return {
        content: [{ type: "text", text: "**Error:** Se requiere projectId o currentFilePath." }],
        isError: true,
      };
    }
    const ingestUrl = process.env.INGEST_URL ?? process.env.ARIADNESPEC_INGEST_URL ?? "http://localhost:3002";
    const configPaths = [".prettierrc", ".prettierrc.json", ".prettierrc.js", ".eslintrc", ".eslintrc.json", ".eslintrc.js", ".eslintrc.cjs", "tsconfig.json", "package.json"];
    const lines = ["## Estándares del proyecto", ""];
    for (const configPath of configPaths) {
      try {
        const result = await fetchFileFromIngest(ingestUrl, resolvedProjectId, configPath);
        if ("content" in result && result.content) {
          lines.push(`### ${configPath}`, "```", result.content.slice(0, mcpLimits.standardsFileSnippetChars), "```", "");
        }
      } catch { /* skip */ }
    }
    if (lines.length === 2) lines.push("No se encontraron archivos de configuración (INGEST_URL o repo).");
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // --- get_file_context ---
  if (name === "get_file_context") {
    const filePathParam = (args?.filePath as string) ?? "";
    let projectId = args?.projectId as string | undefined;
    const currentFilePath = args?.currentFilePath as string | undefined;
    const ref = args?.ref as string | undefined;
    if (!projectId && currentFilePath) {
      projectId = (await applyShardingInference(undefined, currentFilePath)) ?? undefined;
    }
    if (!projectId) {
      return {
        content: [{ type: "text", text: "**Error:** Se requiere projectId o currentFilePath." }],
        isError: true,
      };
    }
    const { graphPath, graph: gCtx } = await resolveFileForPath(filePathParam, projectId, currentFilePath);
    graph = gCtx;
    const ingestUrl = process.env.INGEST_URL ?? process.env.ARIADNESPEC_INGEST_URL ?? "http://localhost:3002";
    const params: Record<string, string> = { path: graphPath };
    const matchProj = projectId ? ", projectId: $projectId" : "";
    if (projectId) params.projectId = projectId;
    const [importsQ, containsQ] = [
      `MATCH (f:File {path: $path${matchProj}})-[:IMPORTS]->(imp:File) RETURN imp.path AS path`,
      `MATCH (f:File {path: $path${matchProj}})-[:CONTAINS]->(n) RETURN labels(n)[0] AS label, n.name AS name`,
    ];
    const [importsRes, containsRes, fileResult] = await Promise.all([
      graph.query(importsQ, { params }) as Promise<{ data?: unknown[][] }>,
      graph.query(containsQ, { params }) as Promise<{ data?: unknown[][] }>,
      fetchFileFromIngest(ingestUrl, projectId, graphPath, ref),
    ]);
    const importsData = ((importsRes as { data?: Array<Record<string, unknown>> }).data ?? []);
    const containsData = ((containsRes as { data?: Array<Record<string, unknown>> }).data ?? []);
    const importPaths = importsData.map((row) => String(_rv(row, "path") ?? (Array.isArray(row) ? row[0] : "")));
    const byLabel = new Map<string, string[]>();
    for (const row of containsData) {
      const label = _rv<string>(row, "label");
      const name = _rv<string>(row, "name");
      const l = label ?? "Node";
      if (!byLabel.has(l)) byLabel.set(l, []);
      if (name) byLabel.get(l)!.push(name);
    }
    const content = "content" in fileResult ? fileResult.content : "";
    const lines = [
      `## Contexto: ${graphPath}`,
      "",
      "**Importa:**",
      ...(importPaths.length ? importPaths.map((p) => `- ${p}`) : ["(ninguno)"]),
      "",
      "**Contiene (exports):**",
      ...[...byLabel].map(([lbl, names]) => `- **${lbl}:** ${names.join(", ") || "(ninguno)"}`),
      "",
      "**Contenido:**",
      "```",
      content.slice(0, mcpLimits.fileContextMaxChars),
      "```",
    ];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // --- generate_navigation_map ---
  if (name === "generate_navigation_map") {
    const projectId = (args?.projectId as string) ?? "";
    if (!projectId) {
      return {
        content: [{ type: "text", text: "**Error:** Se requiere `projectId`." }],
        isError: true,
      };
    }
    const ingestUrl = process.env.INGEST_URL ?? process.env.ARIADNESPEC_INGEST_URL ?? "";
    if (!ingestUrl) {
      return {
        content: [{ type: "text", text: "**Error:** INGEST_URL no está configurado." }],
        isError: true,
      };
    }
    const scope = (args?.scope as string) ?? "full";
    const baselineSnapshot = (args?.baselineSnapshot as string) ?? undefined;
    const showAll = (args?.showAll as boolean) ?? false;
    try {
      const { scanNavigationMap, formatNavigationMapMarkdown } = await import("./navigation-map-scanner.js");
      const map = await scanNavigationMap(projectId, ingestUrl, {
        baselineSnapshot: scope.startsWith("diff") ? baselineSnapshot : undefined,
        showAll: scope === "diff-all" || showAll,
      });
      return {
        content: [
          {
            type: "text",
            text: formatNavigationMapMarkdown(map, scope === "diff-all" || showAll),
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `**Error al generar mapa de navegación:** ${msg}` }],
        isError: true,
      };
    }
  }

  // --- generate_scaffold_from_mdd ---
  if (name === "generate_scaffold_from_mdd") {
    let repoId = (args?.repositoryId as string) ?? (args?.projectId as string) ?? "";
    const currentFilePath = args?.currentFilePath as string | undefined;
    if (!repoId && currentFilePath) {
      repoId = (await applyShardingInference(undefined, currentFilePath)) ?? "";
    }
    if (!repoId) {
      return { content: [{ type: "text", text: "**Error:** Se requiere `repositoryId` o `projectId` (roots[].id)." }], isError: true };
    }
    const ingestUrl = (process.env.INGEST_URL ?? "http://localhost:3002").replace(/\/$/, "");
    const targets = args?.targets as string[] | undefined;
    try {
      const res = await fetch(`${ingestUrl}/internal/repositories/${repoId}/scaffold-from-mdd`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets }),
      });
      if (!res.ok) {
        return { content: [{ type: "text", text: `**Error ${res.status}:** ${await res.text()}` }], isError: true };
      }
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `**Error:** ${msg}` }], isError: true };
    }
  }

  // --- export_brownfield_parity_pack ---
  if (name === "export_brownfield_parity_pack") {
    const mergeProject = args?.mergeProject === true;
    let repoId = (args?.repositoryId as string) ?? "";
    let projectId = args?.projectId as string | undefined;
    const currentFilePath = args?.currentFilePath as string | undefined;
    if (!repoId && projectId && !mergeProject) repoId = projectId;
    if (!repoId && !projectId && currentFilePath) {
      projectId = (await applyShardingInference(undefined, currentFilePath)) ?? undefined;
      if (projectId && !mergeProject) repoId = projectId;
    }
    if (mergeProject) {
      if (!projectId?.trim()) {
        return {
          content: [
            {
              type: "text",
              text: "**Error:** `mergeProject: true` requiere `projectId` UUID del proyecto Ariadne. Preferir `export_brownfield_project_parity_pack`.",
            },
          ],
          isError: true,
        };
      }
    } else if (!repoId) {
      return { content: [{ type: "text", text: "**Error:** Se requiere `repositoryId` o `projectId`." }], isError: true };
    }
    const body = {
      userDescription: args?.userDescription as string | undefined,
      preferSnapshots: args?.preferSnapshots as boolean | undefined,
      live: args?.live as boolean | undefined,
    };
    const result = await fetchBrownfieldParityPack({
      mode: mergeProject ? "project" : "repo",
      projectId: mergeProject ? projectId! : projectId ?? repoId,
      repositoryId: mergeProject ? undefined : repoId,
      body,
    });
    if (!result.ok) {
      return {
        content: [{ type: "text", text: `**Error ${result.status ?? ""}:** ${result.error}` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: formatBrownfieldMcpEnvelope("export_brownfield_parity_pack", result.data) }],
    };
  }

  if (name === "export_brownfield_project_parity_pack") {
    const projectId = (args?.projectId as string)?.trim() ?? "";
    if (!projectId) {
      return {
        content: [
          {
            type: "text",
            text: "**Error:** Se requiere `projectId` = UUID del **proyecto** Ariadne (`list_known_projects[].id`, no `roots[].id`).",
          },
        ],
        isError: true,
      };
    }
    const result = await fetchBrownfieldParityPack({
      mode: "project",
      projectId,
      body: {
        userDescription: args?.userDescription as string | undefined,
        preferSnapshots: args?.preferSnapshots as boolean | undefined,
        live: args?.live as boolean | undefined,
      },
    });
    if (!result.ok) {
      return {
        content: [{ type: "text", text: `**Error ${result.status ?? ""}:** ${result.error}` }],
        isError: true,
      };
    }
    return {
      content: [
        { type: "text", text: formatBrownfieldMcpEnvelope("export_brownfield_project_parity_pack", result.data) },
      ],
    };
  }

  if (name === "generate_merged_project_mdd") {
    const projectId = (args?.projectId as string)?.trim() ?? "";
    if (!projectId) {
      return {
        content: [
          {
            type: "text",
            text: "**Error:** Se requiere `projectId` = UUID del proyecto Ariadne. Ejecuta `list_known_projects` primero.",
          },
        ],
        isError: true,
      };
    }
    const result = await fetchMergedProjectMdd({
      projectId,
      body: {
        userDescription: args?.userDescription as string | undefined,
        preferSnapshots: args?.preferSnapshots as boolean | undefined,
        live: args?.live as boolean | undefined,
      },
    });
    if (!result.ok) {
      return {
        content: [{ type: "text", text: `**Error ${result.status ?? ""}:** ${result.error}` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: formatBrownfieldMcpEnvelope("generate_merged_project_mdd", result.data) }],
    };
  }

  // --- extract_design_tokens ---
  if (name === "extract_design_tokens") {
    const projectId = (args?.projectId as string) ?? "";
    if (!projectId) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: "Se requiere projectId" }) }],
        isError: true,
      };
    }
    const ingestUrl = process.env.INGEST_URL ?? process.env.ARIADNESPEC_INGEST_URL ?? "http://localhost:3002";

    const parseTailwindTokens = (raw: string): Record<string, string> => {
      const tokens: Record<string, string> = {};
      const colorBlock = raw.match(/colors\s*:\s*\{([^}]+)\}/);
      if (colorBlock) {
        const inner = colorBlock[1];
        const simplePairs = inner.match(/['"]?(\w[\w-]*)['"]?\s*:\s*['"](#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))['"]/g);
        if (simplePairs) {
          for (const pair of simplePairs) {
            const m = pair.match(/['"]?(\w[\w-]*)['"]?\s*:\s*['"](#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))['"]/);
            if (m) tokens[`color_${m[1]}`] = m[2];
          }
        }
        const nestedBlock = inner.match(/(\w[\w-]*)\s*:\s*\{([^}]+)\}/g);
        if (nestedBlock) {
          for (const block of nestedBlock) {
            const nm = block.match(/(\w[\w-]*)\s*:\s*\{/);
            const prefix = nm ? nm[1] : "unknown";
            const innerPairs = block.match(/['"]?(\d+|\w[\w-]*)['"]?\s*:\s*['"](#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))['"]/g);
            if (innerPairs) {
              for (const pair of innerPairs) {
                const m = pair.match(/['"]?(\d+|\w[\w-]*)['"]?\s*:\s*['"](#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))['"]/);
                if (m) tokens[`color_${prefix}_${m[1]}`] = m[2];
              }
            }
          }
        }
      }
      const fontMatch = raw.match(/fontFamily\s*:\s*\{([^}]+)\}/);
      if (fontMatch) {
        const families = fontMatch[1].match(/['"]?(\w[\w-]*)['"]?\s*:/g);
        if (families) {
          for (const f of families) {
            const name = f.replace(/['":]/g, "").trim();
            if (name) tokens[`font_${name}`] = name;
          }
        }
      }
      const spacingMatch = raw.match(/spacing\s*:\s*\{([^}]+)\}/);
      if (spacingMatch) {
        const pairs = spacingMatch[1].match(/['"]?(\w[\w-]*)['"]?\s*:\s*['"]([^'"]+)['"]/g);
        if (pairs) {
          for (const pair of pairs) {
            const m = pair.match(/['"]?(\w[\w-]*)['"]?\s*:\s*['"]([^'"]+)['"]/);
            if (m) tokens[`spacing_${m[1]}`] = m[2];
          }
        }
      }
      const radiusMatch = raw.match(/borderRadius\s*:\s*\{([^}]+)\}/);
      if (radiusMatch) {
        const pairs = radiusMatch[1].match(/['"]?(\w[\w-]*)['"]?\s*:\s*['"]([^'"]+)['"]/g);
        if (pairs) {
          for (const pair of pairs) {
            const m = pair.match(/['"]?(\w[\w-]*)['"]?\s*:\s*['"]([^'"]+)['"]/);
            if (m) tokens[`radius_${m[1]}`] = m[2];
          }
        }
      }
      return tokens;
    };

    const parseCssCustomProps = (raw: string): Record<string, string> => {
      const tokens: Record<string, string> = {};
      const scopeRe = /(?::root|\[data-theme[^\]]*\])\s*\{([^}]+)\}/g;
      let scopeMatch: RegExpExecArray | null;
      while ((scopeMatch = scopeRe.exec(raw)) !== null) {
        const body = scopeMatch[1];
        const propRe = /--([\w-]+)\s*:\s*([^;]+)/g;
        let propMatch: RegExpExecArray | null;
        while ((propMatch = propRe.exec(body)) !== null) {
          const key = propMatch[1].trim();
          const val = propMatch[2].trim();
          if (val.startsWith("#") || val.startsWith("rgb") || val.startsWith("hsl") || /^[\d.]+/.test(val)) {
            if (/^color-|^font-|^spacing-|^radius-|^shadow-/.test(key)) {
              tokens[`css_${key}`] = val;
            }
          }
        }
      }
      return tokens;
    };

    const parseTokenJson = (raw: string): Record<string, string> => {
      const tokens: Record<string, string> = {};
      try {
        const parsed = JSON.parse(raw);
        const walk = (obj: Record<string, unknown>, prefix: string): void => {
          for (const [k, v] of Object.entries(obj)) {
            const path = prefix ? `${prefix}_${k}` : k;
            if (typeof v === "string" && (v.startsWith("#") || v.startsWith("rgb") || v.startsWith("hsl") || /^[\d.]+(px|rem|em|%)?$/.test(v))) {
              tokens[path] = v;
            } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
              walk(v as Record<string, unknown>, path);
            }
          }
        };
        if (typeof parsed === "object" && parsed !== null) {
          walk(parsed as Record<string, unknown>, "");
        }
      } catch {
        // Not valid JSON, skip
      }
      return tokens;
    };

    // --- Step 1: Find files via Falkor ---
    graph = await getGraph(projectId);
    const filesQ = `MATCH (f:File {projectId: $projectId}) RETURN f.path AS path`;
    let allFilePaths: string[] = [];
    if (isProjectShardingEnabled()) {
      const merged = await queryFileRowsAllShards(projectId, filesQ);
      allFilePaths = merged.map((r) => String(_rv(r, "path") ?? "")).filter(Boolean);
    } else {
      const filesRes = (await graph.query(filesQ, { params: { projectId } })) as {
        data?: Array<Record<string, unknown>>;
      };
      allFilePaths = (filesRes.data ?? []).map((r) => String(_rv(r, "path") ?? "")).filter(Boolean);
    }

    const tailwindFiles = allFilePaths.filter((p) => /tailwind\.config\./.test(p));
    const cssFiles = allFilePaths.filter((p) => p.endsWith(".css") && !p.includes("node_modules"));
    const tokenFiles = allFilePaths.filter(
      (p) =>
        /\/tokens\.(json|js|ts)$/.test(p) ||
        /\/theme\.(json|js|ts)$/.test(p) ||
        /\/design-tokens\./.test(p) ||
        p.endsWith("tokens.json") ||
        p.endsWith("theme.json")
    );

    // --- Step 2: Read file contents ---
    const readFileSafe = async (filePath: string): Promise<string> => {
      const result = await fetchFileFromIngest(ingestUrl, projectId, filePath);
      if ("content" in result && result.content) return result.content;
      return "";
    };

    let tailwindRaw = "";
    let cssRaw = "";
    let tokenRaw = "";

    for (const f of tailwindFiles) {
      const c = await readFileSafe(f);
      if (c) tailwindRaw += `\n--- ${f} ---\n${c}\n`;
    }

    for (const f of cssFiles) {
      const c = await readFileSafe(f);
      if (c && /:root\s*\{|--color-|--font-|--spacing-|--radius-/.test(c)) {
        cssRaw += `\n--- ${f} ---\n${c}\n`;
      }
    }

    for (const f of tokenFiles) {
      const c = await readFileSafe(f);
      if (c) tokenRaw += `\n--- ${f} ---\n${c}\n`;
    }

    // --- Step 3: Parse tokens ---
    const foundTailwind = tailwindRaw.length > 20;
    const foundCssCustomProps = cssRaw.length > 20;
    const foundThemeFile = tokenRaw.length > 20;

    const tailwindTokens = foundTailwind ? parseTailwindTokens(tailwindRaw) : {};
    const cssTokens = foundCssCustomProps ? parseCssCustomProps(cssRaw) : {};
    const themeTokens = foundThemeFile ? parseTokenJson(tokenRaw) : {};

    const mergedCssTokens = { ...themeTokens, ...cssTokens };

    // --- Step 4: Build summary ---
    const summaryParts: string[] = [];
    if (foundTailwind) {
      const counts: string[] = [];
      const colors = Object.keys(tailwindTokens).filter((k) => k.startsWith("color_")).length;
      const fonts = Object.keys(tailwindTokens).filter((k) => k.startsWith("font_")).length;
      const spacing = Object.keys(tailwindTokens).filter((k) => k.startsWith("spacing_")).length;
      const radii = Object.keys(tailwindTokens).filter((k) => k.startsWith("radius_")).length;
      if (colors) counts.push(`${colors} colors`);
      if (fonts) counts.push(`${fonts} font families`);
      if (spacing) counts.push(`${spacing} spacing`);
      if (radii) counts.push(`${radii} border radii`);
      summaryParts.push(
        `**Tailwind Config:** found — ${counts.length ? counts.join(", ") : "config present"}` +
          ` (files: ${tailwindFiles.length})`
      );
    } else {
      summaryParts.push("**Tailwind Config:** not found");
    }
    if (foundCssCustomProps || foundThemeFile) {
      const totalTokens = Object.keys(mergedCssTokens).length;
      const colors = Object.keys(mergedCssTokens).filter((k) => /css_color|^color_/.test(k)).length;
      const fonts = Object.keys(mergedCssTokens).filter((k) => k.includes("font")).length;
      summaryParts.push(
        `**CSS Custom Properties / Theme:** ${totalTokens} tokens extracted` +
          (colors ? ` (${colors} colors` : "") +
          (colors && fonts ? ", " : "") +
          (fonts ? `${fonts} fonts` : "") +
          (colors || fonts ? ")" : "") +
          (foundCssCustomProps ? ` from ${cssFiles.filter((f) => !f.includes("node_modules")).length} CSS files` : "") +
          (foundThemeFile ? ` + ${tokenFiles.length} token files` : "")
      );
    } else {
      summaryParts.push("**CSS Custom Properties / Theme:** not found");
    }
    if (!foundTailwind && !foundCssCustomProps && !foundThemeFile) {
      summaryParts.push("No design tokens detected in the codebase.");
    }

    const result = {
      foundTailwind,
      foundCssCustomProps,
      foundThemeFile,
      tailwindTokens,
      cssTokens: mergedCssTokens,
      tailwindFiles: tailwindFiles.length,
      cssFileCount: cssFiles.filter((f) => !f.includes("node_modules")).length,
      tokenFiles: tokenFiles.length,
      summary: summaryParts.join("\n"),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }

  if (name === "query_graph") {
    const rawQuery = ((args?.query as string) ?? "").trim();
    const projectId = args?.projectId as string | undefined;
    const limit = Math.min(500, Math.max(1, (args?.limit as number) ?? 50));
    if (!rawQuery) {
      return {
        content: [{ type: "text", text: "**Error:** El parámetro `query` es requerido." }],
        isError: true,
      };
    }
    let resolvedProjectId = projectId ?? "";
    if (!resolvedProjectId && (args?.currentFilePath as string)) {
      resolvedProjectId = (await applyShardingInference(undefined, (args?.currentFilePath as string) ?? "")) ?? "";
    }
    if (isProjectShardingEnabled() && !resolvedProjectId) {
      return {
        content: [{
          type: "text",
          text: "**Error:** Con `FALKOR_SHARD_BY_PROJECT` activo debes pasar `projectId` en query_graph.",
        }],
        isError: true,
      };
    }

    const ingestUrl = process.env.INGEST_URL ?? process.env.ARIADNESPEC_INGEST_URL ?? "http://localhost:3002";
    let cypherProjectId = resolvedProjectId;
    if (resolvedProjectId) {
      const scope = await resolveGraphScopeFromProjectOrRepoId(ingestUrl, resolvedProjectId);
      cypherProjectId = scope.cypherProjectId;
    }

    let guarded;
    try {
      guarded = guardCypherQuery(rawQuery, {
        projectId: cypherProjectId || undefined,
        limit,
      });
    } catch (e) {
      const msg = e instanceof CypherGuardError ? e.message : String(e);
      return { content: [{ type: "text", text: `**Error Cypher guard:** ${msg}` }], isError: true };
    }

    const rows: Array<Record<string, unknown>> = [];
    await runOnProjectGraphs(resolvedProjectId || undefined, async (g) => {
      if (rows.length >= limit) return;
      const res = (await g.query(guarded.query, {
        params: guarded.params as Record<string, string>,
      })) as {
        data?: Array<Record<string, unknown>>;
      };
      for (const row of asObjRows(res.data)) {
        rows.push(row);
        if (rows.length >= limit) break;
      }
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify(
          {
            query: guarded.query,
            rowCount: rows.length,
            limit,
            injectedProjectScope: guarded.injectedProjectScope,
            appendedLimit: guarded.appendedLimit,
            rows,
          },
          null,
          2,
        ),
      }],
    };
  }

  if (name === "detect_changes") {
    return handleDetectChangesTool(args, "json");
  }

  if (name === "analyze_local_changes") {
    return handleDetectChangesTool(args, "markdown");
  }

  // --- review_diff ---
  if (name === "review_diff") {
    const ingestUrl = process.env.INGEST_URL ?? process.env.ARIADNESPEC_INGEST_URL ?? "http://localhost:3002";
    const body: Record<string, unknown> = {};
    if (args?.diff) body.diff = args.diff as string;
    if (args?.prUrl) body.prUrl = args.prUrl as string;
    if (args?.projectId) body.projectId = args.projectId as string;
    if (args?.branch) body.branch = args.branch as string;
    if (args?.repoPath) body.repoPath = args.repoPath as string;

    try {
      const res = await fetch(`${ingestUrl}/review/diff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return {
          content: [{ type: "text", text: `Error del review engine (HTTP ${res.status}): ${errText}` }],
          isError: true,
        };
      }
      const result = await res.json() as Record<string, unknown>;
      // Si tiene reportMarkdown, devolverlo como texto formateado
      if (result.reportMarkdown && typeof result.reportMarkdown === 'string') {
        return { content: [{ type: "text", text: result.reportMarkdown as string }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error conectando con review engine: ${msg}` }],
        isError: true,
      };
    }
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
  })();
  if (isMcpToolInvocationLoggingEnabled()) mcpLogToolInvocationEnd(name, __mcpCallStarted, __mcpResult);
  return __mcpResult;
  } catch (__mcpErr) {
  if (isMcpToolInvocationLoggingEnabled()) mcpLogToolInvocationFailure(name, args, __mcpCallStarted, __mcpErr);
  throw __mcpErr;
  }
  });
  return srv;
}

/** Helpers for format functions - FalkorDB returns object rows. */
function fmtGetRow(row: Record<string, unknown> | unknown[], key: string, headers?: string[]): unknown {
  const obj = row as Record<string, unknown>;
  if (obj != null && !Array.isArray(row) && key in obj) return obj[key];
  if (Array.isArray(row) && headers) {
    const i = headers.indexOf(key);
    return i >= 0 ? row[i] : row[0];
  }
  return Array.isArray(row) ? row[0] : undefined;
}
function fmtRowVal<T>(row: Record<string, unknown> | unknown[], keyOrIdx: string | number): T | undefined {
  if (Array.isArray(row)) return (row as unknown[])[typeof keyOrIdx === "number" ? keyOrIdx : 0] as T | undefined;
  return (row as Record<string, unknown>)[String(keyOrIdx)] as T | undefined;
}

function formatComponentGraph(componentName: string, rows: unknown[][], headers: string[]): string {
  if (rows.length === 0) {
    return `**Componente:** \`${componentName}\`\n\nNo se encontraron dependencias en el grafo. Ejecuta el Cartographer para indexar el código.`;
  }
  const lines = [`## Grafo de dependencias: ${componentName}`, ""];
  const seen = new Set<string>();
  for (const row of rows as unknown[]) {
    const dep = fmtGetRow(row as Record<string, unknown> | unknown[], "dependency", headers) ?? fmtGetRow(row as Record<string, unknown> | unknown[], "c", headers);
    const obj = dep && typeof dep === "object" ? dep as Record<string, unknown> : { name: String(dep) };
    const key = (obj.name ?? obj.path ?? JSON.stringify(obj)) as string;
    if (seen.has(key)) continue;
    seen.add(key);
    const path = obj.path as string | undefined;
    const name = obj.name as string | undefined;
    const label = path ? `File: ${path}` : `Component/Hook: ${name ?? key}`;
    lines.push(`- ${label}`);
  }
  return lines.join("\n");
}

function formatLegacyImpact(nodeName: string, rows: unknown[][], headers: string[]): string {
  if (rows.length === 0) {
    return `**Nodo:** \`${nodeName}\`\n\nNingún dependiente encontrado (nadie lo llama ni lo renderiza en el grafo).`;
  }
  const lines = [`## Impacto legacy: ${nodeName}`, "", "Dependientes (quienes lo usan o lo renderizan):", ""];
  const seen = new Set<string>();
  for (const row of rows as unknown[]) {
    const name = (fmtGetRow(row as Record<string, unknown> | unknown[], "name", headers) ?? "") as string;
    const labelsVal = fmtGetRow(row as Record<string, unknown> | unknown[], "labels", headers);
    const distanceVal = fmtGetRow(row as Record<string, unknown> | unknown[], "distance", headers);
    const callChainVal = fmtGetRow(row as Record<string, unknown> | unknown[], "callChain", headers);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const labels = Array.isArray(labelsVal) ? labelsVal.join(", ") : String(labelsVal ?? "");
    let extra = "";
    if (distanceVal != null) {
      extra += ` [hop ${distanceVal}]`;
    }
    if (Array.isArray(callChainVal) && callChainVal.length > 1) {
      extra += ` (vía: ${callChainVal.slice().reverse().join(" -> ")})`;
    }
    lines.push(`- **${name}** (${labels})${extra}`);
  }
  return lines.join("\n");
}

function formatContractSpecs(
  componentName: string,
  rows: unknown[][],
  headers: string[],
  description?: string | null,
): string {
  const lines = [`## Contrato (props): ${componentName}`, ""];
  if (description && String(description).trim()) {
    lines.push(`**Descripción:** ${String(description).trim()}`, "");
  }
  if (rows.length === 0) {
    lines.push("No se encontraron props en el grafo. Indexa el código con el Cartographer o el componente no declara props.");
    return lines.join("\n");
  }
  for (const row of rows as unknown[]) {
    const name = (fmtGetRow(row as Record<string, unknown> | unknown[], "name", headers) ?? "") as string;
    const required = fmtGetRow(row as Record<string, unknown> | unknown[], "required", headers);
    const reqStr = required === true || required === "true" ? "requerido" : "opcional";
    lines.push(`- **${name}** (${reqStr})`);
  }
  return lines.join("\n");
}

function formatFunctionsInFile(path: string, rows: Array<[string, string] | Record<string, unknown>>): string {
  if (rows.length === 0) {
    return `**Archivo:** \`${path}\`\n\nNo se encontraron funciones ni componentes en el grafo. Indexa el código (ingest o Cartographer).`;
  }
  const byLabel = new Map<string, string[]>();
  for (const row of rows) {
    const label = Array.isArray(row) ? row[0] : fmtRowVal<string>(row as Record<string, unknown>, "label");
    const name = Array.isArray(row) ? row[1] : fmtRowVal<string>(row as Record<string, unknown>, "name");
    const l = label ?? "Node";
    if (!byLabel.has(l)) byLabel.set(l, []);
    if (name) byLabel.get(l)!.push(name);
  }
  const lines = [`## Contenido (File CONTAINS): ${path}`, ""];
  for (const [label, names] of byLabel) {
    lines.push(`### ${label}`, ...names.map((n) => `- ${n}`), "");
  }
  return lines.join("\n").trimEnd();
}

function formatImportGraph(
  filePath: string,
  importsRows: Array<Record<string, unknown> | unknown[]>,
  containsRows: Array<Record<string, unknown> | [string, string]>,
): string {
  const importPaths = importsRows.map((row) =>
    Array.isArray(row) ? (row[0] as string) : String(fmtRowVal(row as Record<string, unknown>, "path") ?? row)
  );
  const byLabel = new Map<string, string[]>();
  for (const row of containsRows) {
    const label = Array.isArray(row) ? row[0] : fmtRowVal<string>(row as Record<string, unknown>, "label");
    const name = Array.isArray(row) ? row[1] : fmtRowVal<string>(row as Record<string, unknown>, "name");
    const l = label ?? "Node";
    if (!byLabel.has(l)) byLabel.set(l, []);
    if (name) byLabel.get(l)!.push(name);
  }
  const lines = [`## Grafo de imports: ${filePath}`, ""];
  lines.push("**Importa (IMPORTS):**", "");
  if (importPaths.length === 0) lines.push("- (ninguno)");
  else importPaths.forEach((p) => lines.push(`- ${p}`));
  lines.push("", "**Contiene (CONTAINS):**", "");
  for (const [label, names] of byLabel) {
    lines.push(`- **${label}:** ${names.join(", ") || "(ninguno)"}`);
  }
  return lines.join("\n");
}

/** Respuestas JSON para OAuth discovery (Cursor las pide antes de conectar). Sin OAuth; retorna vacío. */
function serveWellKnown(path: string, req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== "GET") return false;

  const baseUrl = process.env.MCP_PUBLIC_URL?.trim() || "https://ariadne.kreoint.mx";
  const mcpUrl = `${baseUrl.replace(/\/$/, "")}${MCP_PATH}`;

  if (path === "/.well-known/oauth-authorization-server" || path === ".well-known/oauth-authorization-server") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "OAuth not configured" }));
    return true;
  }

  if (
    path === "/.well-known/oauth-protected-resource/mcp" ||
    path === ".well-known/oauth-protected-resource/mcp" ||
    path === "/.well-known/oauth-protected-resource" ||
    path === ".well-known/oauth-protected-resource"
  ) {
    const body = JSON.stringify({ resource: mcpUrl, authorization_servers: [] });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(body);
    return true;
  }

  return false;
}

async function requestHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = req.url?.split("?")[0] ?? "/";
  const pathNorm = path.startsWith("/") ? path : `/${path}`;
  const isMcpPath = pathNorm === MCP_PATH || pathNorm === `${MCP_PATH}/`;

  // Raíz del host MCP: no es la UI (evita 401 confuso si Dokploy enruta / al contenedor equivocado).
  if (pathNorm === "/" && req.method === "GET") {
    const webUi =
      process.env.ARIADNE_UI_URL?.trim() ||
      process.env.MCP_PUBLIC_URL?.trim()?.replace(/\/mcp\/?$/i, "") ||
      "https://ariadne.kreoint.mx";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        service: "mcp-ariadne",
        message:
          "Este es el servidor MCP, no la aplicación web. En Dokploy enruta path / → frontend:80 y /mcp → mcp-ariadne:8080.",
        web_ui: webUi.replace(/\/$/, ""),
        mcp_endpoint: MCP_PATH,
      }),
    );
    return;
  }

  // Healthcheck endpoint
  if (pathNorm === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "mcp-ariadne" }));
    return;
  }

  if (serveWellKnown(pathNorm, req, res)) return;

  if (!isMcpPath) {
    console.log(`[MCP] 404 ${req.method} ${pathNorm}`);
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found", path: pathNorm }));
    return;
  }

  /** Solo desarrollo local (p. ej. Cursor contra localhost). Nunca en producción expuesta. */
  const allowUnauthenticated =
    process.env.MCP_HTTP_ALLOW_UNAUTHENTICATED?.trim() === "1" ||
    process.env.MCP_HTTP_ALLOW_UNAUTHENTICATED?.trim().toLowerCase() === "true";

  if (!allowUnauthenticated) {
    const authError = await validateAuth(req);
    if (authError) {
      console.warn(`[MCP] 401 Unauthorized: ${authError} (${req.headers["x-forwarded-for"] ?? req.socket.remoteAddress})`);
      res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" });
      res.end(JSON.stringify({ error: "Unauthorized", message: authError }));
      return;
    }
  }

  // Stateless: un Server+Transport por request. Reenviar el Bearer del cliente al Nest en herramientas que llaman /api/graph/*.
  const clientBearer = getTokenFromRequest(req) ?? undefined;
  await mcpNestAuthAls.run({ clientBearerForNest: clientBearer }, async () => {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
}

async function runStdio(): Promise<void> {
  // Redirigir console.log/info/warn a stderr para no interferir con los paquetes JSON-RPC en stdout
  console.log = (...args: unknown[]) => console.error(...args);
  console.info = (...args: unknown[]) => console.error(...args);
  console.warn = (...args: unknown[]) => console.error(...args);

  console.error("[AriadneSpecs MCP] Inicializando transporte STDIO (Cursor / IDE local)...");
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[AriadneSpecs MCP] Conexión STDIO establecida.");

  // Arranque automático transparente del watcher local si no está deshabilitado
  let watcherClose: (() => void) | undefined;
  const isWatcherDisabled =
    process.env.ARIADNE_DISABLE_WATCHER === "1" ||
    process.env.ARIADNE_DISABLE_WATCHER?.toLowerCase() === "true";

  if (!isWatcherDisabled) {
    try {
      const { startLiveWatcher } = await import("./live-watcher.js");
      const root = process.env.ARIADNE_WORKSPACE_ROOT || process.cwd();
      const watcher = startLiveWatcher({ workspaceRoot: root });
      watcherClose = watcher.close;
      console.error(`[AriadneSpecs MCP] 👁️ Live Watcher activo en segundo plano (${root})`);
    } catch (err) {
      console.error("[AriadneSpecs MCP] ⚠️ No se pudo iniciar el watcher automático:", err);
    }
  }

  const cleanup = () => {
    console.error("[AriadneSpecs MCP] Cerrando...");
    watcherClose?.();
    closeFalkor();
    closeRedis();
    process.exit(0);
  };

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
}

async function runHttp(): Promise<void> {
  const port = parseInt(process.env.PORT ?? process.env.MCP_HTTP_PORT ?? "8080", 10);
  console.log("[AriadneSpecs MCP] Starting Streamable HTTP server (stateless)...");
  const allowUnauth =
    process.env.MCP_HTTP_ALLOW_UNAUTHENTICATED?.trim() === "1" ||
    process.env.MCP_HTTP_ALLOW_UNAUTHENTICATED?.trim().toLowerCase() === "true";
  console.log(`[MCP] Port: ${port}, Path: ${MCP_PATH}`);
  console.log(
    allowUnauth
      ? "[MCP] MCP_HTTP_ALLOW_UNAUTHENTICATED=1 — /mcp sin validar Bearer (solo pruebas locales)"
      : "[MCP] /mcp: validación Bearer vía ingest `validate-mcp-token` (Secret MCP `ari_*` del usuario)",
  );

  const httpServer = createServer((req, res) => {
    requestHandler(req, res).catch((err) => {
      console.error("[MCP] Request error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal Server Error", message: String(err) }));
      }
    });
  });

  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`[AriadneSpecs MCP] HTTP server listening on 0.0.0.0:${port}${MCP_PATH}`);
  });

  httpServer.on("error", (err) => {
    console.error("[AriadneSpecs MCP] Server error:", err);
    process.exit(1);
  });

  process.on("SIGTERM", () => {
    console.log("[AriadneSpecs MCP] SIGTERM received, closing...");
    closeFalkor();
    closeRedis();
    httpServer.close(() => process.exit(0));
  });

  process.on("SIGINT", () => {
    console.log("[AriadneSpecs MCP] SIGINT received, closing...");
    closeFalkor();
    closeRedis();
    httpServer.close(() => process.exit(0));
  });
}

async function main() {
  const isExplicitStdio =
    process.argv.includes("--stdio") ||
    process.env.MCP_TRANSPORT === "stdio";

  const isExplicitHttp =
    process.argv.includes("--http") ||
    process.env.MCP_TRANSPORT === "http";

  if (isExplicitStdio) {
    await runStdio();
  } else if (isExplicitHttp || process.env.PORT) {
    await runHttp();
  } else {
    // Por defecto sin puerto asignado: STDIO para integración fluida con Cursor
    await runStdio();
  }
}

main().catch((err) => {
  console.error("[AriadneSpecs MCP] Fatal error:", err);
  process.exit(1);
});

