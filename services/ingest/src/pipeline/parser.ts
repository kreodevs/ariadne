/**
 * Parser Tree-sitter para JS/JSX/TS/TSX (ingest).
 * Extrae imports, componentes, props, hooks, rutas, funciones (con complexity y nestingDepth), llamadas.
 * domainConcepts se rellenan solo si se inyecta extractDomainConcepts en las opciones (ver ParseSourceOptions).
 * Contrato: el servicio cartographer tiene su propio parser "light" (sin domain, sin routes) para indexación;
 * no comparten código; este es el parser completo para ingest/sync/webhooks.
 * @module pipeline/parser
 */

import Parser from 'tree-sitter';
import type { DomainConceptInfo } from './domain-types';
import type { DomainConfig } from './domain-types';
import JavaScript from 'tree-sitter-javascript';
import TypeScript from 'tree-sitter-typescript';

const ts = TypeScript as unknown as { typescript: unknown; tsx: unknown };
const LANG_JS = JavaScript as unknown;
const LANG_TSX = ts.tsx;
const LANG_TS = ts.typescript;

export interface ImportInfo {
  specifier: string;
  isDefault: boolean;
  /** Local names brought into scope (default import name, or named import names). */
  localNames: string[];
}

export interface ComponentInfo {
  name: string;
  type: 'Class' | 'Functional';
  isLegacy: boolean;
  /** JSDoc/TSDoc description si existe */
  description?: string;
}

export interface HookUsage {
  name: string;
  line?: number;
}

/** React context creado con createContext (const X = createContext(...)). */
export interface ContextInfo {
  name: string;
  line?: number;
}

export interface RendersUsage {
  componentName: string;
  line?: number;
}

export interface PropInfo {
  name: string;
  required: boolean;
}

export interface FunctionInfo {
  name: string;
  /** 1-based line range for semantic chunking */
  lineRange?: { start: number; end: number };
  /** JSDoc/TSDoc description si existe */
  description?: string;
  /** McCabe cyclomatic complexity (1 + decision points) */
  complexity?: number;
  /** Max nesting depth (blocks, if/for/while bodies). >4 = código spaguetti. */
  nestingDepth?: number;
  /** Llamadas a endpoints (fetch, axios, api) detectadas en el cuerpo */
  endpointCalls?: EndpointCallInfo[];
}

export interface CallInfo {
  caller: string;
  callee: string;
}

/** Call from caller in this file to a name that might be in another file (unresolved). */
export interface UnresolvedCallInfo {
  caller: string;
  calleeLocalName: string;
}

/** Resolved cross-file call (after matching imports + exports). */
export interface ResolvedCallInfo {
  callerPath: string;
  callerName: string;
  calleePath: string;
  calleeName: string;
}

/** NestJS @Module() class. */
export interface NestModuleInfo {
  name: string;
  /** Class names declared in controllers: []. */
  controllers: string[];
  /** Class names declared in providers: []. */
  providers: string[];
}

/** NestJS @Controller() class. */
export interface NestControllerInfo {
  name: string;
  /** Route prefix from @Controller('path') if present. */
  route?: string;
}

/** NestJS @Injectable() / service class. */
export interface NestServiceInfo {
  name: string;
}

/** Strapi v4 content-type (schema file). */
export interface StrapiContentTypeInfo {
  name: string;
}

/** Strapi v4 API controller. */
export interface StrapiControllerInfo {
  name: string;
  apiName?: string;
}

/** Strapi v4 API service. */
export interface StrapiServiceInfo {
  name: string;
  apiName?: string;
}

/** React Router Route: path -> component. Para flujos de UI en manuales. */
export interface RouteInfo {
  path: string;
  componentName: string;
}

/** Modelo de datos (clase con propiedades, sin JSX). */
export interface ModelInfo {
  name: string;
  /** JSDoc/TSDoc si existe */
  description?: string;
}

/** Concepto de dominio (tipos, opciones). Definido en domain-types. */
export type { DomainConceptInfo } from './domain-types';

/** Llamada a endpoint (fetch, axios, api). */
export interface EndpointCallInfo {
  method: string;
  line: number;
}

export interface ParsedFile {
  path: string;
  imports: ImportInfo[];
  components: ComponentInfo[];
  hooksUsed: HookUsage[];
  /** Custom hooks definidos en este archivo (const useX = ... o function useX(...)). */
  hooksDefined: HookUsage[];
  /** Contextos React (const X = createContext(...)). */
  contexts: ContextInfo[];
  renders: RendersUsage[];
  propsByComponent: Record<string, PropInfo[]>;
  functions: FunctionInfo[];
  calls: CallInfo[];
  /** Calls where callee is an identifier not defined in this file (candidate for cross-file). */
  unresolvedCalls: UnresolvedCallInfo[];
  /** NestJS modules (path + name + declared controllers/providers). */
  nestModules: NestModuleInfo[];
  /** NestJS controllers. */
  nestControllers: NestControllerInfo[];
  /** NestJS services (Injectable). */
  nestServices: NestServiceInfo[];
  /** Strapi v4 (detected by path pattern). */
  strapiContentTypes: StrapiContentTypeInfo[];
  strapiControllers: StrapiControllerInfo[];
  strapiServices: StrapiServiceInfo[];
  /** React Router Route definitions (path -> component). */
  routes: RouteInfo[];
  /** Modelos de datos (clases sin JSX, path Models/, nombre *Model). */
  models: ModelInfo[];
  /** Conceptos de dominio (tipos, opciones) extraídos heurísticamente. */
  domainConcepts: DomainConceptInfo[];
}

/** Devuelve el lenguaje Tree-sitter según la extensión del archivo. */
function getLanguageForPath(path: string): unknown {
  const ext = path.slice(path.lastIndexOf('.'));
  if (ext === '.tsx' || ext === '.jsx') return LANG_TSX;
  if (ext === '.ts') return LANG_TS;
  return LANG_JS;
}

/** Obtiene el texto del nodo en el source. */
function getNodeText(src: string, node: Parser.SyntaxNode): string {
  return src.slice(node.startIndex, node.endIndex);
}

/**
 * Extrae el JSDoc/TSDoc inmediatamente anterior al nodo.
 * Incluye: descripción principal, @param (nombre, tipo, desc), @returns.
 * Todo concatenado en un solo string para búsqueda semántica y embeddings.
 */
function getPrecedingJSDoc(source: string, nodeStartIndex: number): string | undefined {
  const before = source.slice(0, nodeStartIndex).trimEnd();
  const matches = before.match(/\/\*\*[\s\S]*?\*\//g);
  if (!matches || matches.length === 0) return undefined;
  const last = matches[matches.length - 1];
  const endOfComment = before.lastIndexOf('*/') + 2;
  const between = before.slice(endOfComment).trim();
  if (between && !/^[\s\n\r]*$/.test(between)) return undefined;

  const raw = last.slice(3, -2).replace(/^\s*\*\s?/gm, ' ').replace(/\s+/g, ' ').trim();
  const parts: string[] = [];

  // Descripción principal (texto antes del primer @)
  const mainMatch = raw.match(/^([^@]+?)(?=\s*@|$)/);
  const mainDesc = mainMatch ? mainMatch[1].trim() : '';
  if (mainDesc) parts.push(mainDesc);

  // @param {Type} name - desc o @param name - desc
  const paramRe = /@param\s+(?:\{([^}]*)\}\s+)?(\w+)\s*-?\s*([^@]*?)(?=\s*@|$)/g;
  const params: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = paramRe.exec(raw)) !== null) {
    const type = m[1]?.trim();
    const name = m[2];
    const desc = m[3].trim();
    params.push(type ? `${name} (${type}): ${desc}` : desc ? `${name}: ${desc}` : name);
  }
  if (params.length) parts.push(`Params: ${params.join('. ')}`);

  // @returns {Type} - desc o @returns - desc
  const returnsMatch = raw.match(/@returns?\s+(?:\{([^}]*)\}\s+)?-?\s*([^@]*?)(?=\s*@|$)/);
  if (returnsMatch) {
    const type = returnsMatch[1]?.trim();
    const desc = returnsMatch[2].trim();
    if (type) parts.push(desc ? `Returns (${type}): ${desc}` : `Returns: ${type}`);
    else if (desc) parts.push(`Returns: ${desc}`);
  }

  // @throws {Type} - desc
  const throwsMatch = raw.match(/@throws?\s+(?:\{([^}]*)\}\s+)?-?\s*([^@]*?)(?=\s*@|$)/);
  if (throwsMatch) {
    const desc = throwsMatch[2].trim() || throwsMatch[1]?.trim();
    if (desc) parts.push(`Throws: ${desc}`);
  }

  return parts.length ? parts.join(' ') : undefined;
}

function isPascalCase(s: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*$/.test(s) && s.length > 0;
}

function isReactComponentName(name: string): boolean {
  return isPascalCase(name) && name !== 'React';
}

/** Incluye Context.Provider y patrones Foo.Bar de JSX. */
function isJsxComponentTag(name: string): boolean {
  if (isReactComponentName(name)) return true;
  return /^[A-Z][a-zA-Z0-9]*\.[A-Z][a-zA-Z0-9]*$/.test(name); // PautaContext.Provider
}

/** Extrae el identificador cuando el nombre trae type annotation (const X: Type = ...). */
function extractIdentifierFromDeclName(name: string): string {
  if (!name || typeof name !== 'string') return '';
  const idx = name.indexOf(':');
  if (idx > 0) return name.slice(0, idx).trim();
  return name.trim();
}

/** Verifica si el nodo tiene un ancestro export_statement (export default). */
function hasExportDefaultAncestor(node: Parser.SyntaxNode): boolean {
  let n: Parser.SyntaxNode | null = node;
  while (n) {
    if (n.type === 'export_statement' || n.type === 'export_default_declaration') return true;
    n = n.parent;
  }
  return false;
}

/** Infiere nombre de componente desde path (ej. Folder/Component.tsx → Component, folder/index.jsx → Folder). */
function inferComponentNameFromPath(filePath: string): string | null {
  const norm = filePath.replace(/\\/g, '/');
  const base = norm.split('/').pop() ?? '';
  const withoutExt = base.replace(/\.(tsx?|jsx?)$/, '');
  if (withoutExt === 'index') {
    const folder = norm.split('/').slice(-2)[0];
    return folder ? folder.charAt(0).toUpperCase() + folder.slice(1) : null;
  }
  return withoutExt.charAt(0).toUpperCase() + withoutExt.slice(1);
}

/** Clase PascalCase sin JSX ni React.Component → modelo de datos. */
function isDataModelClass(name: string, filePath: string, hasJsx: boolean, extendsReact: boolean): boolean {
  if (extendsReact) return false;
  const normPath = filePath.replace(/\\/g, '/').toLowerCase();
  if (name.endsWith('Model') || normPath.includes('/models/')) return true;
  if (!hasJsx) return true;
  return false;
}

function findNodesByType(
  node: Parser.SyntaxNode,
  types: string | string[],
): Parser.SyntaxNode[] {
  const set = Array.isArray(types) ? new Set(types) : new Set([types]);
  const out: Parser.SyntaxNode[] = [];
  function walk(n: Parser.SyntaxNode) {
    if (set.has(n.type)) out.push(n);
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) walk(c);
    }
  }
  walk(node);
  return out;
}

/** Strapi v4: detect by path pattern (api/content-types, api/controllers, api/services). */
function collectStrapiFromPath(path: string, result: ParsedFile): void {
  const norm = path.replace(/\\/g, '/');
  const contentTypesMatch = norm.match(/\/api\/([^/]+)\/content-types\/([^/]+)\/schema\.(json|ts|js)$/);
  if (contentTypesMatch) {
    result.strapiContentTypes.push({ name: contentTypesMatch[2] });
    return;
  }
  const controllersMatch = norm.match(/\/api\/([^/]+)\/controllers\/([^/]+)\.(ts|js)$/);
  if (controllersMatch) {
    result.strapiControllers.push({
      name: controllersMatch[2],
      apiName: controllersMatch[1],
    });
    return;
  }
  const servicesMatch = norm.match(/\/api\/([^/]+)\/services\/([^/]+)\.(ts|js)$/);
  if (servicesMatch) {
    result.strapiServices.push({
      name: servicesMatch[2],
      apiName: servicesMatch[1],
    });
  }
}

/** Función inyectable para extraer conceptos de dominio (evita acoplar parser a domain-extract). */
export type ExtractDomainConceptsFn = (
  parsed: ParsedFile,
  source: string,
  root: Parser.SyntaxNode,
  config?: DomainConfig | null,
) => DomainConceptInfo[];

export interface ParseSourceOptions {
  domainConfig?: DomainConfig | null;
  /** Para primera ingesta: retorna AST sin domain extract (inferir config luego). */
  returnAst?: boolean;
  /** Si se proporciona, se usa para rellenar result.domainConcepts; si no, queda []. */
  extractDomainConcepts?: ExtractDomainConceptsFn;
}

/** Límite aproximado: tree-sitter falla con "Invalid argument" cuando hay ~3300+ sentencias hermanas. */
const TRUNCATE_PARSE_MAX_BYTES = 25_000;

/**
 * Fallback para archivos que fallan por "Invalid argument" (tamaño o muchos nodos hermanos, ej. SVG inline).
 * Parsear solo el inicio para extraer imports y componentes.
 */
function tryParseTruncated(
  path: string,
  source: string,
  parser: Parser,
  lang: Parameters<Parser['setLanguage']>[0],
): ParsedFile | null {
  let tr = source.slice(0, TRUNCATE_PARSE_MAX_BYTES);
  const atLine = tr.lastIndexOf('\n');
  if (atLine > TRUNCATE_PARSE_MAX_BYTES * 0.6) tr = tr.slice(0, atLine + 1);
  const open = (tr.match(/\{/g) || []).length;
  const close = (tr.match(/\}/g) || []).length;
  tr += '\n' + '}'.repeat(Math.max(0, open - close)) + '\nexport default _;';
  try {
    parser.setLanguage(lang);
    const tree = parser.parse(tr);
    if (!tree) return null;
    const root = tree.rootNode;
    const result: ParsedFile = {
      path,
      imports: [],
      components: [],
      hooksUsed: [],
      hooksDefined: [],
      contexts: [],
      renders: [],
      propsByComponent: {},
      functions: [],
      calls: [],
      unresolvedCalls: [],
      nestModules: [],
      nestControllers: [],
      nestServices: [],
      strapiContentTypes: [],
      strapiControllers: [],
      strapiServices: [],
      routes: [],
      models: [],
      domainConcepts: [],
    };
    for (const node of findNodesByType(root, ['import_statement', 'import_declaration'])) {
      const specifierNode = node.childForFieldName('source') ?? node.childForFieldName('module_specifier');
      if (!specifierNode) continue;
      const specifier = getNodeText(tr, specifierNode).replace(/^['"]|['"]$/g, '');
      const isDefault = !!node.childForFieldName('default');
      const localNames = collectImportLocalNames(node, tr);
      result.imports.push({ specifier, isDefault, localNames });
    }
    const hasJsx =
      findNodesByType(root, 'jsx_element').length > 0 ||
      findNodesByType(root, 'jsx_self_closing_element').length > 0;
    const componentNames = new Set<string>();
    for (const node of findNodesByType(root, ['function_declaration', 'arrow_function'])) {
      let name: string | null = null;
      if (node.type === 'function_declaration') {
        const nn = node.childForFieldName('name');
        if (nn) name = getNodeText(tr, nn);
      } else {
        const parent = node.parent;
        if (parent?.type === 'variable_declarator') {
          const decl = parent.childForFieldName('name');
          if (decl) name = extractIdentifierFromDeclName(getNodeText(tr, decl));
        }
      }
      if (name && isReactComponentName(name) && hasJsx && !componentNames.has(name)) {
        componentNames.add(name);
        result.components.push({ name, type: 'Functional', isLegacy: false });
      }
    }
    const inferred = inferComponentNameFromPath(path);
    if (inferred && isReactComponentName(inferred) && !componentNames.has(inferred)) {
      result.components.push({ name: inferred, type: 'Functional', isLegacy: false });
    }
    collectContextsAndDefinedHooks(root, tr, result);
    collectFunctionsAndCalls(root, tr, result);
    console.warn(`[parser] Truncated parse OK for ${path} (${result.components.length} components, ${result.functions.length} functions)`);
    return result;
  } catch {
    return null;
  }
}

/**
 * Parsea un archivo y extrae su estructura (imports, componentes, funciones, rutas, modelos, dominio).
 * Flujo: Tree-sitter → imports/export-from → clases (Nest/Strapi/React/Model) → funciones y CALLS → hooks/renders/props → rutas → domainConcepts.
 * @param path - Ruta del archivo (para inferir lenguaje y Strapi)
 * @param source - Código fuente
 * @param opts - domainConfig por proyecto; returnAst para primera ingesta (sin domain extract)
 * @returns ParsedFile, o { parsed, root, source } si returnAst
 * @riskScore 163 — Alta complejidad; muchas ramas y ~13 llamadas internas. Modificar con tests (sync, webhooks, shadow).
 */
export function parseSource(
  path: string,
  source: string,
  opts?: ParseSourceOptions | DomainConfig | null,
): ParsedFile | { parsed: ParsedFile; root: Parser.SyntaxNode; source: string } | null {
  const options: ParseSourceOptions =
    opts && typeof opts === 'object' && 'returnAst' in opts
      ? (opts as ParseSourceOptions)
      : { domainConfig: (opts as DomainConfig | null | undefined) ?? undefined };
  const result: ParsedFile = {
    path,
    imports: [],
    components: [],
    hooksUsed: [],
    hooksDefined: [],
    contexts: [],
    renders: [],
    propsByComponent: {},
    functions: [],
  calls: [],
  unresolvedCalls: [],
  nestModules: [],
  nestControllers: [],
  nestServices: [],
  strapiContentTypes: [],
  strapiControllers: [],
  strapiServices: [],
  routes: [],
  models: [],
  domainConcepts: [],
  };

  collectStrapiFromPath(path, result);

  const lang = getLanguageForPath(path);
  const parser = new Parser();
  parser.setLanguage(lang as Parameters<Parser['setLanguage']>[0]);
  let tree: Parser.Tree;
  try {
    tree = parser.parse(source);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const snippet = source.slice(0, 200).replace(/\n/g, ' ');
    console.warn(
      `[parser] Parse failed for ${path}: ${msg}. First 200 chars: ${snippet}...`,
    );
    // Fallback para archivos muy grandes (~60KB+ o ~3000+ sentencias): parsear truncado
    const truncated = tryParseTruncated(path, source, parser, lang as Parameters<Parser['setLanguage']>[0]);
    if (truncated) return truncated;
    const hasStrapi =
      result.strapiContentTypes.length > 0 ||
      result.strapiControllers.length > 0 ||
      result.strapiServices.length > 0;
    return hasStrapi ? result : null;
  }

  const root = tree.rootNode;
  const hasJsx =
    findNodesByType(root, 'jsx_element').length > 0 || findNodesByType(root, 'jsx_self_closing_element').length > 0;

  const importNodes = findNodesByType(root, ['import_statement', 'import_declaration']);
  for (const node of importNodes) {
    const specifierNode =
      node.childForFieldName('source') ?? node.childForFieldName('module_specifier');
    if (!specifierNode) continue;
    const specifier = getNodeText(source, specifierNode).replace(/^['"]|['"]$/g, '');
    const isDefault = !!node.childForFieldName('default');
    const localNames = collectImportLocalNames(node, source);
    result.imports.push({ specifier, isDefault, localNames });
  }

  const exportFromNodes = findNodesByType(root, 'export_statement');
  for (const node of exportFromNodes) {
    const nodeText = getNodeText(source, node);
    if (!/\sfrom\s+['"`]/.test(nodeText)) continue;
    const stringNodes = findNodesByType(node, 'string');
    for (const strNode of stringNodes) {
      const specifier = getNodeText(source, strNode).replace(/^['"`]|['"`]$/g, '');
      if (specifier && !result.imports.some((i) => i.specifier === specifier)) {
        result.imports.push({ specifier, isDefault: false, localNames: [] });
      }
    }
  }

  const classNodes = findNodesByType(root, 'class_declaration');
  for (const node of classNodes) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;
    const name = getNodeText(source, nameNode);
    const nestKind = getNestDecoratorKind(node, source);
    if (nestKind) {
      collectNestFromClass(node, source, result, name, nestKind);
      continue;
    }
    const superClass = node.childForFieldName('superclass');
    let isLegacy = false;
    let extendsReact = false;
    if (superClass) {
      const superText = getNodeText(source, superClass);
      extendsReact = /React\.Component|Component\b/.test(superText);
      isLegacy = extendsReact;
    }
    const description = getPrecedingJSDoc(source, node.startIndex);
    if (isDataModelClass(name, path, hasJsx, extendsReact)) {
      result.models.push({ name, description });
    } else if (isReactComponentName(name)) {
      result.components.push({ name, type: 'Class', isLegacy, description });
    }
  }

  const funcNodes = findNodesByType(root, ['function_declaration', 'function']);
  for (const node of funcNodes) {
    const nameNode = node.childForFieldName('name');
    let name: string;
    if (nameNode) {
      name = getNodeText(source, nameNode);
    } else {
      const parent = node.parent;
      if (!parent) continue;
      if (parent.type === 'variable_declarator') {
        const decl = parent.childForFieldName('name');
        if (!decl) continue;
        name = extractIdentifierFromDeclName(getNodeText(source, decl));
      } else if (parent.type === 'assignment_expression') {
        const left = parent.childForFieldName('left');
        if (!left) continue;
        name = getNodeText(source, left);
      } else {
        continue;
      }
    }
    if (!isReactComponentName(name)) continue;
    if (!hasJsx) continue;
    if (result.components.some((c) => c.name === name)) continue;
    const description = getPrecedingJSDoc(source, node.startIndex);
    result.components.push({ name, type: 'Functional', isLegacy: false, description });
  }

  const callNodes = findNodesByType(root, 'call_expression');
  for (const node of callNodes) {
    const fnNode = node.childForFieldName('function') ?? node.childForFieldName('callee');
    if (!fnNode) continue;
    const fnText = getNodeText(source, fnNode).trim();
    const match = fnText.match(/^(\w+)/);
    const calleeName = match ? match[1] : fnText;
    if (calleeName.startsWith('use') && calleeName.length > 3) {
      result.hooksUsed.push({ name: calleeName, line: node.startPosition.row + 1 });
    }
  }

  collectContextsAndDefinedHooks(root, source, result);

  const seenRenders = new Set<string>();
  for (const node of findNodesByType(root, 'jsx_element')) {
    const openNode = node.childForFieldName('open_tag') ?? node.firstChild;
    if (!openNode) continue;
    const tagNameNode = openNode.childForFieldName('name') ?? openNode.firstNamedChild;
    if (!tagNameNode) continue;
    const tagName = getNodeText(source, tagNameNode);
    if (isJsxComponentTag(tagName) && !seenRenders.has(tagName)) {
      seenRenders.add(tagName);
      result.renders.push({ componentName: tagName, line: node.startPosition.row + 1 });
    }
  }
  for (const node of findNodesByType(root, 'jsx_self_closing_element')) {
    const nameNode = node.childForFieldName('name') ?? node.firstNamedChild;
    if (!nameNode) continue;
    const tagName = getNodeText(source, nameNode);
    if (isJsxComponentTag(tagName) && !seenRenders.has(tagName)) {
      seenRenders.add(tagName);
      result.renders.push({ componentName: tagName, line: node.startPosition.row + 1 });
    }
  }

  const componentNames = new Set(result.components.map((c) => c.name));
  for (const node of findNodesByType(root, 'arrow_function')) {
    const firstParam = node.child(0);
    if (!firstParam) continue;
    const parent = node.parent;
    if (!parent) continue;
    let componentName: string | null = null;
    if (parent.type === 'variable_declarator') {
      const decl = parent.childForFieldName('name');
      if (decl) componentName = extractIdentifierFromDeclName(getNodeText(source, decl));
    } else if (parent.type === 'assignment_expression') {
      const left = parent.childForFieldName('left');
      if (left) componentName = extractIdentifierFromDeclName(getNodeText(source, left));
    }
    if (!componentName || !isReactComponentName(componentName)) {
      if (hasJsx && hasExportDefaultAncestor(node)) {
        const inferred = inferComponentNameFromPath(path);
        if (inferred && isReactComponentName(inferred) && !componentNames.has(inferred)) {
          componentNames.add(inferred);
          const description = getPrecedingJSDoc(source, node.startIndex);
          result.components.push({ name: inferred, type: 'Functional', isLegacy: false, description });
        }
      }
      continue;
    }
    if (!componentNames.has(componentName)) {
      componentNames.add(componentName);
      const description = getPrecedingJSDoc(source, node.startIndex);
      result.components.push({ name: componentName, type: 'Functional', isLegacy: false, description });
    }
    const props = extractPropsFromPattern(source, firstParam);
    if (props.length) result.propsByComponent[componentName] = props;
  }
  for (const node of findNodesByType(root, 'function_declaration')) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;
    const name = getNodeText(source, nameNode);
    if (!componentNames.has(name)) continue;
    const paramsNode = node.childForFieldName('parameters');
    if (!paramsNode || paramsNode.childCount === 0) continue;
    const firstParam = paramsNode.child(0);
    if (!firstParam) continue;
    const props = extractPropsFromPattern(source, firstParam);
    if (props.length) result.propsByComponent[name] = props;
  }
  collectTsPropsInterfacesAndForwardRef(root, source, result, componentNames);
  collectPropTypes(root, source, componentNames, result.propsByComponent);
  collectRoutes(root, source, result);
  collectFunctionsAndCalls(root, source, result);
  if (options.returnAst) {
    result.domainConcepts = [];
    return { parsed: result, root, source };
  }
  result.domainConcepts = options.extractDomainConcepts
    ? options.extractDomainConcepts(result, source, root, options.domainConfig ?? undefined)
    : [];
  return result;
}

/** Obtiene el valor de un atributo JSX (ej. path, element). */
function getJsxAttrValue(openNode: Parser.SyntaxNode, attrName: string, source: string): string | undefined {
  for (const attr of findNodesByType(openNode, 'jsx_attribute')) {
    const nameNode = attr.childForFieldName('name') ?? attr.firstNamedChild;
    if (!nameNode || getNodeText(source, nameNode) !== attrName) continue;
    const valueNode = attr.childForFieldName('value');
    if (!valueNode) return undefined;
    const text = getNodeText(source, valueNode);
    return text.replace(/^["'`{]|["'`}]$/g, '').trim();
  }
  return undefined;
}

/** Extrae el nombre del componente desde una expresión JSX (element={<X />}). */
function getComponentFromJsxExpr(node: Parser.SyntaxNode, source: string): string | undefined {
  if (!node) return undefined;
  if (node.type === 'jsx_expression_container') {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c && c.type !== '}' && c.type !== '{') return getComponentFromJsxExpr(c, source);
    }
    return undefined;
  }
  if (node.type === 'jsx_element') {
    const openNode = node.childForFieldName('open_tag') ?? node.firstChild;
    const nameNode = openNode?.childForFieldName('name') ?? openNode?.firstNamedChild;
    return nameNode ? getNodeText(source, nameNode) : undefined;
  }
  if (node.type === 'jsx_self_closing_element') {
    const nameNode = node.childForFieldName('name') ?? node.firstNamedChild;
    return nameNode ? getNodeText(source, nameNode) : undefined;
  }
  if (node.type === 'call_expression') {
    const callee = node.childForFieldName('function') ?? node.childForFieldName('callee');
    return callee?.type === 'identifier' ? getNodeText(source, callee) : undefined;
  }
  return undefined;
}

/** Custom hook: nombre que empieza por use y sigue con mayúscula (useState, useCirculoActivo). */
function isCustomHookName(name: string): boolean {
  return /^use[A-Z][a-zA-Z0-9]*$/.test(name);
}

/** True si el nodo call_expression es createContext(...) o React.createContext(...). */
function isCreateContextCall(callNode: Parser.SyntaxNode, source: string): boolean {
  if (callNode.type !== 'call_expression') return false;
  const callee = callNode.childForFieldName('function') ?? callNode.childForFieldName('callee');
  if (!callee) return false;
  if (callee.type === 'identifier') {
    return getNodeText(source, callee) === 'createContext';
  }
  if (callee.type === 'member_expression') {
    const prop = callee.childForFieldName('property') ?? callee.lastNamedChild;
    return prop ? getNodeText(source, prop) === 'createContext' : false;
  }
  return false;
}

/** Recoge contextos (createContext) y custom hooks definidos en el archivo. */
function collectContextsAndDefinedHooks(
  root: Parser.SyntaxNode,
  source: string,
  result: ParsedFile,
): void {
  const declarators = findNodesByType(root, 'variable_declarator');
  for (const decl of declarators) {
    const nameNode = decl.childForFieldName('name') ?? decl.child(0);
    const valueNode = decl.childForFieldName('value') ?? decl.childForFieldName('initializer');
    if (!nameNode || !valueNode) continue;
    const rawName =
      nameNode.type === 'identifier'
        ? getNodeText(source, nameNode)
        : extractIdentifierFromDeclName(getNodeText(source, nameNode));
    if (!rawName || !/^[\w$]+$/.test(rawName)) continue;
    const line = decl.startPosition.row + 1;
    if (valueNode.type === 'call_expression' && isCreateContextCall(valueNode, source)) {
      if (!result.contexts.some((c) => c.name === rawName)) {
        result.contexts.push({ name: rawName, line });
      }
    }
    if (
      isCustomHookName(rawName) &&
      (valueNode.type === 'arrow_function' || valueNode.type === 'function')
    ) {
      if (!result.hooksDefined.some((h) => h.name === rawName)) {
        result.hooksDefined.push({ name: rawName, line });
      }
    }
  }
  for (const node of findNodesByType(root, 'function_declaration')) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;
    const name = getNodeText(source, nameNode);
    if (isCustomHookName(name) && !result.hooksDefined.some((h) => h.name === name)) {
      result.hooksDefined.push({ name, line: node.startPosition.row + 1 });
    }
  }
}

/** Detecta rutas React Router (<Route path="..." element={<X />} />). */
function collectRoutes(root: Parser.SyntaxNode, source: string, result: ParsedFile): void {
  const routeNodes = [
    ...findNodesByType(root, 'jsx_element'),
    ...findNodesByType(root, 'jsx_self_closing_element'),
  ];
  for (const node of routeNodes) {
    const openNode = node.type === 'jsx_self_closing_element' ? node : node.childForFieldName('open_tag') ?? node.firstChild;
    if (!openNode) continue;
    const tagNode = openNode.childForFieldName('name') ?? openNode.firstNamedChild;
    if (!tagNode || getNodeText(source, tagNode) !== 'Route') continue;
    const path = getJsxAttrValue(openNode, 'path', source);
    if (!path) continue;
    let componentName: string | undefined;
    for (const attr of findNodesByType(openNode, 'jsx_attribute')) {
      const nameNode = attr.childForFieldName('name') ?? attr.firstNamedChild;
      if (!nameNode || getNodeText(source, nameNode) !== 'element') continue;
      const valueNode = attr.childForFieldName('value');
      if (!valueNode) break;
      componentName = getComponentFromJsxExpr(valueNode, source);
      break;
    }
    if (!componentName && node.type === 'jsx_element') {
      const child = node.childForFieldName('children') ?? node.child(1);
      componentName = child ? getComponentFromJsxExpr(child, source) : undefined;
    }
    if (componentName && isReactComponentName(componentName)) {
      result.routes.push({ path, componentName });
    }
  }
}

interface NamedFunction {
  name: string;
  bodyNode: Parser.SyntaxNode;
}

/** Max nesting depth (statement_block, etc.). Indica código spaguetti si >4. */
function computeNestingDepth(node: Parser.SyntaxNode): number {
  const BLOCK_TYPES = new Set(['statement_block', 'block', 'arrow_function', 'function']);
  let maxDepth = 0;
  const walk = (n: Parser.SyntaxNode, depth: number) => {
    if (BLOCK_TYPES.has(n.type)) {
      const newDepth = depth + 1;
      if (newDepth > maxDepth) maxDepth = newDepth;
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c) walk(c, newDepth);
      }
    } else {
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c) walk(c, depth);
      }
    }
  };
  walk(node, 0);
  return maxDepth;
}

/** Detecta llamadas a endpoints (fetch, axios.get/post, api.get, etc.) en un nodo. */
function extractEndpointCalls(node: Parser.SyntaxNode, source: string): EndpointCallInfo[] {
  const out: EndpointCallInfo[] = [];
  const callNodes = findNodesByType(node, 'call_expression');
  for (const call of callNodes) {
    const callee = call.childForFieldName('function') ?? call.childForFieldName('callee');
    if (!callee) continue;
    const line = call.startPosition.row + 1;
    if (callee.type === 'identifier') {
      const name = getNodeText(source, callee);
      if (name === 'fetch') {
        out.push({ method: 'fetch', line });
      }
    } else if (callee.type === 'member_expression') {
      const obj = callee.childForFieldName('object') ?? callee.child(0);
      const prop = callee.childForFieldName('property') ?? callee.childForFieldName('member') ?? callee.lastNamedChild;
      if (!obj || !prop) continue;
      const objText = getNodeText(source, obj).split('.')[0];
      const propText = getNodeText(source, prop);
      const methodMap: Record<string, string> = { get: 'GET', post: 'POST', put: 'PUT', delete: 'DELETE', patch: 'PATCH' };
      const httpMethod = methodMap[propText.toLowerCase()];
      if (objText === 'axios' && httpMethod) {
        out.push({ method: `axios.${propText}`, line });
      } else if ((objText === 'api' || objText === 'http' || objText === 'request') && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(propText)) {
        out.push({ method: `${objText}.${propText}`, line });
      }
    }
  }
  return out;
}

/** McCabe cyclomatic complexity: 1 + decision points (if, for, while, switch case, ternary, catch). */
function computeCyclomaticComplexity(node: Parser.SyntaxNode): number {
  const DECISION_TYPES = new Set([
    'if_statement', 'for_statement', 'while_statement', 'do_while_statement',
    'for_in_statement', 'for_of_statement', 'switch_case', 'ternary_expression',
    'conditional_expression', 'catch_clause',
  ]);
  let count = 0;
  const walk = (n: Parser.SyntaxNode) => {
    if (DECISION_TYPES.has(n.type)) count++;
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) walk(c);
    }
  };
  walk(node);
  return Math.max(1, count + 1); // base 1 + decisions
}

/** Recopila funciones nombradas (con complexity, nestingDepth) y llamadas entre ellas. */
function collectFunctionsAndCalls(root: Parser.SyntaxNode, source: string, result: ParsedFile): void {
  const namedFunctions: NamedFunction[] = [];
  const funcDecls = findNodesByType(root, 'function_declaration');
  for (const node of funcDecls) {
    const nameNode = node.childForFieldName('name');
    const bodyNode = node.childForFieldName('body');
    if (nameNode && bodyNode) {
      const name = getNodeText(source, nameNode);
      if (/^[\w$]+$/.test(name)) {
        const lineRange = {
          start: node.startPosition.row + 1,
          end: node.endPosition.row + 1,
        };
        const description = getPrecedingJSDoc(source, node.startIndex);
        const complexity = computeCyclomaticComplexity(bodyNode);
        const nestingDepth = computeNestingDepth(bodyNode);
        const endpointCalls = extractEndpointCalls(bodyNode, source);
        namedFunctions.push({ name, bodyNode });
        result.functions.push({ name, lineRange, description, complexity, nestingDepth, endpointCalls: endpointCalls.length ? endpointCalls : undefined });
      }
    }
  }
  const declarators = findNodesByType(root, 'variable_declarator');
  for (const decl of declarators) {
    const nameNode = decl.childForFieldName('name') ?? decl.child(0);
    const valueNode = decl.childForFieldName('value') ?? decl.childForFieldName('initializer');
    if (!nameNode || !valueNode) continue;
    if (valueNode.type !== 'arrow_function' && valueNode.type !== 'function') continue;
    let name: string;
    if (nameNode.type === 'identifier') {
      name = getNodeText(source, nameNode);
    } else {
      const raw = getNodeText(source, nameNode);
      name = extractIdentifierFromDeclName(raw);
      if (!name) continue;
    }
    if (!/^[\w$]+$/.test(name)) continue;
    const bodyNode = valueNode.childForFieldName('body') ?? valueNode.lastChild;
    if (bodyNode) {
      const lineRange = {
        start: decl.startPosition.row + 1,
        end: decl.endPosition.row + 1,
      };
      const description = getPrecedingJSDoc(source, decl.startIndex);
      const complexity = computeCyclomaticComplexity(bodyNode);
      const nestingDepth = computeNestingDepth(bodyNode);
      const endpointCalls = extractEndpointCalls(bodyNode, source);
      namedFunctions.push({ name, bodyNode });
      if (!result.functions.some((f) => f.name === name))
        result.functions.push({ name, lineRange, description, complexity, nestingDepth, endpointCalls: endpointCalls.length ? endpointCalls : undefined });
    }
  }
  const definedNames = new Set(result.functions.map((f) => f.name));
  for (const { name: callerName, bodyNode } of namedFunctions) {
    const callNodes = findNodesByType(bodyNode, 'call_expression');
    for (const call of callNodes) {
      const calleeNode = call.childForFieldName('function') ?? call.childForFieldName('callee');
      if (!calleeNode) continue;
      let calleeName: string | null = null;
      if (calleeNode.type === 'identifier') {
        calleeName = getNodeText(source, calleeNode);
      } else if (calleeNode.type === 'member_expression') {
        const prop = calleeNode.childForFieldName('property') ?? calleeNode.lastNamedChild;
        if (prop) calleeName = getNodeText(source, prop);
      }
      if (!calleeName || calleeName === callerName) continue;
      if (definedNames.has(calleeName)) {
        result.calls.push({ caller: callerName, callee: calleeName });
      } else {
        result.unresolvedCalls.push({ caller: callerName, calleeLocalName: calleeName });
      }
    }
  }
}

type NestKind = 'module' | 'controller' | 'service';

function getNestDecoratorKind(classNode: Parser.SyntaxNode, source: string): NestKind | null {
  const decorators = findNodesByType(classNode, 'decorator');
  for (const dec of decorators) {
    const call = dec.childForFieldName('expression') ?? findNodesByType(dec, 'call_expression')[0];
    if (!call || call.type !== 'call_expression') continue;
    const callee = call.childForFieldName('function') ?? call.childForFieldName('callee');
    if (!callee) continue;
    let name: string;
    if (callee.type === 'identifier') {
      name = getNodeText(source, callee);
    } else if (callee.type === 'member_expression') {
      const prop = callee.childForFieldName('property') ?? callee.lastNamedChild;
      name = prop ? getNodeText(source, prop) : '';
    } else continue;
    if (name === 'Module') return 'module';
    if (name === 'Controller') return 'controller';
    if (name === 'Injectable' || name === 'Service') return 'service';
  }
  return null;
}

function getFirstStringArg(callNode: Parser.SyntaxNode, source: string): string | undefined {
  const args = callNode.childForFieldName('arguments') ?? callNode.childForFieldName('arguments');
  if (!args) return undefined;
  for (let i = 0; i < args.childCount; i++) {
    const c = args.child(i);
    if (!c) continue;
    if (c.type === 'string' || c.type === 'template_string') {
      return getNodeText(source, c).replace(/^['`"]|['`"]$/g, '');
    }
    if (c.type === 'object' || c.type === 'object_type') continue;
  }
  return undefined;
}

function getArrayPropertyNames(objNode: Parser.SyntaxNode, key: string, source: string): string[] {
  const names: string[] = [];
  for (let i = 0; i < objNode.childCount; i++) {
    const pair = objNode.child(i);
    if (!pair || pair.type !== 'pair') continue;
    const k = pair.childForFieldName('key') ?? pair.child(0);
    if (!k || getNodeText(source, k).replace(/^['"]?|['"]$/g, '') !== key) continue;
    const value = pair.childForFieldName('value') ?? pair.child(1);
    if (!value || value.type !== 'array') continue;
    for (let j = 0; j < value.childCount; j++) {
      const el = value.child(j);
      if (!el) continue;
      const id = el.type === 'identifier' ? el : (el.childForFieldName('name') ?? findNodesByType(el, 'identifier')[0]);
      if (id) names.push(getNodeText(source, id));
    }
    break;
  }
  return names;
}

function collectNestFromClass(
  classNode: Parser.SyntaxNode,
  source: string,
  result: ParsedFile,
  className: string,
  kind: NestKind,
): void {
  if (kind === 'module') {
    const decorators = findNodesByType(classNode, 'decorator');
    let controllers: string[] = [];
    let providers: string[] = [];
    for (const dec of decorators) {
      const call = dec.childForFieldName('expression') ?? findNodesByType(dec, 'call_expression')[0];
      if (!call || call.type !== 'call_expression') continue;
      const callee = call.childForFieldName('function') ?? call.childForFieldName('callee');
      if (!callee || getNodeText(source, callee) !== 'Module') continue;
      const args = call.childForFieldName('arguments');
      if (args) {
        const first = args.child(0);
        if (first && (first.type === 'object' || first.type === 'object_type')) {
          controllers = getArrayPropertyNames(first, 'controllers', source);
          providers = getArrayPropertyNames(first, 'providers', source);
        }
      }
      break;
    }
    result.nestModules.push({ name: className, controllers, providers });
    return;
  }
  if (kind === 'controller') {
    const decorators = findNodesByType(classNode, 'decorator');
    let route: string | undefined;
    for (const dec of decorators) {
      const call = dec.childForFieldName('expression') ?? findNodesByType(dec, 'call_expression')[0];
      if (!call || call.type !== 'call_expression') continue;
      const callee = call.childForFieldName('function') ?? call.childForFieldName('callee');
      if (!callee || getNodeText(source, callee) !== 'Controller') continue;
      route = getFirstStringArg(call, source);
      break;
    }
    result.nestControllers.push(route !== undefined ? { name: className, route } : { name: className });
    return;
  }
  if (kind === 'service') {
    result.nestServices.push({ name: className });
  }
}

function collectImportLocalNames(importNode: Parser.SyntaxNode, source: string): string[] {
  const names: string[] = [];
  const sourceNode = importNode.childForFieldName('source') ?? importNode.childForFieldName('module_specifier');
  for (let i = 0; i < importNode.childCount; i++) {
    const c = importNode.child(i);
    if (!c || c === sourceNode) continue;
    if (c.type === 'identifier' && /^[\w$]+$/.test(getNodeText(source, c))) {
      names.push(getNodeText(source, c));
    } else if (c.type === 'named_imports' || c.type === 'import_clause') {
      const ids = findNodesByType(c, 'identifier');
      for (const id of ids) names.push(getNodeText(source, id));
    } else if (c.type === 'shorthand_property_identifier_pattern' || c.type === 'property_identifier') {
      names.push(getNodeText(source, c));
    }
  }
  return [...new Set(names)];
}

function extractPropsFromPattern(
  src: string,
  paramNode: Parser.SyntaxNode,
): PropInfo[] {
  const props: PropInfo[] = [];
  if (paramNode.type === 'object_pattern') {
    for (let i = 0; i < paramNode.childCount; i++) {
      const child = paramNode.child(i);
      if (!child) continue;
      if (child.type === 'pair') {
        const key = child.childForFieldName('key') ?? child.childForFieldName('value');
        if (key) {
          const name = getNodeText(src, key).replace(/:.*$/, '').trim();
          if (/^[\w$]+$/.test(name)) props.push({ name, required: false });
        }
      } else if (
        child.type === 'shorthand_property_identifier' ||
        child.type === 'identifier'
      ) {
        const name = getNodeText(src, child);
        if (name !== 'undefined' && /^[\w$]+$/.test(name))
          props.push({ name, required: false });
      }
    }
  }
  return props;
}

/**
 * Props desde interfaces/tipos `XProps`, `type XProps = { ... }` y `forwardRef<El, XProps>`.
 * Se fusiona con destructuring y PropTypes sin borrar claves existentes.
 */
function collectTsPropsInterfacesAndForwardRef(
  root: Parser.SyntaxNode,
  source: string,
  result: ParsedFile,
  componentNames: Set<string>,
): void {
  const propsByComponent = result.propsByComponent;
  const typeToProps = new Map<string, PropInfo[]>();

  for (const node of findNodesByType(root, 'interface_declaration')) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;
    const typeName = getNodeText(source, nameNode);
    const body = node.childForFieldName('body');
    if (!body || body.type !== 'interface_body') continue;
    const props = extractPropsFromTypeScriptTypeBody(body, source);
    if (props.length) typeToProps.set(typeName, props);
  }

  for (const node of findNodesByType(root, 'type_alias_declaration')) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;
    const typeName = getNodeText(source, nameNode);
    let objectBody: Parser.SyntaxNode | null = null;
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChildren[i];
      if (c.type === 'object_type') {
        objectBody = c;
        break;
      }
    }
    if (!objectBody) continue;
    const props = extractPropsFromTypeScriptTypeBody(objectBody, source);
    if (props.length) typeToProps.set(typeName, props);
  }

  for (const comp of componentNames) {
    const key = `${comp}Props`;
    const fromType = typeToProps.get(key);
    if (fromType?.length) mergePropsIntoComponent(comp, fromType, propsByComponent);
  }

  for (const callNode of findNodesByType(root, 'call_expression')) {
    const callee = callNode.childForFieldName('function');
    if (!callee || getNodeText(source, callee) !== 'forwardRef') continue;
    const ta = callNode.childForFieldName('type_arguments');
    if (!ta) continue;
    const typeIds = findNodesByType(ta, 'type_identifier');
    if (typeIds.length < 2) continue;
    const propsTypeName = getNodeText(source, typeIds[typeIds.length - 1]);
    const props = typeToProps.get(propsTypeName);
    if (!props?.length) continue;
    let parent: Parser.SyntaxNode | null = callNode.parent;
    while (parent && parent.type !== 'variable_declarator') {
      parent = parent.parent;
    }
    if (!parent || parent.type !== 'variable_declarator') continue;
    const varNameNode = parent.childForFieldName('name');
    if (!varNameNode) continue;
    const varName = getNodeText(source, varNameNode);
    if (!isReactComponentName(varName)) continue;
    if (!componentNames.has(varName)) {
      componentNames.add(varName);
      result.components.push({ name: varName, type: 'Functional', isLegacy: false });
    }
    mergePropsIntoComponent(varName, props, propsByComponent);
  }
}

function extractPropsFromTypeScriptTypeBody(body: Parser.SyntaxNode, source: string): PropInfo[] {
  const props: PropInfo[] = [];
  for (const child of body.namedChildren) {
    if (child.type === 'property_signature') {
      const nameNode = child.childForFieldName('name');
      if (!nameNode || nameNode.type !== 'property_identifier') continue;
      const name = getNodeText(source, nameNode);
      if (!/^[\w$]+$/.test(name)) continue;
      const optional = child.text.includes('?');
      props.push({ name, required: !optional });
    } else if (child.type === 'method_signature') {
      const id = findNodesByType(child, 'property_identifier')[0];
      if (!id) continue;
      const name = getNodeText(source, id);
      if (!/^[\w$]+$/.test(name)) continue;
      props.push({ name, required: true });
    }
  }
  return props;
}

function mergePropsIntoComponent(
  comp: string,
  incoming: PropInfo[],
  propsByComponent: Record<string, PropInfo[]>,
): void {
  const existing = propsByComponent[comp] ?? [];
  const byName = new Map(existing.map((p) => [p.name, p]));
  for (const p of incoming) {
    const cur = byName.get(p.name);
    if (!cur) byName.set(p.name, p);
    else byName.set(p.name, { name: p.name, required: cur.required || p.required });
  }
  propsByComponent[comp] = Array.from(byName.values());
}

function collectPropTypes(
  root: Parser.SyntaxNode,
  source: string,
  componentNames: Set<string>,
  propsByComponent: Record<string, PropInfo[]>,
): void {
  const assignNodes = findNodesByType(root, 'assignment_expression');
  for (const node of assignNodes) {
    const left = node.childForFieldName('left');
    if (!left || left.type !== 'member_expression') continue;
    const obj = left.childForFieldName('object');
    const prop = left.childForFieldName('property');
    if (!obj || !prop) continue;
    const compName = getNodeText(source, obj);
    const propName = getNodeText(source, prop);
    if (!componentNames.has(compName) || propName !== 'propTypes') continue;
    const right = node.childForFieldName('right');
    if (!right || right.type !== 'object') continue;
    const required = new Set<string>();
    const optional = new Set<string>();
    for (let i = 0; i < right.childCount; i++) {
      const pair = right.child(i);
      if (!pair || pair.type !== 'pair') continue;
      const keyNode = pair.childForFieldName('key') ?? pair.child(0);
      const valueNode = pair.childForFieldName('value') ?? pair.child(1);
      if (!keyNode) continue;
      const key = getNodeText(source, keyNode).replace(/^['"]|['"]$/g, '');
      const valueText = valueNode ? getNodeText(source, valueNode) : '';
      if (/\.isRequired\b/.test(valueText)) required.add(key);
      else optional.add(key);
    }
    const existing = propsByComponent[compName] ?? [];
    const byName = new Map(existing.map((p) => [p.name, p]));
    for (const k of required) byName.set(k, { name: k, required: true });
    for (const k of optional) if (!byName.has(k)) byName.set(k, { name: k, required: false });
    propsByComponent[compName] = Array.from(byName.values());
  }
}
