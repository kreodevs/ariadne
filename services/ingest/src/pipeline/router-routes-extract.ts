/**
 * @fileoverview Extracción de rutas front: TanStack Router, React Router data APIs y landing heurístico.
 */
import Parser from 'tree-sitter';
import type { RouteInfo } from './parser';
import { isPublicEntryRoute } from './react-route-public-entry';

export type RouteDefSource = 'tanstack' | 'browser-router' | 'landing-heuristic';

/** Definición de ruta antes de resolver paths relativos / padres. */
export interface PendingRouteDef {
  exportName: string;
  path: string;
  componentName: string;
  parentExportName?: string;
  filePath: string;
  source: RouteDefSource;
  isPublicEntry?: boolean;
}

function getNodeText(source: string, node: Parser.SyntaxNode): string {
  return source.slice(node.startIndex, node.endIndex);
}

function findNodesByType(root: Parser.SyntaxNode, type: string): Parser.SyntaxNode[] {
  const out: Parser.SyntaxNode[] = [];
  const walk = (n: Parser.SyntaxNode) => {
    if (n.type === type) out.push(n);
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) walk(c);
    }
  };
  walk(root);
  return out;
}

function unquoteString(raw: string): string {
  const t = raw.trim();
  if (
    (t.startsWith("'") && t.endsWith("'")) ||
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith('`') && t.endsWith('`'))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function getObjectPropertyValue(
  obj: Parser.SyntaxNode,
  key: string,
  source: string,
): Parser.SyntaxNode | undefined {
  for (const pair of findNodesByType(obj, 'pair')) {
    const keyNode = pair.childForFieldName('key') ?? pair.namedChild(0);
    if (!keyNode) continue;
    const keyText = getNodeText(source, keyNode).replace(/^['"]|['"]$/g, '');
    if (keyText !== key) continue;
    return pair.childForFieldName('value') ?? pair.namedChild(1) ?? undefined;
  }
  return undefined;
}

function stringFromValueNode(valueNode: Parser.SyntaxNode, source: string): string | undefined {
  if (valueNode.type === 'string') {
    return unquoteString(getNodeText(source, valueNode));
  }
  if (valueNode.type === 'template_string') {
    const text = getNodeText(source, valueNode);
    if (!text.includes('${')) return unquoteString(text.replace(/^`|`$/g, ''));
  }
  return undefined;
}

function componentFromValueNode(valueNode: Parser.SyntaxNode, source: string): string | undefined {
  if (valueNode.type === 'identifier') {
    const name = getNodeText(source, valueNode);
    return /^[A-Z][\w$]*$/.test(name) ? name : undefined;
  }
  if (valueNode.type === 'arrow_function' || valueNode.type === 'function') {
    const body = valueNode.childForFieldName('body');
    if (!body) return undefined;
    if (body.type === 'identifier') {
      const name = getNodeText(source, body);
      return /^[A-Z][\w$]*$/.test(name) ? name : undefined;
    }
    if (body.type === 'call_expression') {
      const callee = body.childForFieldName('function') ?? body.childForFieldName('callee');
      if (callee?.type === 'identifier') {
        const name = getNodeText(source, callee);
        return /^[A-Z][\w$]*$/.test(name) ? name : undefined;
      }
    }
  }
  if (valueNode.type === 'jsx_self_closing_element') {
    const nameNode = valueNode.childForFieldName('name');
    const name = nameNode ? getNodeText(source, nameNode) : '';
    return /^[A-Z][\w$]*$/.test(name) ? name : undefined;
  }
  if (valueNode.type === 'jsx_element') {
    const open = valueNode.childForFieldName('open_tag') ?? valueNode.firstChild;
    const nameNode = open?.childForFieldName('name') ?? open?.firstNamedChild;
    const name = nameNode ? getNodeText(source, nameNode) : '';
    return /^[A-Z][\w$]*$/.test(name) ? name : undefined;
  }
  return undefined;
}

function parentExportFromGetParentRoute(valueNode: Parser.SyntaxNode, source: string): string | undefined {
  if (valueNode.type !== 'arrow_function' && valueNode.type !== 'function') return undefined;
  const body = valueNode.childForFieldName('body');
  if (!body) return undefined;
  if (body.type === 'identifier') return getNodeText(source, body);
  if (body.type === 'call_expression') {
    const callee = body.childForFieldName('function') ?? body.childForFieldName('callee');
    if (callee?.type === 'identifier') return getNodeText(source, callee);
  }
  return undefined;
}

function exportNameFromDeclarator(declarator: Parser.SyntaxNode, source: string): string | undefined {
  const nameNode = declarator.childForFieldName('name');
  if (!nameNode) return undefined;
  const raw = getNodeText(source, nameNode);
  return /^[\w$]+$/.test(raw) ? raw : undefined;
}

function firstCallArgument(call: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
  const args = call.childForFieldName('arguments');
  if (!args) return undefined;
  for (let i = 0; i < args.namedChildCount; i++) {
    const child = args.namedChild(i);
    if (child) return child;
  }
  return undefined;
}

function parseCreateRouteCall(
  call: Parser.SyntaxNode,
  exportName: string,
  filePath: string,
  source: string,
): PendingRouteDef | null {
  const callee = call.childForFieldName('function') ?? call.childForFieldName('callee');
  if (!callee || getNodeText(source, callee) !== 'createRoute') return null;
  const obj = firstCallArgument(call);
  if (!obj || obj.type !== 'object') return null;

  const pathValue = getObjectPropertyValue(obj, 'path', source);
  const path = pathValue ? stringFromValueNode(pathValue, source) : undefined;
  if (!path) return null;

  const componentValue = getObjectPropertyValue(obj, 'component', source);
  const componentName = componentValue ? componentFromValueNode(componentValue, source) : undefined;
  if (!componentName) return null;

  const parentValue = getObjectPropertyValue(obj, 'getParentRoute', source);
  const parentExportName = parentValue ? parentExportFromGetParentRoute(parentValue, source) : undefined;

  const fullPath = path.startsWith('/') ? path : undefined;
  const isPublic = isPublicEntryRoute(fullPath ?? path) || isPublicEntryRoute(path);

  return {
    exportName,
    path,
    componentName,
    parentExportName,
    filePath,
    source: 'tanstack',
    ...(isPublic ? { isPublicEntry: true } : {}),
  };
}

function collectCreateRouteCalls(
  root: Parser.SyntaxNode,
  filePath: string,
  source: string,
  out: PendingRouteDef[],
): void {
  const seen = new Set<string>();
  for (const call of findNodesByType(root, 'call_expression')) {
    let exportName: string | undefined;
    const parent = call.parent;
    if (parent?.type === 'variable_declarator') {
      exportName = exportNameFromDeclarator(parent, source);
    } else if (parent?.type === 'assignment_expression') {
      const left = parent.childForFieldName('left');
      if (left?.type === 'identifier') exportName = getNodeText(source, left);
    }
    if (!exportName) continue;
    const def = parseCreateRouteCall(call, exportName, filePath, source);
    if (!def || seen.has(def.exportName)) continue;
    seen.add(def.exportName);
    out.push(def);
  }
}

function collectBrowserRouterRoutes(
  root: Parser.SyntaxNode,
  filePath: string,
  source: string,
  out: PendingRouteDef[],
): void {
  for (const call of findNodesByType(root, 'call_expression')) {
    const callee = call.childForFieldName('function') ?? call.childForFieldName('callee');
    const calleeName = callee ? getNodeText(source, callee) : '';
    if (calleeName !== 'createBrowserRouter' && calleeName !== 'createHashRouter') continue;
    const arr = firstCallArgument(call);
    if (!arr || arr.type !== 'array') continue;
    let idx = 0;
    for (let i = 0; i < arr.namedChildCount; i++) {
      const child = arr.namedChild(i);
      if (!child || child.type !== 'object') continue;
      const pathValue = getObjectPropertyValue(child, 'path', source);
      const path = pathValue ? stringFromValueNode(pathValue, source) : undefined;
      if (!path) continue;
      const elementValue =
        getObjectPropertyValue(child, 'element', source) ??
        getObjectPropertyValue(child, 'Component', source);
      const componentName = elementValue ? componentFromValueNode(elementValue, source) : undefined;
      if (!componentName) continue;
      const exportName = `browser_route_${idx++}`;
      out.push({
        exportName,
        path,
        componentName,
        filePath,
        source: 'browser-router',
        ...(isPublicEntryRoute(path) ? { isPublicEntry: true } : {}),
      });
    }
  }
}

/** Rutas estáticas en `App.tsx` con comparaciones `pathname === '/foo'`. */
function collectLandingPathRoutes(
  root: Parser.SyntaxNode,
  filePath: string,
  source: string,
  out: PendingRouteDef[],
): void {
  if (!/\/App\.tsx$/i.test(filePath.replace(/\\/g, '/'))) return;
  const pathLiterals = new Set<string>();
  const binaryOps = findNodesByType(root, 'binary_expression');
  for (const bin of binaryOps) {
    const op = bin.childForFieldName('operator');
    if (!op || getNodeText(source, op) !== '===') continue;
    const left = bin.childForFieldName('left');
    const right = bin.childForFieldName('right');
    for (const side of [left, right]) {
      if (!side) continue;
      const text = getNodeText(source, side);
      if (/pathname|location\.path/i.test(text)) continue;
      const lit = stringFromValueNode(side, source) ?? (side.type === 'string' ? unquoteString(text) : undefined);
      if (lit && lit.startsWith('/')) pathLiterals.add(lit);
    }
  }
  let idx = 0;
  for (const path of [...pathLiterals].sort()) {
    out.push({
      exportName: `landing_route_${idx++}`,
      path,
      componentName: 'App',
      filePath,
      source: 'landing-heuristic',
      ...(isPublicEntryRoute(path) ? { isPublicEntry: true } : {}),
    });
  }
}

/** Extrae definiciones de ruta pendientes de resolver (TanStack, browser router, landing). */
export function extractPendingRouteDefs(
  root: Parser.SyntaxNode,
  filePath: string,
  source: string,
): PendingRouteDef[] {
  const out: PendingRouteDef[] = [];
  collectCreateRouteCalls(root, filePath, source, out);
  collectBrowserRouterRoutes(root, filePath, source, out);
  collectLandingPathRoutes(root, filePath, source, out);
  return out;
}

function appPrefix(filePath: string): string | null {
  const norm = filePath.replace(/\\/g, '/');
  const m = /^apps\/([^/]+)/.exec(norm);
  return m ? `apps/${m[1]}` : null;
}

function findParentDef(
  parentExportName: string,
  childFilePath: string,
  defs: PendingRouteDef[],
): PendingRouteDef | undefined {
  const candidates = defs.filter((d) => d.exportName === parentExportName);
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  const prefix = appPrefix(childFilePath);
  if (prefix) {
    const sameApp = candidates.filter((d) => d.filePath.replace(/\\/g, '/').startsWith(prefix));
    if (sameApp.length === 1) return sameApp[0];
    if (sameApp.length > 0) return sameApp[0];
  }
  return candidates[0];
}

function joinRoutePaths(parentFull: string, childPath: string): string {
  if (childPath.startsWith('/')) return childPath.replace(/\/+/g, '/');
  const base = parentFull.replace(/\/$/, '') || '';
  return `${base}/${childPath}`.replace(/\/+/g, '/');
}

function resolveFullPath(
  def: PendingRouteDef,
  defs: PendingRouteDef[],
  visiting: Set<string> = new Set(),
): string {
  if (def.path.startsWith('/')) return def.path;
  if (!def.parentExportName) return `/${def.path}`;
  if (visiting.has(def.exportName)) return `/${def.path}`;
  visiting.add(def.exportName);
  const parent = findParentDef(def.parentExportName, def.filePath, defs);
  if (!parent) return `/${def.path}`;
  const parentFull = resolveFullPath(parent, defs, visiting);
  return joinRoutePaths(parentFull, def.path);
}

function groupResolvedRoutesByFile(defs: PendingRouteDef[]): Map<string, RouteInfo[]> {
  const byFile = new Map<string, RouteInfo[]>();
  const seenPaths = new Set<string>();

  for (const def of defs) {
    const fullPath = resolveFullPath(def, defs);
    if (seenPaths.has(fullPath)) continue;
    seenPaths.add(fullPath);
    const route: RouteInfo = {
      path: fullPath,
      componentName: def.componentName,
      ...(def.isPublicEntry ? { isPublicEntry: true } : {}),
      routeSource: def.source,
      routeExportName: def.exportName,
    };
    const list = byFile.get(def.filePath) ?? [];
    list.push(route);
    byFile.set(def.filePath, list);
  }

  return byFile;
}

/** Resuelve paths relativos TanStack y convierte a `RouteInfo` listos para Falkor. */
export function resolvePendingRoutesToRouteInfo(defs: PendingRouteDef[]): RouteInfo[] {
  return [...groupResolvedRoutesByFile(defs).values()].flat();
}

/** Fusiona rutas resueltas en `ParsedFile.routes` (sin duplicar path). */
export function enrichParsedFilesWithRouterRoutes(
  parsedFiles: Array<{ path: string; routes: RouteInfo[]; pendingRouteDefs?: PendingRouteDef[] }>,
): void {
  const allDefs = parsedFiles.flatMap((p) => p.pendingRouteDefs ?? []);
  if (allDefs.length === 0) return;
  const grouped = groupResolvedRoutesByFile(allDefs);
  for (const parsed of parsedFiles) {
    const extra = grouped.get(parsed.path) ?? [];
    const seen = new Set(parsed.routes.map((r) => r.path));
    for (const route of extra) {
      if (seen.has(route.path)) continue;
      parsed.routes.push(route);
      seen.add(route.path);
    }
  }
}
