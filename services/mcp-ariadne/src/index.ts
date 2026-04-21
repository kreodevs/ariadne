#!/usr/bin/env node
/**
 * @fileoverview AriadneSpecs Oracle MCP Server. Transporte Streamable HTTP. Tools: get_component_graph, get_legacy_impact, validate_before_edit, semantic_search, etc. Config: PORT, MCP_AUTH_TOKEN, FALKORDB_HOST, INGEST_URL, ARIADNE_API_URL, ARIADNE_API_BEARER (JWT para GET /api/graph/* en Nest).
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execSync } from "node:child_process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { isProjectShardingEnabled } from "ariadne-common";
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

const MCP_PATH = "/mcp";

/** Markdown estructurado para la herramienta get_c4_model (respuesta API /api/graph/c4-model). */
function formatC4Markdown(data: {
  projectId: string;
  systems: Array<{
    repoId: string;
    name: string;
    containers: Array<{ key: string; name: string; c4Kind: string; technology?: string }>;
    communicates: Array<{ sourceKey: string; targetKey: string; reason?: string }>;
  }>;
}): string {
  const lines: string[] = [
    "## Modelo C4 (contenedores)",
    "",
    `**projectId:** \`${data.projectId}\``,
    "",
  ];
  if (data.systems.length === 0) {
    lines.push("_Sin nodos :System en Falkor. Ejecuta sync del repositorio con el ingest actualizado._");
    return lines.join("\n");
  }
  for (const sys of data.systems) {
    lines.push(`### Sistema: ${sys.name}`, "", `**repoId:** \`${sys.repoId}\``, "");
    lines.push("**Contenedores:**", "");
    for (const c of sys.containers) {
      const tech = c.technology ? ` — _${c.technology}_` : "";
      lines.push(`- \`${c.key}\`: ${c.name} (${c.c4Kind})${tech}`);
    }
    lines.push("");
    if (sys.communicates.length > 0) {
      lines.push("**COMMUNICATES_WITH** (roll-up):", "");
      for (const e of sys.communicates) {
        const r = e.reason ? ` _(${e.reason})_` : "";
        lines.push(`- \`${e.sourceKey}\` → \`${e.targetKey}\`${r}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

/** Base URL del API Nest (prefijo global `/api`). */
function ariadneApiBase(): string {
  return (process.env.ARIADNE_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** Headers para `fetch` al API Nest: `Authorization: Bearer` si `ARIADNE_API_BEARER` o `ARIADNE_API_JWT` están definidos (middleware OTP en `/api/*`). */
function ariadneApiFetchInit(extra: RequestInit = {}): RequestInit {
  const headers = new Headers(extra.headers as HeadersInit | undefined);
  const token = process.env.ARIADNE_API_BEARER?.trim() || process.env.ARIADNE_API_JWT?.trim();
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

/** Valida auth con MCP_AUTH_TOKEN estático. Retorna null si ok. */
function validateAuth(req: IncomingMessage): string | null {
  const staticToken = process.env.MCP_AUTH_TOKEN?.trim();
  if (!staticToken) return null;

  const clientToken = getTokenFromRequest(req);
  if (!clientToken) return "Token no proporcionado (X-M2M-Token o Authorization: Bearer)";
  if (clientToken !== staticToken) return "Token inválido";
  return null;
}

const MCP_INSTRUCTIONS = `AriadneSpecs Oracle: herramientas de análisis de código indexado en FalkorDB.

## API Nest (paridad con el explorador)

Las herramientas **get_component_graph**, **get_legacy_impact** y **get_c4_model** pueden llamar a \`ARIADNE_API_URL\` (default http://localhost:3000). El middleware OTP del API exige JWT en \`Authorization: Bearer\`: define \`ARIADNE_API_BEARER\` o \`ARIADNE_API_JWT\` en el entorno del MCP. Sin token, esas llamadas fallan y el MCP usa fallback Falkor (resultados pueden diferir del UI).

## projectId (OBLIGATORIO)

Si existe \`.ariadne-project\` en la raíz del workspace, **léelo primero** y usa su \`projectId\` en **todas** las llamadas (get_project_analysis, get_legacy_impact, validate_before_edit, etc.). Sin projectId muchas herramientas fallan o devuelven resultados incorrectos.

Formato: \`{ "projectId": "uuid" }\`

Si no hay .ariadne-project: el servidor puede inferir el proyecto vía ingest (heurística \`projectKey\`/\`repoSlug\` en la ruta del IDE) o vía el grafo Falkor. Ejecuta \`list_known_projects\` cuando necesites elegir explícitamente. Nunca inventes ni asumas IDs.`;

/** Crea un MCP Server configurado. Stateless: un Server+Transport por request evita "Server already initialized". */
function createMcpServer(): Server {
  const srv = new Server(
    { name: "AriadneSpecs-Oracle", version: "1.0.0" },
    { capabilities: { tools: {} }, instructions: MCP_INSTRUCTIONS }
  );

  srv.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_known_projects",
      description:
        "Lista los proyectos indexados en el grafo (ID, nombre, ruta, rama). Ejecutar al inicio de sesión para mapear IDs a nombres y ver la rama sincronizada de cada uno (Legacy vs Moderno, oohbp2/main vs oohbp2/develop).",
      inputSchema: {
        type: "object" as const,
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "get_component_graph",
      description:
        "Árbol de dependencias de un componente. Preferencia: API Nest GET /api/graph/component (mismo grafo que el explorador: RENDERS, USES_HOOK, IMPORTS, graphHints). Requiere ARIADNE_API_URL y JWT en ARIADNE_API_BEARER o ARIADNE_API_JWT. Si la API no está disponible o falla, fallback a consulta Falkor genérica (puede diferir).",
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
      name: "get_c4_model",
      description:
        "Modelo C4 (sistemas, contenedores, COMMUNICATES_WITH) vía GET /api/graph/c4-model. Requiere ARIADNE_API_URL (default http://localhost:3000) y JWT en ARIADNE_API_BEARER o ARIADNE_API_JWT (middleware /api/*). Usar tras sync.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "string", description: "ID del proyecto Ariadne (obligatorio con sharding)." },
        },
        required: ["projectId"],
        additionalProperties: false,
      },
    },
    {
      name: "get_legacy_impact",
      description:
        "Dependientes de un nodo (quién lo llama o lo renderiza). Preferencia: API Nest GET /api/graph/impact (GraphService.getImpact: CALLS/RENDERS e IMPORTS entre shards). Requiere ARIADNE_API_BEARER o ARIADNE_API_JWT. Fallback: consulta Falkor directa (solo CALLS|RENDERS*, sin fusión IMPORTS multi-shard).",
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
      name: "ask_codebase",
      description:
        "Pregunta en lenguaje natural sobre el código. Orquestación agéntica: Coordinador (grafo Falkor + archivos físicos: Prisma, Swagger/OpenAPI, package.json, .env.example, tsconfig) → Validador (cross-check grafo vs archivos). responseMode=default: respuesta en prosa (sintetizador). responseMode=evidence_first: la respuesta útil para SDD/The Forge es JSON MDD de 7 claves en el campo answer (string JSON parseable: summary, openapi_spec, entities, api_contracts, business_logic, infrastructure, risk_report, evidence_paths); con ORCHESTRATOR_URL el orchestrator construye el MDD vía ingest mdd-evidence. No uses respuestas vacías si hay archivos indexados: el ingest inyecta evidencia física. Para filesToModify usa get_modification_plan. Requiere INGEST_URL y LLM.",
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
            enum: ["default", "evidence_first"],
            description:
              "default: prosa explicativa (Coordinador/Validador + sintetizador). evidence_first: prioriza retrieval anclado y devuelve answer como JSON MDD (7 secciones) para LegacyCoordinator/The Forge — no sustituye por markdown genérico; parsear answer como JSON. Alineado con CHAT_TWO_PHASE / pipeline ingest u orchestrator.",
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
      name: "analyze_local_changes",
      description:
        "Pre-flight check: revisa los cambios en stage (git diff --cached) contra el grafo FalkorDB. Identifica funciones/componentes editados, eliminados o agregados y proyecta el radio de explosión (quién depende de ellos). Devuelve un resumen de impacto estructurado (tipo, elemento, impacto, riesgo) para evitar código spaghetti o dependencias rotas antes del commit. Requiere workspaceRoot (donde ejecutar git) o stagedDiff (salida cruda de git diff --cached).",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "string", description: "ID del proyecto en Ariadne (list_known_projects). Necesario para el grafo si no se pasa currentFilePath." },
          workspaceRoot: { type: "string", description: "Ruta absoluta o relativa al directorio raíz del repo. Si se pasa, el MCP ejecuta git diff --cached aquí." },
          stagedDiff: { type: "string", description: "Salida cruda de git diff --cached (alternativa cuando el MCP no tiene acceso al filesystem del repo, ej. MCP remoto)." },
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
  ],
}));

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

/** Regex para extraer nombres de funciones/componentes/clases de una línea de código. */
const SYMBOL_PATTERNS = [
  /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g,
  /(?:export\s+)?const\s+(\w+)\s*=\s*(?:\(|function|async)/g,
  /(?:export\s+)?(?:default\s+)?class\s+(\w+)\b/g,
  /<([A-Z][a-zA-Z0-9]*)[\s\/>]/g, // JSX component
  /(?:export\s+)?(?:function|const)\s+(\w+)\s*\(/g,
];

function extractSymbolsFromLine(line: string): string[] {
  const symbols: string[] = [];
  for (const re of SYMBOL_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const name = m[1];
      if (name && !symbols.includes(name)) symbols.push(name);
    }
  }
  return symbols;
}

/** Parsea un unified diff y devuelve símbolos removidos, agregados y editados (por nombre). */
function parseStagedDiff(diff: string): { removed: string[]; added: string[]; edited: string[] } {
  const inMinus = new Set<string>();
  const inPlus = new Set<string>();
  const lines = diff.split(/\r?\n/);

  for (const line of lines) {
    if (line.startsWith("-") && !line.startsWith("---")) {
      for (const s of extractSymbolsFromLine(line.slice(1))) inMinus.add(s);
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      for (const s of extractSymbolsFromLine(line.slice(1))) inPlus.add(s);
    }
  }

  const removed: string[] = [];
  const added: string[] = [];
  const edited: string[] = [];
  for (const s of inMinus) {
    if (inPlus.has(s)) edited.push(s);
    else removed.push(s);
  }
  for (const s of inPlus) {
    if (!inMinus.has(s)) added.push(s);
  }
  return { removed, added, edited };
}

function getStagedDiff(workspaceRoot: string): string {
  try {
    const out = execSync("git diff --cached", {
      encoding: "utf-8",
      cwd: workspaceRoot,
      maxBuffer: 2 * 1024 * 1024,
    });
    return out ?? "";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`No se pudo ejecutar git diff --cached en ${workspaceRoot}: ${msg}`);
  }
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

  srv.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  let graph = await getGraph(undefined);

  if (name === "list_known_projects") {
    const ingestUrl = process.env.INGEST_URL ?? process.env.ARIADNESPEC_INGEST_URL ?? "";
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
        return {
          content: [
            {
              type: "text",
              text: `## Proyectos indexados (multi-root)\n\nCada elemento tiene \`id\` (proyecto Ariadne) y \`roots[]\` (repos). Para **get_modification_plan** con varios repos, pasa como \`projectId\` el \`roots[].id\` del repositorio donde está el código (p. ej. frontend), no solo el \`id\` global del proyecto.\n\n\`\`\`json\n${json}\n\`\`\``,
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
    return {
      content: [{ type: "text", text: `## Proyectos indexados\n\n\`\`\`json\n${json}\n\`\`\`` }],
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
    const cacheKey = `ariadne:component_graph:v2:${projectId ?? "global"}:${componentName}:${depth}`;
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

    try {
      const res = await fetch(apiUrl, ariadneApiFetchInit({ signal: AbortSignal.timeout(30_000) }));
      if (res.ok) {
        const payload = (await res.json()) as ComponentGraphApiPayload;
        const markdown = formatComponentGraphFromApi(payload);
        await cache.set(cacheKey, markdown, 120);
        return { content: [{ type: "text", text: markdown }] };
      }
    } catch {
      /* fallback Falkor */
    }

    const params: Record<string, string | number> = { componentName: resolvedComponentName };
    const compMatchProject = projectId ? ", projectId: $projectId" : "";
    if (projectId) params.projectId = projectId;
    const whereFilter = projectId
      ? ` WHERE (dependency.projectId = $projectId OR dependency.projectId IS NULL)`
      : "";
    const q = `MATCH (c:Component {name: $componentName${compMatchProject}})-[*1..${depth}]->(dependency)${whereFilter} RETURN c, dependency`;
    const result = (await graph.query(q, { params })) as {
      headers?: string[];
      data?: unknown[][];
    };
    const data = result.data ?? [];
    const headers = result.headers ?? ["c", "dependency"];
    const fallbackNote =
      "> **Nota (fallback Falkor):** Consulta genérica `-[*1..depth]->`; no replica `GraphService.getComponent` (RENDERS/USES_HOOK/IMPORTS, hints multi-shard). Para paridad con el explorador, arranca el API Nest y define `ARIADNE_API_URL` + `ARIADNE_API_BEARER` (JWT OTP).\n\n";
    const markdown = fallbackNote + formatComponentGraph(componentName, data, headers);

    await cache.set(cacheKey, markdown, 120);

    return { content: [{ type: "text", text: markdown }] };
  }

  if (name === "get_c4_model") {
    const projectId = String((args?.projectId as string) ?? "").trim();
    if (!projectId) {
      return {
        content: [{ type: "text", text: "**Error:** `projectId` es obligatorio." }],
        isError: true,
      };
    }
    const base = ariadneApiBase();
    try {
      const res = await fetch(
        `${base}/api/graph/c4-model?projectId=${encodeURIComponent(projectId)}`,
        ariadneApiFetchInit({ signal: AbortSignal.timeout(15_000) }),
      );
      if (!res.ok) {
        const t = await res.text();
        return {
          content: [
            {
              type: "text",
              text: `**Error HTTP ${res.status}** al llamar a la API (${base}). ${t.slice(0, 500)}`,
            },
          ],
          isError: true,
        };
      }
      const data = (await res.json()) as {
        projectId: string;
        systems: Array<{
          repoId: string;
          name: string;
          containers: Array<{ key: string; name: string; c4Kind: string; technology?: string }>;
          communicates: Array<{ sourceKey: string; targetKey: string; reason?: string }>;
        }>;
      };
      return { content: [{ type: "text", text: formatC4Markdown(data) }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [
          {
            type: "text",
            text:
              `**Error:** No se pudo obtener el modelo C4. ¿API en **ARIADNE_API_URL** y JWT en **ARIADNE_API_BEARER**? ${msg}`,
          },
        ],
        isError: true,
      };
    }
  }

  if (name === "get_legacy_impact") {
    const nodeName = (args?.nodeName as string) ?? "";
    let projectId = args?.projectId as string | undefined;
    const legacyFilePath = args?.currentFilePath as string | undefined;
    if (!projectId && legacyFilePath) {
      projectId = (await applyShardingInference(undefined, legacyFilePath)) ?? undefined;
    }

    const cache = getMcpToolCache();
    const cacheKey = `ariadne:legacy_impact:v2:${projectId ?? "global"}:${nodeName}`;
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

    try {
      const res = await fetch(impactUrl, ariadneApiFetchInit({ signal: AbortSignal.timeout(30_000) }));
      if (res.ok) {
        const payload = (await res.json()) as {
          nodeId: string;
          dependents: Array<{ name?: unknown; labels?: unknown }>;
        };
        const data = (payload.dependents ?? []).map((d) => [d.name, d.labels]) as unknown[][];
        const headers = ["name", "labels"];
        const apiNote =
          "**Fuente:** API Nest `GET /api/graph/impact` (mismo criterio que GraphService.getImpact).\n\n";
        const markdown = apiNote + formatLegacyImpact(nodeName, data, headers);
        await cache.set(cacheKey, markdown, 120);
        return { content: [{ type: "text", text: markdown }] };
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
    const q = `MATCH (n {name: $nodeName})<-[:CALLS|RENDERS*]-(dependent)${where} RETURN dependent.name AS name, labels(dependent) AS labels`;
    const result = (await graph.query(q, { params })) as {
      headers?: string[];
      data?: unknown[][];
    };
    const data = result.data ?? [];
    const headers = result.headers ?? ["name", "labels"];
    const fallbackNote =
      "> **Nota (fallback Falkor):** Solo `CALLS|RENDERS*` en un shard; no incluye la fusión IMPORTS multi-shard de Nest. Configura `ARIADNE_API_URL` + `ARIADNE_API_BEARER`.\n\n";
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
    const descQ = `MATCH (c:Component {name: $componentName${matchProject}}) RETURN c.description AS description`;
    const descRes = await graph.query(descQ, { params }) as { data?: Array<Record<string, unknown>> };
    const descRow = (descRes.data ?? [])[0] as Record<string, unknown> | undefined;
    const description = descRow ? _rv<string | null>(descRow, "description") : null;
    const q = `MATCH (c:Component {name: $componentName${matchProject}})-[:HAS_PROP]->(p:Prop) RETURN p.name AS name, p.required AS required`;
    const result = await graph.query(q, { params }) as {
      headers?: string[];
      data?: unknown[][];
    };
    const data = result.data ?? [];
    const headers = result.headers ?? ["name", "required"];
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
      return {
        content: [{ type: "text", text: `## Contenido: ${graphPath}\n\n\`\`\`\n${result.content}\n\`\`\`` }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `**Error:** No se pudo obtener el archivo. ¿Está INGEST_URL configurado? ${msg}` }],
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
    const results: { type: string; name: string; projectId?: string }[] = [];
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
          const compVecQ = `CALL db.idx.vector.queryNodes('Component', '${vecProp}', ${k}, vecf32(${vecStr})) YIELD node, score RETURN node.name AS name, node.projectId AS projectId, node.repoId AS repoId, score`;
          const docVecQ = `CALL db.idx.vector.queryNodes('Document', '${vecProp}', ${k}, vecf32(${vecStr})) YIELD node, score RETURN node.path AS path, node.heading AS heading, node.chunkIndex AS chunkIndex, node.projectId AS projectId, node.repoId AS repoId, score`;
          const sbVecQ = `CALL db.idx.vector.queryNodes('StorybookDoc', '${vecProp}', ${k}, vecf32(${vecStr})) YIELD node, score RETURN node.title AS name, node.sourcePath AS path, node.projectId AS projectId, node.repoId AS repoId, score`;
          const mdVecQ = `CALL db.idx.vector.queryNodes('MarkdownDoc', '${vecProp}', ${k}, vecf32(${vecStr})) YIELD node, score RETURN node.title AS name, node.sourcePath AS path, node.projectId AS projectId, node.repoId AS repoId, score`;
          try {
            const seen = new Set<string>();
            await runOnProjectGraphs(graphRouteId, async (g, ctx) => {
              try {
                const [fRes, cRes, dRes, sbRes, mdRes] = await Promise.all([
                  g.query(funcVecQ) as Promise<{ data?: Array<Record<string, unknown>> }>,
                  g.query(compVecQ) as Promise<{ data?: Array<Record<string, unknown>> }>,
                  g.query(docVecQ) as Promise<{ data?: Array<Record<string, unknown>> }>,
                  g.query(sbVecQ) as Promise<{ data?: Array<Record<string, unknown>> }>,
                  g.query(mdVecQ) as Promise<{ data?: Array<Record<string, unknown>> }>,
                ]);
                if (
                  (fRes.data?.length ?? 0) +
                    (cRes.data?.length ?? 0) +
                    (dRes.data?.length ?? 0) +
                    (sbRes.data?.length ?? 0) +
                    (mdRes.data?.length ?? 0) >
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
                    projectId: pid,
                  });
                }
                for (const row of cRes.data ?? []) {
                  if (results.length >= limit) return;
                  const name = _rv<string>(row, "name");
                  const pid = _rv<string>(row, "projectId");
                  if (ctx.cypherProjectId && pid !== ctx.cypherProjectId) continue;
                  if (scopeRepoId && _rv<string>(row, "repoId") !== scopeRepoId) continue;
                  const key = `Component:${name}`;
                  if (seen.has(key)) continue;
                  seen.add(key);
                  results.push({ type: "Component", name: name ?? "", projectId: pid });
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
      const projFilter = requestedScopeId ? ` WHERE ${whereProjectRepo("n", hasRepoScope)}` : "";
      const compQ = `MATCH (n:Component)${projFilter} RETURN n.name AS name LIMIT ${kwLim}`;
      const funcQ = `MATCH (n:Function)${projFilter} RETURN n.name AS name, n.path AS path LIMIT ${kwLim}`;
      const fileQ = `MATCH (n:File)${projFilter} RETURN n.path AS path LIMIT ${kwLim}`;
      const modelQ = `MATCH (n:Model)${projFilter} RETURN n.name AS name, n.path AS path LIMIT ${kwLim}`;
      const nestQ = requestedScopeId
        ? `MATCH (n) WHERE (n:NestController OR n:NestService OR n:NestModule) AND ${whereProjectRepo("n", hasRepoScope)} RETURN labels(n)[0] AS typ, n.name AS name, n.path AS path, n.route AS route LIMIT ${kwLim}`
        : `MATCH (n) WHERE n:NestController OR n:NestService OR n:NestModule RETURN labels(n)[0] AS typ, n.name AS name, n.path AS path, n.route AS route LIMIT ${kwLim}`;
      const routeQ = `MATCH (n:Route)${projFilter} RETURN n.path AS path, n.componentName AS componentName LIMIT ${kwLim}`;
      const domainQ = `MATCH (n:DomainConcept)${projFilter} RETURN n.name AS name, n.category AS category LIMIT ${kwLim}`;
      const sbQ = `MATCH (n:StorybookDoc)${projFilter} RETURN n.title AS title, n.sourcePath AS path LIMIT ${kwLim}`;
      const mdQ = `MATCH (n:MarkdownDoc)${projFilter} RETURN n.title AS title, n.sourcePath AS path LIMIT ${kwLim}`;
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
      const [compRes, funcRes, fileRes, modelRes, nestRes, routeRes, domainRes, sbRes, mdRes] = await Promise.all([
        mergeRows(compQ),
        mergeRows(funcQ),
        mergeRows(fileQ),
        mergeRows(modelQ),
        mergeRows(nestQ),
        mergeRows(routeQ),
        mergeRows(domainQ),
        mergeRows(sbQ),
        mergeRows(mdQ),
      ]);
      const seenKeys = new Set(results.map((r) => `${r.type}:${r.name}`));
      const pushUnique = (type: string, name: string, pid?: string) => {
        if (results.length >= limit) return;
        const key = `${type}:${name}`;
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        results.push({ type, name, projectId: pid });
      };
      for (const row of asObjRows(compRes.data)) {
        const n = _rv<string>(row, "name");
        if (n != null && textMatchesQuery(n, query)) pushUnique("Component", n);
      }
      for (const row of asObjRows(funcRes.data)) {
        const name = _rv<string>(row, "name");
        const path = _rv<string>(row, "path");
        const blob = [name, path].filter(Boolean).join(" ");
        if (textMatchesQuery(blob, query)) {
          pushUnique("Function", path ? `${name ?? ""} — ${path}` : (name ?? ""));
        }
      }
      for (const row of asObjRows(fileRes.data)) {
        const path = _rv<string>(row, "path") ?? "";
        if (textMatchesQuery(path, query)) pushUnique("File", path);
      }
      for (const row of asObjRows(modelRes.data)) {
        const name = _rv<string>(row, "name");
        const path = _rv<string>(row, "path");
        const blob = [name, path].filter(Boolean).join(" ");
        if (textMatchesQuery(blob, query)) {
          pushUnique("Model", path ? `${name ?? ""} — ${path}` : (name ?? ""));
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

    /** OpenAPI indexado (:OpenApiOperation) no suele tener embedding → no aparece en vector; mezclar por Cypher si hay cupo. */
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
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
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
      const data = (await res.json()) as any;
      const statusIcon = data.status === "up_to_date" ? "✅" : data.status === "syncing" ? "⏳" : "⚠️";
      const text = `${statusIcon} **Estatus:** \`${data.status}\`\n- **Última Sincronización:** ${data.lastSync ? new Date(data.lastSync).toLocaleString() : "Nunca"}\n\n**Jobs Recientes:**\n${(data.details || []).slice(0, mcpLimits.syncStatusRecentJobsMax).map((j: any) => `- [${j.type}] ${j.status === "completed" ? "✅" : "❌"} (${new Date(j.createdAt).toLocaleDateString()})`).join("\n")}`;
      
      await cache.set(cacheKey, text, 30);
      return { content: [{ type: "text", text: `### Estado de Sincronización\n\n${text}` }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `**Error de red (Ingest):** ${err.message}` }], isError: true };
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
      return { content: [{ type: "text", text: `### Informe de Deuda Técnica (Nativo)\n\n**Posibles nodos huérfanos/muertos:**\n${text}` }] };
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
        return { content: [{ type: "text", text: "No se encontraron duplicados exactos basados en hash de contenido." }] };
      }

      const text = duplicates.map((r, i) => 
        `#### Grupo ${i+1} (${r.count} archivos)\n- **Hash:** \`${String(r.cHash).substring(0, 8)}\`\n- **Archivos:**\n${(r.files as string[]).map(f => `  - \`${f}\``).join("\n")}`
      ).join("\n\n");

      return { content: [{ type: "text", text: `### Análisis de Duplicados (Nativo)\n\nSe encontraron ${duplicates.length} grupos de archivos idénticos en el proyecto.\n\n${text}` }] };
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
    const rm = args?.responseMode as string | undefined;
    const responseMode = rm === "evidence_first" ? "evidence_first" : undefined;
    const body = JSON.stringify({
      message: question,
      ...(scope && Object.keys(scope).length > 0 ? { scope } : {}),
      ...(typeof args?.twoPhase === "boolean" ? { twoPhase: args.twoPhase } : {}),
      ...(responseMode ? { responseMode } : {}),
    });
    const opts = { method: "POST" as const, headers: { "Content-Type": "application/json" }, body };
    try {
      let res = await fetch(`${base}/projects/${projectId}/chat`, opts);
      if (res.status === 404) res = await fetch(`${base}/repositories/${projectId}/chat`, opts);
      if (!res.ok) {
        const msg = await res.text();
        return { content: [{ type: "text", text: `**Error ${res.status}:** ${msg || res.statusText}` }], isError: true };
      }
      const data = (await res.json()) as { answer: string; cypher?: string; result?: unknown };
      const parts: string[] = [data.answer];
      if (data.cypher) parts.push("", "```cypher", data.cypher, "```");
      return { content: [{ type: "text", text: parts.join("\n") }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `**Error:** No se pudo conectar al chat. ¿INGEST_URL y OPENAI_API_KEY configurados? ${msg}` }], isError: true };
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
      };
      const filesToModify = data.filesToModify ?? [];
      const questionsToRefine = data.questionsToRefine ?? [];
      const text = JSON.stringify(
        {
          filesToModify,
          questionsToRefine,
          ...(data.warnings?.length ? { warnings: data.warnings } : {}),
          ...(data.diagnostic ? { diagnostic: data.diagnostic } : {}),
        },
        null,
        2,
      );
      const hint = filesToModify.length > 0
        ? "\n\nCada archivo en `filesToModify` incluye `path` y `repoId` (root). Si hay varios repoId distintos, el cambio afecta a más de un repo (multi-root)."
        : "";
      return { content: [{ type: "text", text: text + hint }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `**Error:** No se pudo conectar al ingest. ¿INGEST_URL configurado? ${msg}` }], isError: true };
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
    const impactQ = `MATCH (n {name: $nodeName})<-[:CALLS|RENDERS*]-(dependent)${where} RETURN dependent.name AS name, labels(dependent) AS labels`;
    const impactRes = (await graph.query(impactQ, { params })) as { data?: unknown[][] };
    const impactData = impactRes.data ?? [];
    const contractParams: Record<string, string> = { componentName: resolvedName };
    const matchProject = projectId ? ", projectId: $projectId" : "";
    if (projectId) contractParams.projectId = projectId;
    const contractQ = `MATCH (c:Component {name: $componentName${matchProject}})-[:HAS_PROP]->(p:Prop) RETURN p.name AS name, p.required AS required`;
    const contractRes = await graph.query(contractQ, { params: contractParams }) as { data?: unknown[][] };
    const contractData = contractRes.data ?? [];
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
        lines.push(`- **${name}**`);
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
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // --- get_definitions ---
  if (name === "get_definitions") {
    const symbolName = (args?.symbolName as string) ?? "";
    let projectId = args?.projectId as string | undefined;
    const currentFilePath = args?.currentFilePath as string | undefined;
    if (!projectId && currentFilePath) {
      projectId = (await applyShardingInference(undefined, currentFilePath)) ?? undefined;
    }
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
    return { content: [{ type: "text", text: `## Definiciones: ${symbolName}\n\n${results.join("\n")}` }] };
  }

  // --- get_references ---
  if (name === "get_references") {
    const symbolName = (args?.symbolName as string) ?? "";
    let projectId = args?.projectId as string | undefined;
    const currentFilePath = args?.currentFilePath as string | undefined;
    if (!projectId && currentFilePath) {
      projectId = (await applyShardingInference(undefined, currentFilePath)) ?? undefined;
    }
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
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // --- get_implementation_details ---
  if (name === "get_implementation_details") {
    const symbolName = (args?.symbolName as string) ?? "";
    let projectId = args?.projectId as string | undefined;
    const currentFilePath = args?.currentFilePath as string | undefined;
    if (!projectId && currentFilePath) {
      projectId = (await applyShardingInference(undefined, currentFilePath)) ?? undefined;
    }
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
    return { content: [{ type: "text", text: lines.join("\n") }] };
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
    return { content: [{ type: "text", text: lines.join("\n") }] };
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
    graph = await getGraph(resolvedProjectId);
    const params: Record<string, string> = { projectId: resolvedProjectId };
    const fileFilter = filePath ? " AND f.path = $filePath" : "";
    if (filePath) params.filePath = filePath;
    const exportsQ = `MATCH (f:File {projectId: $projectId})${fileFilter}-[:CONTAINS]->(n)
      WHERE n:Component OR n:Function
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
    return { content: [{ type: "text", text: lines.join("\n") }] };
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
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  // --- check_breaking_changes ---
  if (name === "check_breaking_changes") {
    const nodeName = (args?.nodeName as string) ?? "";
    const removedParams = (args?.removedParams as string[]) ?? [];
    let projectId = args?.projectId as string | undefined;
    const currentFilePath = args?.currentFilePath as string | undefined;
    if (!projectId && currentFilePath) {
      projectId = (await applyShardingInference(undefined, currentFilePath)) ?? undefined;
    }
    graph = await getGraph(projectId ?? undefined);
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
    const lines = [
      `## Análisis de cambios: ${nodeName}`,
      "",
      `**Dependientes:** ${depCount}`,
      "",
      ...(removed.length
        ? [
            "⚠️ **ALERTA:** Los siguientes parámetros se planean eliminar pero existen en el contrato:",
            ...removed.map((p) => `- \`${p}\``),
            "",
            `Esto podría romper ${depCount} sitio(s) que usan este nodo. Revisar cada llamada antes de aplicar.`,
          ]
        : removedParams.length
          ? ["(Los parámetros indicados no existen en el contrato actual; revisar nombres.)"]
          : ["Sin parámetros indicados para eliminar. Si cambias la firma, verificar manualmente los dependientes."]),
    ];
    return { content: [{ type: "text", text: lines.join("\n") }] };
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
          try {
            const seen = new Set<string>();
            await runOnProjectGraphs(graphRouteId, async (g, ctx) => {
              try {
                const [fRes, cRes] = await Promise.all([
                  g.query(funcVecQ) as Promise<{ data?: Array<Record<string, unknown>> }>,
                  g.query(compVecQ) as Promise<{ data?: Array<Record<string, unknown>> }>,
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
      const [compRes, funcRes] = await Promise.all([mergeRows(compQ), mergeRows(funcQ)]);
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
    }
    const lines = [`## Implementaciones similares: "${query}"${usedVector ? " (vector)" : ""}`, "", ...results.slice(0, limit).map((r) => `- **${r.type}:** ${r.name}`)];
    return { content: [{ type: "text", text: lines.join("\n") }] };
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

  if (name === "analyze_local_changes") {
    const projectId = (args?.projectId as string) ?? "";
    const workspaceRoot = (args?.workspaceRoot as string) ?? "";
    const stagedDiff = (args?.stagedDiff as string) ?? "";
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
    graph = await getGraph(resolvedProjectId);

    let rawDiff: string;
    if (workspaceRoot.trim()) {
      try {
        rawDiff = getStagedDiff(workspaceRoot.trim());
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text", text: `**Error obteniendo diff:** ${msg}\n\nAlternativa: ejecuta \`git diff --cached\` en tu repo y pasa el resultado en \`stagedDiff\` (útil cuando el MCP corre en remoto).` }],
          isError: true,
        };
      }
    } else if (stagedDiff.trim()) {
      rawDiff = stagedDiff.trim();
    } else {
      return {
        content: [{ type: "text", text: "**Error:** Indica `workspaceRoot` (ruta del repo donde ejecutar `git diff --cached`) o `stagedDiff` (salida cruda del comando)." }],
        isError: true,
      };
    }

    if (!rawDiff) {
      return {
        content: [{ type: "text", text: "No hay cambios en stage. Ejecuta `git add` en los archivos que quieras incluir y vuelve a llamar a esta herramienta antes del commit." }],
      };
    }

    const { removed, added, edited } = parseStagedDiff(rawDiff);
    const allSymbols = [
      ...removed.map((s) => ({ name: s, kind: "Eliminación" as const })),
      ...edited.map((s) => ({ name: s, kind: "Modificación" as const })),
      ...added.map((s) => ({ name: s, kind: "Nuevo" as const })),
    ];

    const whereParts = [
      "(n.projectId = $projectId OR n.projectId IS NULL)",
      "(dep.projectId = $projectId OR dep.projectId IS NULL)",
    ];
    const where = ` WHERE ${whereParts.join(" AND ")}`;
    const countQ = `MATCH (n {name: $nodeName})<-[:CALLS|RENDERS*]-(dep)${where} RETURN count(dep) AS cnt`;

    const rows: { tipo: string; elemento: string; impacto: string; riesgo: string }[] = [];
    for (const { name: symbolName, kind } of allSymbols) {
      let cnt = 0;
      try {
        const countRes = (await graph.query(countQ, { params: { nodeName: symbolName, projectId: resolvedProjectId } })) as { data?: Array<Record<string, unknown>> };
        const first = (countRes.data ?? [])[0] as Record<string, unknown> | undefined;
        const val = first?.cnt;
        cnt = typeof val === "number" ? val : parseInt(String(val ?? "0"), 10) || 0;
      } catch {
        cnt = 0;
      }

      let impacto: string;
      let riesgo: string;
      if (kind === "Eliminación") {
        if (cnt > 0) {
          impacto = `${cnt} componente(s) o función(es) quedaron huérfanos (aún dependen de este símbolo).`;
          riesgo = "ALTO";
        } else {
          impacto = "No aparece en el grafo o sin dependientes (código muerto o no indexado).";
          riesgo = "BAJO";
        }
      } else if (kind === "Modificación") {
        if (cnt > 0) {
          impacto = `${cnt} pantalla(s) o función(es) verán el cambio.`;
          riesgo = cnt >= 10 ? "ALTO" : "MEDIO";
        } else {
          impacto = "Sin dependientes directos en el grafo.";
          riesgo = "BAJO";
        }
      } else {
        impacto = "Sin dependencias entrantes aún.";
        riesgo = "BAJO";
      }
      rows.push({ tipo: kind, elemento: symbolName, impacto, riesgo });
    }

    const tableHeader = "| Tipo de Cambio | Elemento | Impacto en el Sistema | Riesgo |\n|----------------|----------|------------------------|--------|";
    const tableRows = rows.map((r) => `| ${r.tipo} | ${r.elemento} | ${r.impacto} | ${r.riesgo} |`).join("\n");
    const summary = [
      "## Resumen de impacto (pre-flight check)",
      "",
      "Revisión de cambios en stage contra el grafo FalkorDB. Si hay **ALTO** riesgo, valora deshacer el stage o actualizar dependientes antes del commit.",
      "",
      tableHeader,
      tableRows,
      "",
      ...(rows.some((r) => r.riesgo === "ALTO")
        ? ["**Recomendación:** Revisa los elementos en riesgo ALTO antes de hacer push. Podrías romper el build en master."]
        : []),
    ].join("\n");

    return { content: [{ type: "text", text: summary }] };
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
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
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const labels = Array.isArray(labelsVal) ? labelsVal.join(", ") : String(labelsVal ?? "");
    lines.push(`- **${name}** (${labels})`);
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
  const isMcpPath = pathNorm === MCP_PATH || pathNorm === `${MCP_PATH}/` || pathNorm === "/";

  if (serveWellKnown(pathNorm, req, res)) return;

  if (!isMcpPath) {
    console.log(`[MCP] 404 ${req.method} ${pathNorm}`);
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found", path: pathNorm }));
    return;
  }

  const authError = validateAuth(req);
  if (authError) {
    console.warn(`[MCP] 401 Unauthorized: ${authError} (${req.headers["x-forwarded-for"] ?? req.socket.remoteAddress})`);
    res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" });
    res.end(JSON.stringify({ error: "Unauthorized", message: authError }));
    return;
  }

  // Stateless: un Server+Transport por request. Evita "Server already initialized" cuando Cursor reintenta el handshake.
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

async function main() {
  const port = parseInt(process.env.PORT ?? process.env.MCP_HTTP_PORT ?? "8080", 10);
  const rawToken = process.env.MCP_AUTH_TOKEN;
  const authEnabled = !!rawToken?.trim();
  const authMode = authEnabled ? "static (Bearer)" : "disabled";
  console.log("[AriadneSpecs MCP] Starting Streamable HTTP server (stateless)...");
  console.log(`[MCP] Port: ${port}, Path: ${MCP_PATH}, Auth: ${authMode}`);
  console.log(`[MCP] MCP_AUTH_TOKEN: ${authEnabled ? "configured" : "empty or not set"}`);

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

main().catch((err) => {
  console.error("[AriadneSpecs MCP] Fatal error:", err);
  process.exit(1);
});
