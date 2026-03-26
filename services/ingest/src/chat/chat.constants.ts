/**
 * Constantes y configuración del chat NL→Cypher (schema, ejemplos, límites, tools).
 */

export const SCHEMA = `
Grafo FalkorDB (Cypher). Nodos:
- File {path, projectId}
- Component {name, projectId}
- Function {path, name, projectId, complexity, nestingDepth, loc, description}
- Route {path, projectId, componentName}
- Hook {name, projectId}
- DomainConcept {name, projectId, category, sourcePath, options?, description?} — conceptos de dominio (tipos, opciones de enums/constantes)
- NestController, NestService, NestModule {path, name, projectId}

Relaciones: (File)-[:CONTAINS]->(Component|Function|...), (File)-[:IMPORTS]->(File), (Component)-[:RENDERS]->(Component), (Component)-[:USES_HOOK]->(Hook), (DomainConcept)-[:DEFINED_IN]->(File)

IMPORTANTE: Toda consulta debe filtrar con projectId = $projectId. FalkorDB NO tiene toLower: usa CONTAINS con la palabra exacta o prueba variantes (Login, login).
`;

export const EXAMPLES = `
Ejemplos que funcionan:

Pregunta: "archivos que contienen login"
\`\`\`cypher
MATCH (f:File) WHERE f.projectId = $projectId AND (f.path CONTAINS 'login' OR f.path CONTAINS 'Login') RETURN f.path as path
\`\`\`

Pregunta: "componentes y archivos relacionados con login"
\`\`\`cypher
MATCH (f:File)-[:CONTAINS]->(c:Component) WHERE f.projectId = $projectId AND c.projectId = $projectId AND (c.name CONTAINS 'login' OR c.name CONTAINS 'Login' OR f.path CONTAINS 'login' OR f.path CONTAINS 'Login') RETURN f.path as file, c.name as component
\`\`\`

Pregunta: "rutas que tengan auth"
\`\`\`cypher
MATCH (r:Route) WHERE r.projectId = $projectId AND (r.path CONTAINS 'auth' OR r.componentName CONTAINS 'auth') RETURN r.path, r.componentName
\`\`\`

Pregunta: "llamadas a endpoints" / "funciones que hacen fetch o request" / "cómo se llaman al back"
\`\`\`cypher
MATCH (fn:Function) WHERE fn.projectId = $projectId AND (fn.name CONTAINS 'fetch' OR fn.name CONTAINS 'get' OR fn.name CONTAINS 'post' OR fn.name CONTAINS 'put' OR fn.name CONTAINS 'request' OR fn.name CONTAINS 'call' OR fn.name CONTAINS 'api' OR fn.path CONTAINS 'api') RETURN fn.path as path, fn.name as name, fn.description as description ORDER BY fn.path, fn.name
\`\`\`

Pregunta: "utilidades comunes" o "funciones para extraer a biblioteca compartida"
\`\`\`cypher
MATCH (caller:Function)-[:CALLS]->(fn:Function) WHERE fn.projectId = $projectId AND caller.projectId = $projectId
WITH fn.path as path, fn.name as name, collect(DISTINCT caller.path) as llamadores
WHERE size(llamadores) > 1
RETURN path, name, size(llamadores) as usos ORDER BY usos DESC
\`\`\`

Pregunta: "funciones no utilizadas" / "dead code" / "auditoría para eliminar código muerto"
\`\`\`cypher
MATCH (fn:Function) WHERE fn.projectId = $projectId
OPTIONAL MATCH (caller)-[:CALLS]->(fn)
WITH fn, count(caller) as callCount
WHERE callCount = 0
RETURN fn.path as path, fn.name as name ORDER BY fn.path
\`\`\`

Pregunta: "componentes que no se renderizan desde ningún otro"
\`\`\`cypher
MATCH (c:Component) WHERE c.projectId = $projectId
OPTIONAL MATCH (parent)-[:RENDERS]->(c)
WITH c, count(parent) as parentCount
WHERE parentCount = 0
RETURN c.name as name
\`\`\`

Pregunta: "reporte detallado de componentes y funciones que no se utilizan" / "listado de código muerto" / "todos los no usados"
→ Ejecutar AMBAS consultas (1) funciones no llamadas: OPTIONAL MATCH (caller)-[:CALLS]->(fn) WHERE count=0; (2) componentes no renderizados: OPTIONAL MATCH (parent)-[:RENDERS]->(c) WHERE count=0. NO usar CONTAINS con nombres concretos. Devolver TODOS los resultados (sin LIMIT).

Pregunta: "funciones con alto acoplamiento" o "complejidad en funciones"
\`\`\`cypher
MATCH (a:Function)-[:CALLS]->(b:Function) WHERE a.projectId = $projectId AND b.projectId = $projectId
WITH a, count(b) as outCalls WHERE outCalls > 5
RETURN a.path as path, a.name as name, outCalls ORDER BY outCalls DESC
\`\`\`

Pregunta: "componentes con muchas props" o "componentes complejos"
\`\`\`cypher
MATCH (c:Component)-[:HAS_PROP]->(p:Prop) WHERE c.projectId = $projectId
WITH c, count(p) as propCount WHERE propCount > 5
RETURN c.name as component, propCount ORDER BY propCount DESC
\`\`\`

Pregunta: "código spaguetti" o "funciones con mucho anidamiento"
\`\`\`cypher
MATCH (fn:Function) WHERE fn.projectId = $projectId AND fn.nestingDepth > 4
RETURN fn.path as path, fn.name as name, fn.nestingDepth as nestingDepth, fn.complexity as complexity ORDER BY fn.nestingDepth DESC
\`\`\`

Pregunta: "cómo es el proceso de consulta a falkor", "cómo se conecta al grafo", "flujo de FalkorDB"
\`\`\`cypher
MATCH (fn:Function) WHERE fn.projectId = $projectId AND (fn.name CONTAINS 'falkor' OR fn.name CONTAINS 'Falkor' OR fn.path CONTAINS 'falkor' OR fn.path CONTAINS 'Falkor' OR fn.description CONTAINS 'falkor')
RETURN fn.path as path, fn.name as name, fn.description as description ORDER BY fn.path, fn.name
\`\`\`
(Tras obtener paths: get_file_content OBLIGATORIO para explicar el flujo.)

Pregunta: "cálculos del cotizador", "algoritmo de precios", "resumir lógica de X"
\`\`\`cypher
MATCH (fn:Function) WHERE fn.projectId = $projectId
AND (fn.name CONTAINS 'cotizador' OR fn.description CONTAINS 'cotizador' OR fn.path CONTAINS 'cotizador' OR fn.path CONTAINS 'Cotizador'
  OR fn.name CONTAINS 'precio' OR fn.name CONTAINS 'Precio' OR fn.name CONTAINS 'bonus' OR fn.name CONTAINS 'Bonus'
  OR fn.name CONTAINS 'actualizar' OR fn.name CONTAINS 'Actualizar' OR fn.name CONTAINS 'calcular' OR fn.name CONTAINS 'Calcular')
RETURN fn.path as path, fn.name as name, fn.description as description ORDER BY fn.path, fn.name
\`\`\`

Pregunta: "qué tipos de cotizaciones", "qué opciones en el cotizador" — PREFIERE DomainConcept:
\`\`\`cypher
MATCH (dc:DomainConcept) WHERE dc.projectId = $projectId
RETURN dc.name as name, dc.category as category, dc.options as options, dc.sourcePath as sourcePath
ORDER BY dc.category, dc.name
\`\`\`
(Alternativa si DomainConcept devuelve poco: buscar Functions con cotizador/cotizacion/renta/bonus, NO solo 'tipo'. Tras obtener paths: get_file_content OBLIGATORIO.)

Pregunta: "¿archivo A importa a B?", "¿A importa B pero lo usa?"
\`\`\`cypher
MATCH (a:File)-[:IMPORTS]->(b:File) WHERE a.projectId = $projectId AND b.projectId = $projectId
AND a.path = $pathA AND b.path = $pathB
RETURN a.path as fromPath, b.path as toPath
\`\`\`
(Usa IMPORTS entre File, NO CONTAINS/Component. Para "lo usa" consulta CALLS entre Function si aplica.)

Pregunta: "tablas de base de datos", "esquema BD", "modelos de datos", "entidades", "schema"
→ OPCION A (Prisma): execute_cypher nodos Model/Enum (m.source = 'prisma') y get_file_content del schema si hace falta el texto.
→ OPCION B (TypeORM/u otro ORM): execute_cypher MATCH (m:Model) RETURN m.path; luego get_file_content en cada path.
→ OPCION C (monorepo): probar apps/api/prisma/schema.prisma, libs/db/prisma/schema.prisma, libs/*/entity*.ts, **/entities/*.ts

Pregunta: "rutas de API", "endpoints", "listado de rutas REST"
\`\`\`cypher
MATCH (nc:NestController) WHERE nc.projectId = $projectId RETURN nc.path as path, nc.name as name
\`\`\`
(O también Route para frontend. NestController tiene .route en propiedades; get_file_content en path para ver decoradores @Get, @Post.)

Pregunta: "variables de entorno", "configuración env", "qué env vars usa"
→ get_file_content en: .env.example, env.example, .env.sample, apps/*/.env.example. No están en el grafo.

IMPORTANTE: NO uses LIMIT. Devolver todos los resultados evita perder conocimiento. FalkorDB no soporta NOT EXISTS; usa OPTIONAL MATCH + count(x)=0 para "no usados".

<fin_ejemplos>
--- Edge cases ---
Pregunta: "no encuentro nada sobre xyz inexistente" / "busco componente Quijote" (no existe en grafo)
\`\`\`cypher
MATCH (c:Component) WHERE c.projectId = $projectId AND (c.name CONTAINS 'Quijote' OR c.name CONTAINS 'xyz') RETURN c.name LIMIT 5
\`\`\`
(Si devuelve []; responde: "No encontré resultados. Verifica el término o reindexa.")

Pregunta mal formada / ambigua ("dame todo" sin contexto)
→ Primero get_graph_summary o execute_cypher con criterio amplio; si no hay contexto de dominio, pide al usuario especificar.
</fin_ejemplos>
`;

/** Nombres de funciones genéricas (event handlers, lifecycle) que se omiten del análisis de duplicados. */
export const GENERIC_FUNCTION_NAMES = new Set([
  'onsubmit', 'onreset', 'onchange', 'onclick', 'onblur', 'onfocus', 'onkeydown', 'onkeyup', 'onkeypress',
  'oninput', 'onmousedown', 'onmouseup', 'onmouseover', 'onmouseout', 'onscroll', 'onload', 'onerror',
  'handlesubmit', 'handlechange', 'handleclick', 'handleblur', 'handlefocus', 'handlekeydown', 'handleinput',
  'componentdidmount', 'componentdidupdate', 'componentwillunmount', 'getderivedstatefromprops', 'shouldcomponentupdate',
  'render', 'constructor', 'getdefaultprops', 'defaultprops', 'onItemClick', 'onItemChange', 'onItemSelect', 'onItemDeselect',
  'onItemHover', 'onItemLeave', 'onItemEnter', 'onItemFocus', 'onItemBlur', 'onItemScroll', 'onItemScrollEnd', 'onItemScrollStart',
  'onItemScrollEnd', 'onItemScrollStart', 'onItemScrollEnd', 'onItemScrollStart', 'onItemScrollEnd', 'onItemScrollStart',
]);

export const MAX_RISK_ITEMS = 120;
export const MAX_HIGH_COUPLING = 40;
export const MAX_NO_DESC = 100;
export const MAX_COMPONENT_PROPS = 30;
export const MAX_DUPLICATES = 50;
export const MAX_ANTIPATTERN_ITEMS = 40;
export const MAX_SUMMARY_CHARS = 4000;

export const SEARCH_SYNONYMS: Record<string, string[]> = {
  login: ['auth', 'signin', 'sign-in', 'signin', 'autenticacion', 'authentication'],
  auth: ['login', 'signin', 'autenticacion'],
  signin: ['login', 'auth', 'sign-in'],
  ingesta: ['ingest', 'sync', 'indexacion'],
  ingest: ['ingesta', 'sync'],
  sync: ['ingest', 'ingesta'],
};

export const FULL_AUDIT_SECRET_PATTERNS: Array<{ pattern: RegExp; severity: string }> = [
  { pattern: /(?:api[_-]?key|apikey|api_key)\s*=\s*['"`][^'"`]+['"`]/gi, severity: 'critica' },
  { pattern: /(?:password|passwd|pwd)\s*[=:]\s*['"`][^'"`]+['"`]/gi, severity: 'critica' },
  { pattern: /(?:secret|token)\s*[=:]\s*['"`][^'"`]{8,}['"`]/gi, severity: 'alta' },
  { pattern: /Bearer\s+[A-Za-z0-9_-]{20,}/g, severity: 'alta' },
  { pattern: /(?:private[_-]?key|privatekey).*['"`]/gi, severity: 'critica' },
  { pattern: /\.env\.\w+\s*[=:]/gi, severity: 'media' },
];

/** Tools para Explorer ReAct — CodeAnalysis: todas; Knowledge: sin get_graph_summary (Task-Level Scoping). */
export const EXPLORER_TOOLS_ALL = [
  {
    type: 'function',
    function: {
      name: 'execute_cypher',
      description: 'Ejecuta una consulta Cypher en el grafo del proyecto. Usa para buscar archivos, componentes, funciones, rutas, dependencias.',
      parameters: {
        type: 'object',
        properties: {
          cypher: {
            type: 'string',
            description: 'Consulta Cypher. DEBE incluir projectId = $projectId en el WHERE. NO usar LIMIT.',
          },
        },
        required: ['cypher'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'semantic_search',
      description: 'Búsqueda semántica por significado (ideal para "utilidades de X", "código que hace Y"). Requiere embed-index.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Pregunta o términos de búsqueda semántica' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_graph_summary',
      description: 'Obtiene conteos y muestras de nodos indexados (File, Component, Function, Route). Útil para saber qué hay antes de buscar.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_file_content',
      description: 'Lee el contenido de un archivo del repo. OBLIGATORIO para: tipos/opciones, algoritmo, cálculos. Esquema BD: Prisma → prisma/schema.prisma; TypeORM → execute_cypher MATCH (m:Model) para path. Rutas API: NestController/Route. Env: .env.example.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path del archivo (relativo al repo). Para Prisma: prisma/schema.prisma. Para TypeORM: path de nodo Model.' },
        },
        required: ['path'],
      },
    },
  },
];

/** Subset para Knowledge: get_file_content obligatorio, sin get_graph_summary. */
export function getExplorerToolsKnowledge(): typeof EXPLORER_TOOLS_ALL {
  return EXPLORER_TOOLS_ALL.filter(
    (t) => (t as { function?: { name?: string } }).function?.name !== 'get_graph_summary',
  );
}

/** Trunca antipatterns para caber en contexto. */
export function truncateAntipatterns(ap: {
  spaghetti?: unknown[];
  godFunctions?: unknown[];
  highFanIn?: unknown[];
  circularImports?: unknown[];
  overloadedComponents?: unknown[];
}) {
  return {
    spaghetti: (ap?.spaghetti ?? []).slice(0, MAX_ANTIPATTERN_ITEMS),
    godFunctions: (ap?.godFunctions ?? []).slice(0, MAX_ANTIPATTERN_ITEMS),
    highFanIn: (ap?.highFanIn ?? []).slice(0, MAX_ANTIPATTERN_ITEMS),
    circularImports: (ap?.circularImports ?? []).slice(0, MAX_ANTIPATTERN_ITEMS),
    overloadedComponents: (ap?.overloadedComponents ?? []).slice(0, MAX_ANTIPATTERN_ITEMS),
  };
}
