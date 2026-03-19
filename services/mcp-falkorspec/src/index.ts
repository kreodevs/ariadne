#!/usr/bin/env node
/**
 * @fileoverview FalkorSpecs Oracle MCP Server. Transporte Streamable HTTP. Tools: get_component_graph, get_legacy_impact, validate_before_edit, semantic_search, etc. Config: PORT, MCP_AUTH_TOKEN, SSO_API_URL, FALKORDB_HOST, INGEST_URL.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execSync } from "node:child_process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getGraph, closeFalkor } from "./falkor.js";

const MCP_PATH = "/mcp";

/** URL base del SSO para /auth/validate. Si no está definida, se infiere de SSO_JWKS_URI (igual que la API). */
function getSSOBaseUrl(): string {
  const explicit = process.env.SSO_API_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const jwks = process.env.SSO_JWKS_URI?.trim();
  if (jwks) return jwks.replace(/\/auth\/jwks\/?$/, "").replace(/\/$/, "");
  return "";
}

const SSO_BASE = getSSOBaseUrl();
/** APPLICATION_ID o SSO_APPLICATION_ID (misma variable que la API). */
const APPLICATION_ID =
  process.env.APPLICATION_ID?.trim() ||
  process.env.SSO_APPLICATION_ID?.trim() ||
  "";

function getTokenFromRequest(req: IncomingMessage): string | null {
  const m2m = req.headers["x-m2m-token"];
  if (typeof m2m === "string" && m2m.trim()) return m2m.trim();
  const auth = req.headers.authorization;
  return auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
}

interface ValidateResponse {
  valid?: boolean;
  type?: string;
  success?: boolean;
  data?: { valid?: boolean; type?: string };
  error?: string;
  message?: string;
}

/** Cache de tokens válidos para reducir llamadas al SSO y evitar 429 rate limit. */
const tokenCache = new Map<string, { expiresAt: number }>();
const CACHE_TTL_MS = parseInt(process.env.MCP_TOKEN_CACHE_TTL_SEC ?? "300", 10) * 1000; // 5 min default

function getCachedValidation(token: string): boolean | null {
  const entry = tokenCache.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    tokenCache.delete(token);
    return null;
  }
  return true;
}

function setCachedValidation(token: string): void {
  tokenCache.set(token, { expiresAt: Date.now() + CACHE_TTL_MS });
  if (tokenCache.size > 100) {
    const oldest = [...tokenCache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
    if (oldest) tokenCache.delete(oldest[0]);
  }
}

/**
 * Valida token M2M llamando al SSO. Cache en memoria para evitar 429 rate limit.
 * M2M no requiere rol (a diferencia de JWT).
 */
async function validateM2MWithSSO(token: string): Promise<string | null> {
  if (!SSO_BASE) return "SSO_API_URL o SSO_JWKS_URI no configurado";
  if (!APPLICATION_ID) return "APPLICATION_ID o SSO_APPLICATION_ID no configurado en el contenedor MCP. El SSO lo requiere para validar tokens M2M.";

  if (getCachedValidation(token) === true) return null;

  const url = `${SSO_BASE}/auth/validate`;
  const baseHeaders: Record<string, string> = {
    "X-M2M-Token": token,
    ...(APPLICATION_ID ? { "X-Application-Id": APPLICATION_ID } : {}),
  };

  const tryValidate = async (headers: Record<string, string>): Promise<string | null> => {
    const res = await fetch(url, { method: "GET", headers });

    const ct = res.headers.get("content-type") ?? "";
    const body = await res.text();

    if (!ct.includes("application/json")) {
      return `SSO respondió ${res.status} (${ct}). URL: ${url}. Respuesta: ${body.slice(0, 150)}`;
    }

    let json: ValidateResponse;
    try {
      json = JSON.parse(body) as ValidateResponse;
    } catch {
      return `SSO devolvió JSON inválido: ${body.slice(0, 100)}`;
    }

    const data = json?.data ?? json;

    // 2xx + valid/success en respuesta → OK (cachear para evitar 429)
    if (res.ok) {
      const valid =
        data?.valid === true ||
        (data as Record<string, unknown>)?.valid === true ||
        (data as Record<string, unknown>)?.success === true ||
        json?.valid === true ||
        json?.success === true;
      if (valid) {
        setCachedValidation(token);
        return null;
      }
      return `SSO ok pero sin valid=true. Respuesta: ${JSON.stringify(json).slice(0, 200)}`;
    }

    // 429 → rate limit (no cachear; reintentar más tarde)
    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after");
      return `SSO rate limit (429). Demasiadas validaciones. Espera unos minutos.${retryAfter ? ` Retry-After: ${retryAfter}s` : ""}`;
    }

    // 4xx/5xx → token rechazado
    const errMsg = (json?.message ?? json?.error ?? body).toString().slice(0, 150);
    return `SSO rechazó el token (${res.status}): ${errMsg}`;
  };

  try {
    let err = await tryValidate(baseHeaders);
    if (!err) return null;

    // Fallback: algunos SSOs esperan Authorization: Bearer para M2M
    const withBearer = await tryValidate({
      ...baseHeaders,
      Authorization: `Bearer ${token}`,
    });
    if (!withBearer) return null;

    return err;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `Error validando token con SSO (${url}): ${msg}`;
  }
}

/** Valida auth: SSO (si configurado) o MCP_AUTH_TOKEN estático. Retorna null si ok. */
async function validateAuth(req: IncomingMessage): Promise<string | null> {
  const useSSO = !!SSO_BASE && !!APPLICATION_ID;
  const staticToken = process.env.MCP_AUTH_TOKEN?.trim();
  const authRequired = useSSO || !!staticToken;

  if (!authRequired) return null;

  const clientToken = getTokenFromRequest(req);
  if (!clientToken) return "Token no proporcionado (X-M2M-Token o Authorization: Bearer)";

  if (useSSO) return validateM2MWithSSO(clientToken);
  if (clientToken !== staticToken) return "Token inválido";
  return null;
}

const MCP_INSTRUCTIONS = `FalkorSpecs Oracle: herramientas de análisis de código indexado en FalkorDB.

## projectId (OBLIGATORIO)

Si existe \`.ariadne-project\` en la raíz del workspace, **léelo primero** y usa su \`projectId\` en **todas** las llamadas (get_project_analysis, get_legacy_impact, validate_before_edit, etc.). Sin projectId muchas herramientas fallan o devuelven resultados incorrectos.

Formato: \`{ "projectId": "uuid" }\`

Si no hay .ariadne-project: ejecuta \`list_known_projects\` y usa el \`id\` que coincida con el proyecto del usuario. Nunca inventes ni asumas IDs.`;

/** Crea un MCP Server configurado. Stateless: un Server+Transport por request evita "Server already initialized". */
function createMcpServer(): Server {
  const srv = new Server(
    { name: "FalkorSpecs-Oracle", version: "1.0.0" },
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
        "Recupera el árbol de dependencias directo e indirecto de un componente (archivos, componentes que renderiza, hooks que usa).",
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
        "Analiza qué componentes o funciones se verían afectados si se modifica el nodo dado (quién lo llama o lo renderiza).",
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
        "Obtiene el contenido de un archivo del repositorio (Bitbucket/GitHub). Requiere INGEST_URL configurado. projectId es el ID del repo (list_known_projects).",
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
        "Búsqueda por palabra clave en componentes, funciones y archivos del grafo. Sin projectId: búsqueda global en todos los proyectos. Con projectId: limita al proyecto.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Términos de búsqueda (ej. login, form, auth)" },
          projectId: { type: "string", description: "ID del proyecto (opcional, limita el ámbito)" },
          limit: { type: "number", description: "Máximo de resultados (default 15)" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "get_project_analysis",
      description:
        "Obtiene diagnóstico de deuda técnica, código duplicado o recomendaciones de reingeniería. Requiere INGEST_URL. Duplicados requiere embed-index previo.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "string", description: "ID del proyecto (list_known_projects)" },
          mode: {
            type: "string",
            description: "diagnostico | duplicados | reingenieria | codigo_muerto (default: diagnostico)",
            enum: ["diagnostico", "duplicados", "reingenieria", "codigo_muerto"],
          },
        },
        required: ["projectId"],
        additionalProperties: false,
      },
    },
    {
      name: "ask_codebase",
      description:
        "Pregunta en lenguaje natural sobre el código del proyecto. Usa arquitectura agéntica (Coordinator → CodeAnalysis | KnowledgeExtraction). Para listas exhaustivas de archivos a modificar y preguntas de afinación (flujo legacy/MaxPrime), usa get_modification_plan: esa herramienta garantiza filesToModify 100% del grafo y preguntas solo de negocio. Requiere INGEST_URL y OPENAI_API_KEY.",
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
          currentFilePath: { type: "string", description: "Ruta del archivo (opcional, para inferir projectId)" },
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
          limit: { type: "number", description: "Máximo resultados (default 10)" },
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

/** Resolve path (graph path or IDE path) to graph path + projectId for File queries */
async function resolveFileForPath(
  graph: GraphType,
  pathParam: string,
  projectId?: string | null,
  currentFilePath?: string | null
): Promise<{ graphPath: string; projectId: string | null }> {
  const normalized = pathParam.replace(/\\/g, "/");
  const isAbsoluteLike = normalized.startsWith("/") || /^[A-Za-z]:/.test(pathParam);

  let resolvedProjectId = projectId ?? null;
  if (!resolvedProjectId && currentFilePath) {
    resolvedProjectId = await inferProjectIdFromPath(graph, currentFilePath);
  }

  // If path looks like IDE path, try to resolve to graph path
  if (isAbsoluteLike) {
    const filesQ = resolvedProjectId
      ? `MATCH (f:File {projectId: $projectId}) RETURN f.path AS path`
      : `MATCH (f:File) RETURN f.path AS path, f.projectId AS id`;
    const filesRes = resolvedProjectId
      ? ((await graph.query(filesQ, { params: { projectId: resolvedProjectId } })) as { data?: Array<Record<string, unknown>> })
      : ((await graph.query(filesQ)) as { data?: Array<Record<string, unknown>> });
    const fileRows = (filesRes.data ?? []);
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
      return { graphPath: best.path, projectId: resolvedProjectId ?? best.id ?? null };
    }
  }

  // Short path (usePauta, usePauta.tsx): buscar File cuyo path termina en ese segmento
  const hasNoSlash = !normalized.includes("/");
  const searchSuffix = hasNoSlash ? normalized : normalized.split("/").pop() ?? normalized;
  if (hasNoSlash && searchSuffix) {
    const filesQ = resolvedProjectId
      ? `MATCH (f:File {projectId: $projectId}) RETURN f.path AS path, f.projectId AS id`
      : `MATCH (f:File) RETURN f.path AS path, f.projectId AS id`;
    const filesRes = resolvedProjectId
      ? ((await graph.query(filesQ, { params: { projectId: resolvedProjectId } })) as { data?: Array<Record<string, unknown>> })
      : ((await graph.query(filesQ)) as { data?: Array<Record<string, unknown>> });
    const fileRows = (filesRes.data ?? []);
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
      return { graphPath: bestShort.path, projectId: resolvedProjectId ?? bestShort.id ?? null };
    }
  }

  // Use as graph path directly
  return { graphPath: normalized, projectId: resolvedProjectId };
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
  const graph = await getGraph();

  if (name === "list_known_projects") {
    const ingestUrl = process.env.INGEST_URL ?? process.env.FALKORSPEC_INGEST_URL ?? "";
    if (ingestUrl) {
      try {
        const res = await fetch(`${ingestUrl.replace(/\/$/, "")}/projects`, {
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const data = (await res.json()) as Array<{
            id: string;
            name: string | null;
            repositories: Array<{ id: string; projectKey: string; repoSlug: string; defaultBranch: string }>;
          }>;
          const projects = data.map((p) => ({
            id: p.id,
            name: p.name ?? "",
            roots: p.repositories.map((r) => ({
              id: r.id,
              name: `${r.projectKey}/${r.repoSlug}`,
              branch: r.defaultBranch ?? null,
            })),
          }));
          const json = JSON.stringify(projects, null, 2);
          return {
            content: [
              {
                type: "text",
                text: `## Proyectos indexados (multi-root)\n\nCada elemento tiene \`id\` (proyecto Ariadne) y \`roots[]\` (repos). Para **get_modification_plan** con varios repos, pasa como \`projectId\` el \`roots[].id\` del repositorio donde está el código (p. ej. frontend), no solo el \`id\` global del proyecto.\n\n\`\`\`json\n${json}\n\`\`\``,
              },
            ],
          };
        }
      } catch {
        // Fallback to graph
      }
    }
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
    const depth = Math.min(Math.max(1, (args?.depth as number) ?? 2), 10); // Acotado 1-10; FalkorDB no soporta $depth en variable-length path
    let projectId = args?.projectId as string | undefined;
    const currentFilePath = args?.currentFilePath as string | undefined;
    if (!projectId && currentFilePath) {
      projectId = (await inferProjectIdFromPath(graph, currentFilePath)) ?? undefined;
    }
    const exists = await nodeExists(graph, componentName, projectId ?? null);
    if (!exists) {
      return {
        content: [{ type: "text", text: `[NOT_FOUND_IN_GRAPH]\n\n**Componente \`${componentName}\` no encontrado en el grafo.**\n\nVerifica el nombre o ejecuta sync/resync del proyecto. No proceder sin reindexar.` }],
        isError: true,
      };
    }
    const resolvedComponentName = await resolveNodeName(graph, componentName, projectId ?? null);
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
    const markdown = formatComponentGraph(componentName, data, headers);
    return { content: [{ type: "text", text: markdown }] };
  }

  if (name === "get_legacy_impact") {
    const nodeName = (args?.nodeName as string) ?? "";
    let projectId = args?.projectId as string | undefined;
    const legacyFilePath = args?.currentFilePath as string | undefined;
    if (!projectId && legacyFilePath) {
      projectId = (await inferProjectIdFromPath(graph, legacyFilePath)) ?? undefined;
    }
    const exists = await nodeExists(graph, nodeName, projectId ?? null);
    if (!exists) {
      return {
        content: [{ type: "text", text: `[NOT_FOUND_IN_GRAPH]\n\n**Nodo \`${nodeName}\` no encontrado en el grafo.**\n\nVerifica el nombre o ejecuta sync/resync del proyecto. Usa \`list_known_projects\` para el projectId. No proceder sin reindexar.` }],
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
    const q = `MATCH (n {name: $nodeName})<-[:CALLS|RENDERS*]-(dependent)${where} RETURN dependent.name AS name, labels(dependent) AS labels`;
    const result = (await graph.query(q, { params })) as {
      headers?: string[];
      data?: unknown[][];
    };
    const data = result.data ?? [];
    const headers = result.headers ?? ["name", "labels"];
    const markdown = formatLegacyImpact(nodeName, data, headers);
    return { content: [{ type: "text", text: markdown }] };
  }

  if (name === "get_contract_specs") {
    const componentName = (args?.componentName as string) ?? "";
    let projectId = args?.projectId as string | undefined;
    const currentFilePath = args?.currentFilePath as string | undefined;
    if (!projectId && currentFilePath) {
      projectId = (await inferProjectIdFromPath(graph, currentFilePath)) ?? undefined;
    }
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
    const { graphPath, projectId: resolvedProjectId } = await resolveFileForPath(graph, pathParam, projectId, currentFilePath);
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
    const { graphPath, projectId: resolvedProjectId } = await resolveFileForPath(graph, filePathParam, projectId, currentFilePath);
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
      projectId = (await inferProjectIdFromPath(graph, currentFilePath)) ?? undefined;
    }
    if (!projectId) {
      return {
        content: [{ type: "text", text: "**Error:** Se requiere `projectId` o `currentFilePath` para obtener el contenido del archivo." }],
        isError: true,
      };
    }
    const { graphPath } = await resolveFileForPath(graph, pathParam, projectId, currentFilePath);
    const ingestUrl = process.env.INGEST_URL ?? process.env.FALKORSPEC_INGEST_URL ?? "http://localhost:3002";
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
    const limit = Math.min(50, Math.max(1, (args?.limit as number) ?? 15));
    if (!query) {
      return {
        content: [{ type: "text", text: "**Error:** El parámetro `query` es requerido." }],
        isError: true,
      };
    }
    const ingestUrl = process.env.INGEST_URL ?? process.env.FALKORSPEC_INGEST_URL ?? "http://localhost:3002";
    const results: { type: string; name: string; projectId?: string }[] = [];
    let usedVector = false;
    try {
      const embedRes = await fetch(`${ingestUrl.replace(/\/$/, "")}/embed?text=${encodeURIComponent(query)}`);
      if (embedRes.ok) {
        const { embedding } = (await embedRes.json()) as { embedding?: number[] };
        const valid = Array.isArray(embedding) && embedding.every((v) => typeof v === "number" && Number.isFinite(v));
        if (valid && embedding!.length > 0) {
          const vecStr = `[${embedding!.join(",")}]`;
          const k = Math.min(Math.max(limit, 20), 100);
          const funcVecQ = `CALL db.idx.vector.queryNodes('Function', 'embedding', ${k}, vecf32(${vecStr})) YIELD node, score RETURN node.name AS name, node.path AS path, node.projectId AS projectId, score`;
          const compVecQ = `CALL db.idx.vector.queryNodes('Component', 'embedding', ${k}, vecf32(${vecStr})) YIELD node, score RETURN node.name AS name, node.projectId AS projectId, score`;
          try {
            const [fRes, cRes] = await Promise.all([
              graph.query(funcVecQ) as Promise<{ data?: Array<Record<string, unknown>> }>,
              graph.query(compVecQ) as Promise<{ data?: Array<Record<string, unknown>> }>,
            ]);
            const seen = new Set<string>();
            for (const row of asObjRows(fRes.data)) {
              const name = _rv<string>(row, "name") ?? "";
              const path = _rv<string>(row, "path") ?? "";
              const pid = _rv<string>(row, "projectId");
              if (projectId && pid !== projectId) continue;
              const key = `Function:${name}:${path}`;
              if (seen.has(key)) continue;
              seen.add(key);
              results.push({ type: "Function", name: path ? `${name ?? ""} — ${path}` : (name ?? ""), projectId: pid });
              if (results.length >= limit) break;
            }
            for (const row of (cRes.data ?? [])) {
              if (results.length >= limit) break;
              const name = _rv<string>(row, "name");
              const pid = _rv<string>(row, "projectId");
              if (projectId && pid !== projectId) continue;
              const key = `Component:${name}`;
              if (seen.has(key)) continue;
              seen.add(key);
              results.push({ type: "Component", name: name ?? "", projectId: pid });
            }
            usedVector = true;
          } catch {
            /* vector index may not exist, fall through to keyword */
          }
        }
      }
    } catch {
      /* embed endpoint may not be configured */
    }
    if (!usedVector) {
      const qLower = query.toLowerCase();
      const projFilter = projectId ? " WHERE n.projectId = $projectId" : "";
      const compParams = projectId ? { params: { projectId } } : {};
      const compQ = `MATCH (n:Component)${projFilter} RETURN n.name AS name LIMIT 100`;
      const funcQ = `MATCH (n:Function)${projFilter} RETURN n.name AS name, n.path AS path LIMIT 100`;
      const fileQ = `MATCH (n:File)${projFilter} RETURN n.path AS path LIMIT 100`;
      const [compRes, funcRes, fileRes] = await Promise.all([
        graph.query(compQ, compParams) as Promise<{ data?: unknown[][] }>,
        graph.query(funcQ, compParams) as Promise<{ data?: unknown[][] }>,
        graph.query(fileQ, compParams) as Promise<{ data?: unknown[][] }>,
      ]);
      for (const row of asObjRows(compRes.data)) {
        if (results.length >= limit) break;
        const n = _rv<string>(row, "name");
        if (n?.toLowerCase().includes(qLower)) results.push({ type: "Component", name: n });
      }
      for (const row of asObjRows(funcRes.data)) {
        if (results.length >= limit) break;
        const name = _rv<string>(row, "name");
        const path = _rv<string>(row, "path");
        if (name?.toLowerCase().includes(qLower) || path?.toLowerCase().includes(qLower)) {
          results.push({ type: "Function", name: path ? `${name ?? ""} — ${path}` : (name ?? "") });
        }
      }
      for (const row of asObjRows(fileRes.data)) {
        if (results.length >= limit) break;
        const path = _rv<string>(row, "path") ?? "";
        if (path?.toLowerCase().includes(qLower)) results.push({ type: "File", name: path ?? "" });
      }
    }
    const lines = [`## Búsqueda: "${query}"${usedVector ? " (vector)" : ""}`, "", ...results.slice(0, limit).map((r) => `- **${r.type}:** ${r.name}`)];
    if (results.length === 0) lines.push("No se encontraron resultados.");
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  if (name === "get_project_analysis") {
    const projectId = (args?.projectId as string) ?? "";
    const mode = ((args?.mode as string) ?? "diagnostico") as "diagnostico" | "duplicados" | "reingenieria" | "codigo_muerto";
    if (!projectId) {
      return {
        content: [{ type: "text", text: "**Error:** Se requiere `projectId` (list_known_projects)." }],
        isError: true,
      };
    }
    const ingestUrl = process.env.INGEST_URL ?? process.env.FALKORSPEC_INGEST_URL ?? "http://localhost:3002";
    const url = `${ingestUrl.replace(/\/$/, "")}/repositories/${projectId}/analyze`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) {
        const msg = await res.text();
        return { content: [{ type: "text", text: `**Error ${res.status}:** ${msg || res.statusText}` }], isError: true };
      }
      const data = (await res.json()) as { mode: string; summary: string };
      const title =
        data.mode === "diagnostico" ? "Deuda técnica" :
        data.mode === "duplicados" ? "Código duplicado" :
        data.mode === "codigo_muerto" ? "Código muerto" : "Reingeniería";
      const passthrough =
        data.mode === "codigo_muerto"
          ? "[Presentar este análisis tal cual, sin reformatear ni añadir categorías. Es la clasificación oficial.]\n\n"
          : "";
      return { content: [{ type: "text", text: `## ${title}\n\n${passthrough}${data.summary}` }] };
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
      projectId = (await inferProjectIdFromPath(graph, currentFilePath)) ?? undefined;
    }
    if (!projectId) {
      return {
        content: [{ type: "text", text: "**Error:** Se requiere `projectId` o `currentFilePath` para inferir el proyecto. Usa list_known_projects para IDs." }],
        isError: true,
      };
    }
    const ingestUrl = process.env.INGEST_URL ?? process.env.FALKORSPEC_INGEST_URL ?? "http://localhost:3002";
    const base = ingestUrl.replace(/\/$/, "");
    const scopeRaw = args?.scope;
    const scope =
      scopeRaw && typeof scopeRaw === "object" && !Array.isArray(scopeRaw)
        ? (scopeRaw as Record<string, unknown>)
        : undefined;
    const body = JSON.stringify({
      message: question,
      ...(scope ? { scope } : {}),
      ...(typeof args?.twoPhase === "boolean" ? { twoPhase: args.twoPhase } : {}),
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
      projectId = (await inferProjectIdFromPath(graph, currentFilePath)) ?? undefined;
    }
    if (!projectId) {
      return {
        content: [{ type: "text", text: "**Error:** Se requiere `projectId` o `currentFilePath` para inferir el proyecto. Usa list_known_projects para IDs." }],
        isError: true,
      };
    }
    const ingestUrl = process.env.INGEST_URL ?? process.env.FALKORSPEC_INGEST_URL ?? "http://localhost:3002";
    const url = `${ingestUrl.replace(/\/$/, "")}/projects/${projectId}/modification-plan`;
    const scopeRaw = args?.scope;
    const scope =
      scopeRaw && typeof scopeRaw === "object" && !Array.isArray(scopeRaw)
        ? scopeRaw
        : undefined;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userDescription, ...(scope ? { scope } : {}) }),
      });
      if (!res.ok) {
        const msg = await res.text();
        return { content: [{ type: "text", text: `**Error ${res.status}:** ${msg || res.statusText}` }], isError: true };
      }
      const data = (await res.json()) as {
        filesToModify: Array<{ path: string; repoId: string }>;
        questionsToRefine: string[];
      };
      const filesToModify = data.filesToModify ?? [];
      const questionsToRefine = data.questionsToRefine ?? [];
      const text = JSON.stringify({ filesToModify, questionsToRefine }, null, 2);
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
      projectId = (await inferProjectIdFromPath(graph, currentFilePath)) ?? undefined;
    }
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
    const funcQ = `MATCH (f:Function) WHERE f.name = $nodeName${funcProjFilter} RETURN f.path AS path, f.description AS description, f.endpointCalls AS endpointCalls LIMIT 5`;
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
        lines.push(`- **${path ?? "(sin path)"}**${description ? ` — ${String(description).slice(0, 60)}` : ""}${endpointStr}`);
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
      projectId = (await inferProjectIdFromPath(graph, currentFilePath)) ?? undefined;
    }
    const params: Record<string, string> = { symbolName };
    if (projectId) params.projectId = projectId;
    const compProj = projectId ? ", projectId: $projectId" : "";
    const compProjWhere = projectId ? " AND n.projectId = $projectId" : "";
    const projFilter = projectId ? " AND n.projectId = $projectId" : "";
    const compQ = `MATCH (f:File)-[:CONTAINS]->(n:Component {name: $symbolName${compProj}}) RETURN f.path AS path, n.name AS name, 'Component' AS kind LIMIT 5`;
    const compFallbackQ = `MATCH (n:Component {name: $symbolName}) WHERE 1=1${compProjWhere} OPTIONAL MATCH (f:File)-[:CONTAINS]->(n) WITH coalesce(f.path, '(sin path)') AS path, n.name AS name RETURN path, name, 'Component' AS kind LIMIT 5`;
    const funcQ = `MATCH (n:Function) WHERE n.name = $symbolName${projFilter} RETURN n.path AS path, n.name AS name, n.startLine AS startLine, n.endLine AS endLine, 'Function' AS kind LIMIT 5`;
    const modelQ = `MATCH (n:Model) WHERE n.name = $symbolName${projFilter} RETURN n.path AS path, n.name AS name, 'Model' AS kind LIMIT 5`;
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
      const path = _rv<string>(row, "path");
      const n = _rv<string>(row, "name");
      if (n) results.push(`**Component** \`${n}\` → \`${path ?? "(sin path)"}\``);
    }
    for (const row of asObjRows(funcRes.data)) {
      const path = _rv<string>(row, "path");
      const n = _rv<string>(row, "name");
      const startLine = _rv<number | null>(row, "startLine");
      const endLine = _rv<number | null>(row, "endLine");
      if (path && n) {
        const lineInfo = startLine != null && endLine != null ? ` (L${startLine}-${endLine})` : "";
        results.push(`**Function** \`${n}\` → \`${path}\`${lineInfo}`);
      }
    }
    for (const row of (modelRes.data ?? [])) {
      const path = _rv<string>(row, "path");
      const n = _rv<string>(row, "name");
      if (path && n) results.push(`**Model** \`${n}\` → \`${path}\``);
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
      projectId = (await inferProjectIdFromPath(graph, currentFilePath)) ?? undefined;
    }
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
      RETURN labels(dep)[0] AS kind, dep.name AS name, dep.path AS path`;
    const refsRes = (await graph.query(refsQ, { params })) as { data?: unknown[][] };
    const data = (refsRes.data ?? []);
    const seen = new Set<string>();
    const lines = [`## Referencias: ${symbolName}`, ""];
    for (const row of data) {
      const kind = _rv<string>(row, "kind");
      const depName = _rv<string>(row, "name");
      const path = _rv<string | null>(row, "path");
      const key = `${kind}:${depName}:${path ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const pathStr = path ? ` — \`${path}\`` : "";
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
      projectId = (await inferProjectIdFromPath(graph, currentFilePath)) ?? undefined;
    }
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
    const funcQ = `MATCH (f:Function) WHERE f.name = $symbolName${projectId ? " AND f.projectId = $projectId" : ""} RETURN f.path AS path, f.description AS description, f.startLine AS startLine, f.endLine AS endLine, f.complexity AS complexity, f.endpointCalls AS endpointCalls LIMIT 3`;
    const [propsRes, descRes, funcRes] = await Promise.all([
      graph.query(propsQ, { params }) as Promise<{ data?: unknown[][] }>,
      graph.query(descQ, { params }) as Promise<{ data?: unknown[][] }>,
      graph.query(funcQ, { params }) as Promise<{ data?: unknown[][] }>,
    ]);
    const lines = [`## Implementación: ${symbolName}`, ""];
    const descRows = asObjRows(descRes.data);
    const descRow = descRows[0];
    if (descRow && _rv<string>(descRow, "description")) lines.push(`**Descripción:** ${String(_rv(descRow, "description")).slice(0, 200)}`, "");
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
        if (description) lines.push(`  ${String(description).slice(0, 80)}`);
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
      resolvedProjectId = (await inferProjectIdFromPath(graph, currentFilePath)) ?? "";
    }
    if (!resolvedProjectId) {
      return {
        content: [{ type: "text", text: "**Error:** Se requiere projectId o currentFilePath." }],
        isError: true,
      };
    }
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
    const uncalledFuncsQ = `MATCH (fn:Function {projectId: $projectId}) WHERE NOT (fn)<-[:CALLS]-() RETURN fn.name AS name, fn.path AS path LIMIT 50`;
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
      ...(unreachableComps.length ? unreachableComps.map((c) => `- ${c}`).slice(0, 30) : ["(ninguno)"]),
      "",
      "**Funciones sin referencias:** (muestra)",
      ...(unreachableFuncs.length ? unreachableFuncs.slice(0, 20).map((f) => `- ${f}`) : ["(ninguna detectada)"]),
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
      resolvedProjectId = (await inferProjectIdFromPath(graph, currentFilePath)) ?? "";
    }
    if (!resolvedProjectId) {
      return {
        content: [{ type: "text", text: "**Error:** Se requiere projectId." }],
        isError: true,
      };
    }
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
      ...(unused.length ? unused.slice(0, 25).map((u) => `- ${u}`) : ["No se detectaron exports obvios sin uso."]),
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
      projectId = (await inferProjectIdFromPath(graph, currentFilePath)) ?? undefined;
    }
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
      ...(affectedNodes.length ? [...new Set(affectedNodes)].map((n) => `- ${n}`).slice(0, 40) : ["(ninguno)"]),
      "",
      "**Archivos afectados:**",
      ...(affectedFiles.size ? [...affectedFiles].map((f) => `- ${f}`).slice(0, 20) : ["(ninguno)"]),
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
      projectId = (await inferProjectIdFromPath(graph, currentFilePath)) ?? undefined;
    }
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
    const limit = Math.min(30, Math.max(1, (args?.limit as number) ?? 10));
    const currentFilePath = args?.currentFilePath as string | undefined;
    let resolvedProjectId = projectId;
    if (!resolvedProjectId && currentFilePath) {
      resolvedProjectId = (await inferProjectIdFromPath(graph, currentFilePath)) ?? undefined;
    }
    if (!query.trim()) {
      return {
        content: [{ type: "text", text: "**Error:** Se requiere `query`." }],
        isError: true,
      };
    }
    const ingestUrl = process.env.INGEST_URL ?? process.env.FALKORSPEC_INGEST_URL ?? "http://localhost:3002";
    const results: { type: string; name: string; projectId?: string }[] = [];
    let usedVector = false;
    try {
      const embedRes = await fetch(`${ingestUrl.replace(/\/$/, "")}/embed?text=${encodeURIComponent(query)}`);
      if (embedRes.ok) {
        const { embedding } = (await embedRes.json()) as { embedding?: number[] };
        const valid = Array.isArray(embedding) && embedding.every((v) => typeof v === "number" && Number.isFinite(v));
        if (valid && embedding!.length > 0) {
          const vecStr = `[${embedding!.join(",")}]`;
          const k = Math.min(Math.max(limit * 2, 20), 100);
          const funcVecQ = `CALL db.idx.vector.queryNodes('Function', 'embedding', ${k}, vecf32(${vecStr})) YIELD node, score RETURN node.name AS name, node.path AS path, node.projectId AS projectId, score`;
          const compVecQ = `CALL db.idx.vector.queryNodes('Component', 'embedding', ${k}, vecf32(${vecStr})) YIELD node, score RETURN node.name AS name, node.projectId AS projectId, score`;
          try {
            const [fRes, cRes] = await Promise.all([
              graph.query(funcVecQ) as Promise<{ data?: Array<Record<string, unknown>> }>,
              graph.query(compVecQ) as Promise<{ data?: Array<Record<string, unknown>> }>,
            ]);
            const seen = new Set<string>();
            for (const row of (fRes.data ?? [])) {
              const name = _rv<string>(row, "name");
              const path = _rv<string>(row, "path");
              const pid = _rv<string>(row, "projectId");
              if (resolvedProjectId && pid !== resolvedProjectId) continue;
              const key = `Function:${name}:${path}`;
              if (seen.has(key)) continue;
              seen.add(key);
              results.push({ type: "Function", name: path ? `${name ?? ""} — ${path}` : (name ?? ""), projectId: pid });
              if (results.length >= limit) break;
            }
            for (const row of (cRes.data ?? [])) {
              if (results.length >= limit) break;
              const name = _rv<string>(row, "name");
              const pid = _rv<string>(row, "projectId");
              if (resolvedProjectId && pid !== resolvedProjectId) continue;
              const key = `Component:${name}`;
              if (seen.has(key)) continue;
              seen.add(key);
              results.push({ type: "Component", name: name ?? "", projectId: pid });
            }
            usedVector = true;
          } catch { /* vector index may not exist */ }
        }
      }
    } catch { /* embed endpoint may not be configured */ }
    if (!usedVector) {
      const qLower = query.toLowerCase();
      const projFilter = resolvedProjectId ? " WHERE n.projectId = $projectId" : "";
      const compParams = resolvedProjectId ? { params: { projectId: resolvedProjectId } } : {};
      const compQ = `MATCH (n:Component)${projFilter} RETURN n.name AS name LIMIT 100`;
      const funcQ = `MATCH (n:Function)${projFilter} RETURN n.name AS name, n.path AS path LIMIT 100`;
      const [compRes, funcRes] = await Promise.all([
        graph.query(compQ, compParams) as Promise<{ data?: unknown[][] }>,
        graph.query(funcQ, compParams) as Promise<{ data?: unknown[][] }>,
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
      resolvedProjectId = (await inferProjectIdFromPath(graph, currentFilePath)) ?? "";
    }
    if (!resolvedProjectId) {
      return {
        content: [{ type: "text", text: "**Error:** Se requiere projectId o currentFilePath." }],
        isError: true,
      };
    }
    const ingestUrl = process.env.INGEST_URL ?? process.env.FALKORSPEC_INGEST_URL ?? "http://localhost:3002";
    const configPaths = [".prettierrc", ".prettierrc.json", ".prettierrc.js", ".eslintrc", ".eslintrc.json", ".eslintrc.js", ".eslintrc.cjs", "tsconfig.json", "package.json"];
    const lines = ["## Estándares del proyecto", ""];
    for (const configPath of configPaths) {
      try {
        const result = await fetchFileFromIngest(ingestUrl, resolvedProjectId, configPath);
        if ("content" in result && result.content) {
          lines.push(`### ${configPath}`, "```", result.content.slice(0, 1500), "```", "");
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
      projectId = (await inferProjectIdFromPath(graph, currentFilePath)) ?? undefined;
    }
    if (!projectId) {
      return {
        content: [{ type: "text", text: "**Error:** Se requiere projectId o currentFilePath." }],
        isError: true,
      };
    }
    const { graphPath } = await resolveFileForPath(graph, filePathParam, projectId, currentFilePath);
    const ingestUrl = process.env.INGEST_URL ?? process.env.FALKORSPEC_INGEST_URL ?? "http://localhost:3002";
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
      content.slice(0, 4000),
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
      resolvedProjectId = (await inferProjectIdFromPath(graph, (args?.currentFilePath as string) ?? "")) ?? "";
    }
    if (!resolvedProjectId) {
      return {
        content: [{ type: "text", text: "**Error:** Se requiere `projectId` o `currentFilePath` para consultar el grafo. Usa `list_known_projects` para IDs." }],
        isError: true,
      };
    }

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

/** Respuestas JSON para OAuth discovery (Cursor las pide antes de conectar). Sin auth. */
function serveWellKnown(path: string, req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== "GET") return false;

  const baseUrl = process.env.MCP_PUBLIC_URL?.trim() || "https://ariadne.kreoint.mx";
  const mcpUrl = `${baseUrl.replace(/\/$/, "")}${MCP_PATH}`;

  if (path === "/.well-known/oauth-authorization-server" || path === ".well-known/oauth-authorization-server") {
    const authServer = SSO_BASE || "https://apisso.grupowib.com.mx/api/v1";
    const body = JSON.stringify({
      issuer: authServer,
      authorization_endpoint: `${authServer}/auth/sso`,
      token_endpoint: `${authServer}/auth/token`,
      jwks_uri: `${authServer}/auth/jwks`,
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(body);
    return true;
  }

  if (
    path === "/.well-known/oauth-protected-resource/mcp" ||
    path === ".well-known/oauth-protected-resource/mcp" ||
    path === "/.well-known/oauth-protected-resource" ||
    path === ".well-known/oauth-protected-resource"
  ) {
    const authServer = SSO_BASE ? `${SSO_BASE}/auth/validate` : null;
    const body = JSON.stringify({
      resource: mcpUrl,
      authorization_servers: authServer ? [{ uri: SSO_BASE }] : [],
    });
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

  const authError = await validateAuth(req);
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
  const useSSO = !!SSO_BASE && !!APPLICATION_ID;
  const authEnabled = !!process.env.MCP_AUTH_TOKEN?.trim();
  const authMode = useSSO ? "SSO (M2M)" : authEnabled ? "static (Bearer)" : "disabled";
  console.log("[FalkorSpecs MCP] Starting Streamable HTTP server (stateless)...");
  console.log(`[MCP] Port: ${port}, Path: ${MCP_PATH}, Auth: ${authMode}`);
  if (useSSO) console.log(`[MCP] SSO validate: ${SSO_BASE}/auth/validate`);

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
    console.log(`[FalkorSpecs MCP] HTTP server listening on 0.0.0.0:${port}${MCP_PATH}`);
  });

  httpServer.on("error", (err) => {
    console.error("[FalkorSpecs MCP] Server error:", err);
    process.exit(1);
  });

  process.on("SIGTERM", () => {
    console.log("[FalkorSpecs MCP] SIGTERM received, closing...");
    closeFalkor();
    httpServer.close(() => process.exit(0));
  });

  process.on("SIGINT", () => {
    console.log("[FalkorSpecs MCP] SIGINT received, closing...");
    closeFalkor();
    httpServer.close(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error("[FalkorSpecs MCP] Fatal error:", err);
  process.exit(1);
});
