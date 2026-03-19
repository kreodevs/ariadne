/**
 * Parser "light" Tree-sitter para JS/JSX/TS/TSX (cartographer).
 * Solo para indexación: imports, componentes, hooks, RENDERS, props, funciones y CALLS, Nest/Strapi.
 * Sin domainConcepts, sin routes, sin returnAst. El parser completo (con dominio y rutas) está en ingest (pipeline/parser).
 * No comparten código; mantener sincronizados cambios de estructura si se añaden campos al grafo.
 */

import Parser from "tree-sitter";
import JavaScript from "tree-sitter-javascript";
import TypeScript from "tree-sitter-typescript";

// tree-sitter-javascript: single grammar (JS + JSX). tree-sitter-typescript: .typescript and .tsx
const ts = TypeScript as unknown as { typescript: unknown; tsx: unknown };
const LANG_JS = JavaScript as unknown;
const LANG_TSX = ts.tsx;
const LANG_TS = ts.typescript;

export interface ImportInfo {
  specifier: string; // raw string from source (e.g. 'react', './Button')
  isDefault: boolean;
  /** Local names brought into scope (default or named import names). */
  localNames: string[];
}

export interface ComponentInfo {
  name: string;
  type: "Class" | "Functional";
  isLegacy: boolean; // extends React.Component or uses legacy lifecycles
}

export interface HookUsage {
  name: string; // useState, useEffect, or custom hook name
  line?: number;
}

export interface RendersUsage {
  componentName: string; // PascalCase tag in JSX
  line?: number;
}

export interface PropInfo {
  name: string;
  required: boolean;
}

/** Función nombrada definida en el archivo (para grafo Function + CALLS). */
export interface FunctionInfo {
  name: string;
}

/** Llamada entre funciones del mismo archivo (caller → callee). */
export interface CallInfo {
  caller: string;
  callee: string;
}

/** Llamada donde el callee es un identificador no definido en este archivo (candidata cross-file). */
export interface UnresolvedCallInfo {
  caller: string;
  calleeLocalName: string;
}

/** Llamada cross-file resuelta (import + export). */
export interface ResolvedCallInfo {
  callerPath: string;
  callerName: string;
  calleePath: string;
  calleeName: string;
}

export interface NestModuleInfo {
  name: string;
  controllers: string[];
  providers: string[];
}

export interface NestControllerInfo {
  name: string;
  route?: string;
}

export interface NestServiceInfo {
  name: string;
}

export interface StrapiContentTypeInfo {
  name: string;
}

export interface StrapiControllerInfo {
  name: string;
  apiName?: string;
}

export interface StrapiServiceInfo {
  name: string;
  apiName?: string;
}

export interface ParsedFile {
  path: string;
  imports: ImportInfo[];
  components: ComponentInfo[];
  hooksUsed: HookUsage[];
  renders: RendersUsage[];
  /** Props per component name (from function params destructuring, PropTypes, or TS types). */
  propsByComponent: Record<string, PropInfo[]>;
  /** Funciones nombradas (top-level) para grafo Function. */
  functions: FunctionInfo[];
  /** Llamadas entre funciones del mismo archivo para relación CALLS. */
  calls: CallInfo[];
  /** Llamadas donde el callee podría estar en otro archivo. */
  unresolvedCalls: UnresolvedCallInfo[];
  nestModules: NestModuleInfo[];
  nestControllers: NestControllerInfo[];
  nestServices: NestServiceInfo[];
  strapiContentTypes: StrapiContentTypeInfo[];
  strapiControllers: StrapiControllerInfo[];
  strapiServices: StrapiServiceInfo[];
}

function getLanguageForPath(path: string): unknown {
  const ext = path.slice(path.lastIndexOf("."));
  if (ext === ".tsx") return LANG_TSX;
  if (ext === ".ts") return LANG_TS;
  return LANG_JS;
}

function getNodeText(src: string, node: Parser.SyntaxNode): string {
  return src.slice(node.startIndex, node.endIndex);
}

function isPascalCase(s: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*$/.test(s) && s.length > 0;
}

function isReactComponentName(name: string): boolean {
  return isPascalCase(name) && name !== "React";
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

function findNodesByType(
  node: Parser.SyntaxNode,
  types: string | string[]
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

function collectStrapiFromPath(path: string, result: ParsedFile): void {
  const norm = path.replace(/\\/g, "/");
  const contentTypesMatch = norm.match(/\/api\/([^/]+)\/content-types\/([^/]+)\/schema\.(json|ts|js)$/);
  if (contentTypesMatch) {
    result.strapiContentTypes.push({ name: contentTypesMatch[2] });
    return;
  }
  const controllersMatch = norm.match(/\/api\/([^/]+)\/controllers\/([^/]+)\.(ts|js)$/);
  if (controllersMatch) {
    result.strapiControllers.push({ name: controllersMatch[2], apiName: controllersMatch[1] });
    return;
  }
  const servicesMatch = norm.match(/\/api\/([^/]+)\/services\/([^/]+)\.(ts|js)$/);
  if (servicesMatch) {
    result.strapiServices.push({ name: servicesMatch[2], apiName: servicesMatch[1] });
  }
}

/**
 * Parsea un archivo JS/TS/JSX/TSX con Tree-sitter y extrae imports, componentes, hooks, renders, props,
 * funciones, CALLS, y módulos Nest/Strapi. Usado por el indexador y por el shadow server.
 * @riskScore 129 — Alta complejidad; ~13 llamadas internas. Cambios afectan index y shadow-server; validar con tests.
 */
export function parseSource(path: string, source: string): ParsedFile | null {
  const lang = getLanguageForPath(path);
  const parser = new Parser();
  parser.setLanguage(lang);

  let tree: Parser.Tree;
  try {
    tree = parser.parse(source);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const snippet = source.slice(0, 200).replace(/\n/g, ' ');
    console.warn(
      `[parser] Parse failed for ${path}: ${msg}. First 200 chars: ${snippet}...`,
    );
    return null;
  }

  const result: ParsedFile = {
    path,
    imports: [],
    components: [],
    hooksUsed: [],
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
  };

  collectStrapiFromPath(path, result);

  const root = tree.rootNode;

  // --- Imports: import_statement (JS/TS) or import_declaration
  const importNodes = findNodesByType(root, ["import_statement", "import_declaration"]);
  for (const node of importNodes) {
    const specifierNode =
      node.childForFieldName("source") ?? node.childForFieldName("module_specifier");
    if (!specifierNode) continue;
    const specifier = getNodeText(source, specifierNode).replace(/^['"]|['"]$/g, "");
    const isDefault = !!node.childForFieldName("default");
    const localNames = collectImportLocalNames(node, source);
    result.imports.push({ specifier, isDefault, localNames });
  }

  // --- Components: class_declaration (Class) and function_declaration / arrow with PascalCase (Functional)
  const classNodes = findNodesByType(root, "class_declaration");
  for (const node of classNodes) {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) continue;
    const name = getNodeText(source, nameNode);
    const nestKind = getNestDecoratorKind(node, source);
    if (nestKind) {
      collectNestFromClass(node, source, result, name, nestKind);
      continue;
    }
    const superClass = node.childForFieldName("superclass");
    let isLegacy = false;
    if (superClass) {
      const superText = getNodeText(source, superClass);
      isLegacy = /React\.Component|Component\b/.test(superText);
    }
    result.components.push({ name, type: "Class", isLegacy });
  }

  const funcNodes = findNodesByType(root, [
    "function_declaration",
    "arrow_function",
    "function",
  ]);
  for (const node of funcNodes) {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) continue;
    const name = getNodeText(source, nameNode);
    if (!isReactComponentName(name)) continue;
    result.components.push({ name, type: "Functional", isLegacy: false });
  }

  // --- Hooks: call_expression where callee is identifier or member (e.g. useState, React.useState)
  const callNodes = findNodesByType(root, "call_expression");
  for (const node of callNodes) {
    const fnNode = node.childForFieldName("function") ?? node.childForFieldName("callee");
    if (!fnNode) continue;
    let calleeName: string;
    if (fnNode.type === "member_expression") {
      const prop = fnNode.childForFieldName("property") ?? fnNode.lastNamedChild;
      calleeName = prop ? getNodeText(source, prop) : "";
    } else {
      const fnText = getNodeText(source, fnNode).trim();
      const match = fnText.match(/^(\w+)/);
      calleeName = match ? match[1] : fnText;
    }
    if (calleeName.startsWith("use") && calleeName.length > 3) {
      result.hooksUsed.push({ name: calleeName, line: node.startPosition.row + 1 });
    }
  }

  // --- RENDERS: JSX elements with PascalCase tag (incl. Context.Provider)
  const seenRenders = new Set<string>();
  for (const node of findNodesByType(root, "jsx_element")) {
    const openNode = node.childForFieldName("open_tag") ?? node.firstChild;
    if (!openNode) continue;
    const tagNameNode = openNode.childForFieldName("name") ?? openNode.firstNamedChild;
    if (!tagNameNode) continue;
    const tagName = getNodeText(source, tagNameNode);
    if (isJsxComponentTag(tagName) && !seenRenders.has(tagName)) {
      seenRenders.add(tagName);
      result.renders.push({ componentName: tagName, line: node.startPosition.row + 1 });
    }
  }
  for (const node of findNodesByType(root, "jsx_self_closing_element")) {
    const nameNode = node.childForFieldName("name") ?? node.firstNamedChild;
    if (!nameNode) continue;
    const tagName = getNodeText(source, nameNode);
    if (isJsxComponentTag(tagName) && !seenRenders.has(tagName)) {
      seenRenders.add(tagName);
      result.renders.push({ componentName: tagName, line: node.startPosition.row + 1 });
    }
  }

  // --- Props: from function component params (object destructuring) and PropTypes
  const componentNames = new Set(result.components.map((c) => c.name));
  for (const node of findNodesByType(root, "arrow_function")) {
    const firstParam = node.child(0);
    if (!firstParam) continue;
    const parent = node.parent;
    if (!parent) continue;
    let componentName: string | null = null;
    if (parent.type === "variable_declarator") {
      const decl = parent.childForFieldName("name");
      if (decl) componentName = extractIdentifierFromDeclName(getNodeText(source, decl));
    } else if (parent.type === "assignment_expression") {
      const left = parent.childForFieldName("left");
      if (left) componentName = extractIdentifierFromDeclName(getNodeText(source, left));
    }
    if (!componentName || !isReactComponentName(componentName)) continue;
    componentNames.add(componentName);
    if (!result.components.some((c) => c.name === componentName)) {
      result.components.push({ name: componentName, type: "Functional", isLegacy: false });
    }
    const props = extractPropsFromPattern(source, firstParam);
    if (props.length) result.propsByComponent[componentName] = props;
  }
  for (const node of findNodesByType(root, "function_declaration")) {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) continue;
    const name = getNodeText(source, nameNode);
    if (!componentNames.has(name)) continue;
    const paramsNode = node.childForFieldName("parameters") ?? node.childForFieldName("params");
    if (!paramsNode) continue;
    const firstPattern =
      findNodesByType(paramsNode, "object_pattern")[0] ??
      findNodesByType(paramsNode, "pattern")[0] ??
      paramsNode.namedChild(0);
    if (!firstPattern) continue;
    const props = extractPropsFromPattern(source, firstPattern);
    if (props.length) result.propsByComponent[name] = props;
  }
  collectPropTypes(root, source, componentNames, result.propsByComponent);

  // --- Functions + CALLS: funciones nombradas y llamadas entre ellas (mismo archivo)
  collectFunctionsAndCalls(root, source, result);

  return result;
}

interface NamedFunction {
  name: string;
  bodyNode: Parser.SyntaxNode;
}

/**
 * Rellena result.functions (top-level function_declaration y arrow en variable_declarator),
 * result.calls (llamadas entre funciones del mismo archivo) y result.unresolvedCalls (callee no definido aquí).
 */
function collectFunctionsAndCalls(root: Parser.SyntaxNode, source: string, result: ParsedFile): void {
  const namedFunctions: NamedFunction[] = [];
  // Top-level function_declaration with name
  const funcDecls = findNodesByType(root, "function_declaration");
  for (const node of funcDecls) {
    const nameNode = node.childForFieldName("name");
    const bodyNode = node.childForFieldName("body");
    if (nameNode && bodyNode) {
      const name = getNodeText(source, nameNode);
      if (/^[\w$]+$/.test(name)) {
        namedFunctions.push({ name, bodyNode });
        result.functions.push({ name });
      }
    }
  }
  // const/let/var with arrow_function: variable name = function name
  const declarators = findNodesByType(root, "variable_declarator");
  for (const decl of declarators) {
    const nameNode = decl.childForFieldName("name") ?? decl.child(0);
    const valueNode = decl.childForFieldName("value") ?? decl.childForFieldName("initializer");
    if (!nameNode || !valueNode) continue;
    if (valueNode.type !== "arrow_function" && valueNode.type !== "function") continue;
    let name: string;
    if (nameNode.type === "identifier") {
      name = getNodeText(source, nameNode);
    } else {
      const raw = getNodeText(source, nameNode);
      name = extractIdentifierFromDeclName(raw);
      if (!name) continue;
    }
    if (!/^[\w$]+$/.test(name)) continue;
    const bodyNode = valueNode.childForFieldName("body") ?? valueNode.lastChild;
    if (bodyNode) {
      namedFunctions.push({ name, bodyNode });
      if (!result.functions.some((f) => f.name === name)) result.functions.push({ name });
    }
  }

  const definedNames = new Set(result.functions.map((f) => f.name));
  for (const { name: callerName, bodyNode } of namedFunctions) {
    const callNodes = findNodesByType(bodyNode, "call_expression");
    for (const call of callNodes) {
      const calleeNode = call.childForFieldName("function") ?? call.childForFieldName("callee");
      if (!calleeNode) continue;
      let calleeName: string | null = null;
      if (calleeNode.type === "identifier") {
        calleeName = getNodeText(source, calleeNode);
      } else if (calleeNode.type === "member_expression") {
        const prop = calleeNode.childForFieldName("property") ?? calleeNode.lastNamedChild;
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

type NestKind = "module" | "controller" | "service";

/** Detecta si la clase tiene decorador @Module(), @Controller() o @Injectable()/Service y devuelve el kind. */
function getNestDecoratorKind(classNode: Parser.SyntaxNode, source: string): NestKind | null {
  const decorators = findNodesByType(classNode, "decorator");
  for (const dec of decorators) {
    const call = dec.childForFieldName("expression") ?? findNodesByType(dec, "call_expression")[0];
    if (!call || call.type !== "call_expression") continue;
    const callee = call.childForFieldName("function") ?? call.childForFieldName("callee");
    if (!callee) continue;
    let name: string;
    if (callee.type === "identifier") {
      name = getNodeText(source, callee);
    } else if (callee.type === "member_expression") {
      const prop = callee.childForFieldName("property") ?? callee.lastNamedChild;
      name = prop ? getNodeText(source, prop) : "";
    } else continue;
    if (name === "Module") return "module";
    if (name === "Controller") return "controller";
    if (name === "Injectable" || name === "Service") return "service";
  }
  return null;
}

/** Devuelve el primer argumento de tipo string o template_string de un nodo call_expression. */
function getFirstStringArg(callNode: Parser.SyntaxNode, source: string): string | undefined {
  const args = callNode.childForFieldName("arguments");
  if (!args) return undefined;
  for (let i = 0; i < args.childCount; i++) {
    const c = args.child(i);
    if (!c) continue;
    if (c.type === "string" || c.type === "template_string") {
      return getNodeText(source, c).replace(/^['`"]|['`"]$/g, "");
    }
  }
  return undefined;
}

/** Extrae los identificadores de un array que es valor de la propiedad `key` en un objeto AST. */
function getArrayPropertyNames(objNode: Parser.SyntaxNode, key: string, source: string): string[] {
  const names: string[] = [];
  for (let i = 0; i < objNode.childCount; i++) {
    const pair = objNode.child(i);
    if (!pair || pair.type !== "pair") continue;
    const k = pair.childForFieldName("key") ?? pair.child(0);
    if (!k || getNodeText(source, k).replace(/^['"]?|['"]$/g, "") !== key) continue;
    const value = pair.childForFieldName("value") ?? pair.child(1);
    if (!value || value.type !== "array") continue;
    for (let j = 0; j < value.childCount; j++) {
      const el = value.child(j);
      if (!el) continue;
      const id = el.type === "identifier" ? el : findNodesByType(el, "identifier")[0];
      if (id) names.push(getNodeText(source, id));
    }
    break;
  }
  return names;
}

/**
 * Rellena result.nestModules/nestControllers/nestServices desde una clase con decorador Nest (Module/Controller/Injectable).
 */
function collectNestFromClass(
  classNode: Parser.SyntaxNode,
  source: string,
  result: ParsedFile,
  className: string,
  kind: NestKind
): void {
  if (kind === "module") {
    const decorators = findNodesByType(classNode, "decorator");
    let controllers: string[] = [];
    let providers: string[] = [];
    for (const dec of decorators) {
      const call = dec.childForFieldName("expression") ?? findNodesByType(dec, "call_expression")[0];
      if (!call || call.type !== "call_expression") continue;
      const callee = call.childForFieldName("function") ?? call.childForFieldName("callee");
      if (!callee || getNodeText(source, callee) !== "Module") continue;
      const args = call.childForFieldName("arguments");
      if (args?.childCount) {
        const first = args.child(0);
        if (first && (first.type === "object" || first.type === "object_type")) {
          controllers = getArrayPropertyNames(first, "controllers", source);
          providers = getArrayPropertyNames(first, "providers", source);
        }
      }
      break;
    }
    result.nestModules.push({ name: className, controllers, providers });
    return;
  }
  if (kind === "controller") {
    const decorators = findNodesByType(classNode, "decorator");
    let route: string | undefined;
    for (const dec of decorators) {
      const call = dec.childForFieldName("expression") ?? findNodesByType(dec, "call_expression")[0];
      if (!call || call.type !== "call_expression") continue;
      const callee = call.childForFieldName("function") ?? call.childForFieldName("callee");
      if (!callee || getNodeText(source, callee) !== "Controller") continue;
      route = getFirstStringArg(call, source);
      break;
    }
    result.nestControllers.push(route !== undefined ? { name: className, route } : { name: className });
    return;
  }
  if (kind === "service") {
    result.nestServices.push({ name: className });
  }
}

/** Extrae los nombres locales (default + named) de un nodo import_statement/import_declaration para el grafo. */
function collectImportLocalNames(importNode: Parser.SyntaxNode, source: string): string[] {
  const names: string[] = [];
  const sourceNode = importNode.childForFieldName("source") ?? importNode.childForFieldName("module_specifier");
  for (let i = 0; i < importNode.childCount; i++) {
    const c = importNode.child(i);
    if (!c || c === sourceNode) continue;
    if (c.type === "identifier" && /^[\w$]+$/.test(getNodeText(source, c))) {
      names.push(getNodeText(source, c));
    } else if (c.type === "named_imports" || c.type === "import_clause") {
      const ids = findNodesByType(c, "identifier");
      for (const id of ids) names.push(getNodeText(source, id));
    } else if (c.type === "shorthand_property_identifier_pattern" || c.type === "property_identifier") {
      names.push(getNodeText(source, c));
    }
  }
  return [...new Set(names)];
}

/** Extrae nombres de props desde un object_pattern o pattern (params de componente React). */
function extractPropsFromPattern(
  src: string,
  paramNode: Parser.SyntaxNode
): PropInfo[] {
  const props: PropInfo[] = [];
  let target: Parser.SyntaxNode | null = paramNode;
  if (paramNode.type === "pattern" && paramNode.childCount > 0) target = paramNode.child(0);
  if (target && target.type !== "object_pattern") {
    const nested = findNodesByType(paramNode, "object_pattern")[0];
    if (nested) target = nested;
  }
  if (target && target.type === "object_pattern") {
    for (let i = 0; i < target.childCount; i++) {
      const child = target.child(i);
      if (!child) continue;
      if (child.type === "pair") {
        const key = child.childForFieldName("key") ?? child.childForFieldName("value");
        if (key) {
          const name = getNodeText(src, key).replace(/:.*$/, "").trim();
          if (/^[\w$]+$/.test(name)) props.push({ name, required: false });
        }
      } else if (
        child.type === "shorthand_property_identifier" ||
        child.type === "shorthand_property_identifier_pattern" ||
        child.type === "identifier"
      ) {
        const name = getNodeText(src, child);
        if (name !== "undefined" && /^[\w$]+$/.test(name))
          props.push({ name, required: false });
      }
    }
  }
  return props;
}

/** Rellena propsByComponent desde PropTypes.checkPropTypes / object con shape (propTypes). */
function collectPropTypes(
  root: Parser.SyntaxNode,
  source: string,
  componentNames: Set<string>,
  propsByComponent: Record<string, PropInfo[]>
): void {
  const assignNodes = findNodesByType(root, "assignment_expression");
  for (const node of assignNodes) {
    const left = node.childForFieldName("left");
    if (!left || left.type !== "member_expression") continue;
    const obj = left.childForFieldName("object");
    const prop = left.childForFieldName("property");
    if (!obj || !prop) continue;
    const compName = getNodeText(source, obj);
    const propName = getNodeText(source, prop);
    if (!componentNames.has(compName) || propName !== "propTypes") continue;
    const right = node.childForFieldName("right");
    if (!right || right.type !== "object") continue;
    const required = new Set<string>();
    const optional = new Set<string>();
    for (let i = 0; i < right.childCount; i++) {
      const pair = right.child(i);
      if (!pair || pair.type !== "pair") continue;
      const keyNode = pair.childForFieldName("key") ?? pair.child(0);
      const valueNode = pair.childForFieldName("value") ?? pair.child(1);
      if (!keyNode) continue;
      const key = getNodeText(source, keyNode).replace(/^['"]|['"]$/g, "");
      const valueText = valueNode ? getNodeText(source, valueNode) : "";
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
