/**
 * Construye Cypher desde ParsedFile y ejecuta batch contra FalkorDB.
 * Incluye MERGE para File, Component, Function, Route, IMPORTS, CALLS, etc.
 * @module pipeline/producer
 */

import {
  cypherSafe,
  buildExportsMap,
  resolveCrossFileCalls,
  runCypherBatch,
  type GraphClient,
  type ResolvedCallInfo,
} from 'ariadne-common';
import type { ParsedFile } from './parser';
import type { TsconfigPaths } from './tsconfig-resolve';
import { resolveWithTsconfig } from './tsconfig-resolve';
import type { StorybookDocumentationExtract } from './storybook-documentation';
import { STORYBOOK_MAX_EMBED_CHARS } from './storybook-documentation';
import { importInfosToStorybookBindings, isStorybookStoriesPath } from './storybook-csf-ast';

export type { GraphClient } from 'ariadne-common';

/** Candidatos de extensión para resolver imports sin extensión. */
const EXT_CANDIDATES = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '/index.ts',
  '/index.tsx',
  '/index.js',
  '/index.jsx',
  '/index.mjs',
  '/index.cjs',
];

function tryResolve(basePath: string, existingPaths: Set<string>): string | null {
  const normalized = basePath.replace(/\/index\.(js|jsx|ts|tsx)$/, '');
  const variants = [
    basePath,
    ...EXT_CANDIDATES.map((ext) => basePath + ext),
    ...EXT_CANDIDATES.map((ext) => normalized + ext),
  ];
  for (const p of variants) {
    if (existingPaths.has(p)) return p;
  }
  return null;
}

/** Une prefijo `@Controller('a')` y segmento `@Get('b')` en path tipo Nest (`/a/b`). */
function nestHttpFullPath(controllerRoute: string | null | undefined, routeSegment: string | undefined): string {
  const prefixParts = (controllerRoute ?? '').split('/').filter(Boolean);
  const segParts = routeSegment !== undefined ? routeSegment.split('/').filter(Boolean) : [];
  const parts = [...prefixParts, ...segParts];
  return parts.length ? `/${parts.join('/')}` : '/';
}

/** Resuelve alias @/ y @/* al path (p. ej. @/models/X -> {prefix}/src/models/X). */
function resolvePathAlias(specifier: string, fromPath: string): string[] {
  if (!specifier.startsWith('@/') && !specifier.startsWith('@')) return [];
  const suffix = specifier.startsWith('@/') ? specifier.slice(2) : specifier.slice(1);
  const parts = fromPath.split('/');
  const srcIdx = parts.indexOf('src');
  const root =
    srcIdx >= 0
      ? parts.slice(0, srcIdx).join('/') + '/'
      : parts.length > 1
        ? parts[0] + '/'
        : '';
  return [
    root + 'src/' + suffix,
    root + suffix,
    root + 'lib/' + suffix,
    root + 'app/' + suffix,
  ].filter(Boolean);
}

export interface ResolveImportPathOptions {
  tsconfig?: TsconfigPaths | null;
  /** Prefijo del repo (ej. "repo-slug/") para paths resueltos desde tsconfig */
  prefix?: string;
}

/**
 * Resuelve una ruta de import (./foo, @/models/foo) contra el conjunto de paths existentes.
 * Soporta: relativos, alias @/, y paths de tsconfig si se provee.
 */
export function resolveImportPath(
  fromPath: string,
  specifier: string,
  existingPaths: Set<string>,
  opts?: ResolveImportPathOptions | null,
): string | null {
  if (specifier.startsWith('.')) {
    const base = fromPath.slice(0, fromPath.lastIndexOf('/') + 1);
    const joined = (base + specifier).replace(/\/+/g, '/').replace(/\/\.\//g, '/');
    return tryResolve(joined, existingPaths);
  }

  const prefix = opts?.prefix ?? fromPath.split('/').slice(0, 2).join('/') + '/';

  if (opts?.tsconfig) {
    for (const candidate of resolveWithTsconfig(specifier, opts.tsconfig, prefix)) {
      const r = tryResolve(candidate, existingPaths);
      if (r) return r;
    }
  }

  if (specifier.startsWith('@/') || specifier.startsWith('@')) {
    for (const candidate of resolvePathAlias(specifier, fromPath)) {
      const r = tryResolve(candidate, existingPaths);
      if (r) return r;
    }
  }
  return null;
}

/**
 * Resuelve imports PascalCase del MDX a paths de archivo del repo (misma lógica que IMPORTS).
 * Si hay `storyMetaTargets` (component/of), solo enlaza esos nombres; si no, todos los PascalCase resolubles.
 */
export function collectResolvedStorybookTargets(
  docPath: string,
  sb: StorybookDocumentationExtract,
  existingPaths: Set<string>,
  opts?: ResolveImportPathOptions | null,
): Array<{ localName: string; targetPath: string }> {
  const out: Array<{ localName: string; targetPath: string }> = [];
  const seen = new Set<string>();
  const primary = new Set(sb.storyMetaTargets);
  const expandAllPascal = primary.size === 0;

  for (const b of sb.importBindings) {
    if (!/^[A-Z]/.test(b.localName)) continue;
    if (!expandAllPascal && !primary.has(b.localName)) continue;
    const resolved = resolveImportPath(docPath, b.specifier, existingPaths, opts);
    if (!resolved) continue;
    const key = `${b.localName}\0${resolved}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ localName: b.localName, targetPath: resolved });
  }
  return out;
}

/** Re-export para callers que importan desde producer. */
export { buildExportsMap, resolveCrossFileCalls } from 'ariadne-common';

export interface ChunkingContext {
  /** Commit SHA for webhook bridge and traceability */
  commitSha?: string | null;
}

/**
 * Genera las sentencias Cypher (MERGE) para un archivo parseado.
 * Path debe ser relativo al repo. Todos los nodos llevan projectId y repoId (multi-root).
 * @param parsed - Resultado del parser (parsed.path = path relativo al repo)
 * @param resolvedImportPaths - Paths resueltos de los imports (mismo repo, relativos)
 * @param allFilePaths - Todos los paths del repo en este sync
 * @param resolvedCalls - Llamadas cross-file resueltas
 * @param projectId - ID del proyecto (Project.id o repo.id si 1:1)
 * @param repoId - ID del repositorio (Repository.id)
 * @param context - commitSha opcional
 * @riskScore 95 — Lógica crítica del grafo; cambios afectan sync, webhooks, shadow. Probar con repo real.
 */
export function buildCypherForFile(
  parsed: ParsedFile,
  resolvedImportPaths: string[],
  allFilePaths: Set<string>,
  resolvedCalls: ResolvedCallInfo[] = [],
  projectId: string,
  repoId: string,
  context?: ChunkingContext,
  importResolveOpts?: ResolveImportPathOptions | null,
): string[] {
  const path = parsed.path;
  const ext = path.slice(path.lastIndexOf('.')) || '.js';
  const now = new Date().toISOString();
  const statements: string[] = [];
  const pid = cypherSafe(projectId);
  const rid = cypherSafe(repoId);

  const commitShaProp =
    context?.commitSha != null ? `, f.commitSha = ${cypherSafe(context.commitSha)}` : '';
  const fileRoleProp =
    parsed.fileRole != null ? `, f.fileRole = ${cypherSafe(parsed.fileRole)}` : '';
  statements.push(
    `MERGE (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) ON CREATE SET f.extension = ${cypherSafe(ext)}, f.lastScan = ${cypherSafe(now)}${commitShaProp}${fileRoleProp} ON MATCH SET f.extension = ${cypherSafe(ext)}, f.lastScan = ${cypherSafe(now)}${commitShaProp}${fileRoleProp}`,
  );
  statements.push(
    `MATCH (p:Project {projectId: ${pid}}) MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MERGE (p)-[:CONTAINS]->(f)`,
  );

  for (const c of parsed.components) {
    const descProp =
      c.description != null && c.description.trim()
        ? `, c.description = ${cypherSafe(c.description.trim())}`
        : '';
    statements.push(
      `MERGE (c:Component {name: ${cypherSafe(c.name)}, projectId: ${pid}, repoId: ${rid}}) ON CREATE SET c.type = ${cypherSafe(c.type)}, c.isLegacy = ${c.isLegacy}${descProp} ON MATCH SET c.type = ${cypherSafe(c.type)}, c.isLegacy = ${c.isLegacy}${descProp}`,
    );
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (comp:Component {name: ${cypherSafe(c.name)}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:CONTAINS]->(comp)`,
    );

    for (const h of parsed.hooksUsed) {
      statements.push(`MERGE (h:Hook {name: ${cypherSafe(h.name)}, projectId: ${pid}, repoId: ${rid}})`);
      statements.push(
        `MATCH (comp:Component {name: ${cypherSafe(c.name)}, projectId: ${pid}, repoId: ${rid}}) MATCH (h:Hook {name: ${cypherSafe(h.name)}, projectId: ${pid}, repoId: ${rid}}) MERGE (comp)-[:USES_HOOK]->(h)`,
      );
    }

    for (const r of parsed.renders) {
      statements.push(`MERGE (child:Component {name: ${cypherSafe(r.componentName)}, projectId: ${pid}, repoId: ${rid}})`);
      statements.push(
        `MATCH (parent:Component {name: ${cypherSafe(c.name)}, projectId: ${pid}, repoId: ${rid}}) MATCH (child:Component {name: ${cypherSafe(r.componentName)}, projectId: ${pid}, repoId: ${rid}}) MERGE (parent)-[:RENDERS]->(child)`,
      );
    }
    const props = parsed.propsByComponent?.[c.name];
    if (props?.length) {
      for (const p of props) {
        statements.push(
          `MERGE (p:Prop {name: ${cypherSafe(p.name)}, componentName: ${cypherSafe(c.name)}, projectId: ${pid}, repoId: ${rid}}) SET p.required = ${p.required}`,
        );
        statements.push(
          `MATCH (comp:Component {name: ${cypherSafe(c.name)}, projectId: ${pid}, repoId: ${rid}}) MATCH (p:Prop {name: ${cypherSafe(p.name)}, componentName: ${cypherSafe(c.name)}, projectId: ${pid}, repoId: ${rid}}) MERGE (comp)-[:HAS_PROP]->(p)`,
        );
      }
    }
  }

  /** RENDERS desde `<Route element={<Page/>}/>`: el parser infiere `enclosingComponent`; si no, archivo mono-componente. */
  for (const r of parsed.routes ?? []) {
    const parents: string[] = [];
    if (
      r.enclosingComponent &&
      parsed.components.some((c) => c.name === r.enclosingComponent)
    ) {
      parents.push(r.enclosingComponent);
    } else if (parsed.components.length === 1) {
      parents.push(parsed.components[0]!.name);
    }
    for (const parentName of parents) {
      statements.push(`MERGE (child:Component {name: ${cypherSafe(r.componentName)}, projectId: ${pid}, repoId: ${rid}})`);
      statements.push(
        `MATCH (parent:Component {name: ${cypherSafe(parentName)}, projectId: ${pid}, repoId: ${rid}}) MATCH (child:Component {name: ${cypherSafe(r.componentName)}, projectId: ${pid}, repoId: ${rid}}) MERGE (parent)-[:RENDERS]->(child)`,
      );
    }
  }

  for (const ctx of parsed.contexts ?? []) {
    statements.push(
      `MERGE (ctx:Context {name: ${cypherSafe(ctx.name)}, projectId: ${pid}, repoId: ${rid}})`,
    );
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (ctx:Context {name: ${cypherSafe(ctx.name)}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:CONTAINS]->(ctx)`,
    );
  }

  for (const h of parsed.hooksDefined ?? []) {
    statements.push(`MERGE (h:Hook {name: ${cypherSafe(h.name)}, projectId: ${pid}, repoId: ${rid}})`);
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (h:Hook {name: ${cypherSafe(h.name)}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:CONTAINS]->(h)`,
    );
  }

  for (const r of parsed.routes ?? []) {
    statements.push(
      `MERGE (rt:Route {path: ${cypherSafe(r.path)}, projectId: ${pid}, repoId: ${rid}}) ON CREATE SET rt.componentName = ${cypherSafe(r.componentName)} ON MATCH SET rt.componentName = ${cypherSafe(r.componentName)}`,
    );
    statements.push(
      `MATCH (p:Project {projectId: ${pid}}) MATCH (rt:Route {path: ${cypherSafe(r.path)}, projectId: ${pid}, repoId: ${rid}}) MERGE (p)-[:HAS_ROUTE]->(rt)`,
    );
  }

  for (const m of parsed.models ?? []) {
    const sets: string[] = [];
    if (m.source) sets.push(`m.source = ${cypherSafe(m.source)}`);
    if (m.entityFields?.length) {
      sets.push(`m.fieldSummary = ${cypherSafe(JSON.stringify(m.entityFields.slice(0, 120)))}`);
    }
    if (m.description?.trim()) sets.push(`m.description = ${cypherSafe(m.description.trim())}`);
    const sm = sets.length ? ` ON CREATE SET ${sets.join(', ')} ON MATCH SET ${sets.join(', ')}` : '';
    statements.push(
      `MERGE (m:Model {path: ${cypherSafe(path)}, name: ${cypherSafe(m.name)}, projectId: ${pid}, repoId: ${rid}})${sm}`,
    );
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (m:Model {path: ${cypherSafe(path)}, name: ${cypherSafe(m.name)}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:CONTAINS]->(m)`,
    );
  }

  for (const targetPath of resolvedImportPaths) {
    if (!allFilePaths.has(targetPath)) continue;
    if (targetPath === path) continue;
    statements.push(`MERGE (b:File {path: ${cypherSafe(targetPath)}, projectId: ${pid}, repoId: ${rid}})`);
    statements.push(
      `MATCH (a:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (b:File {path: ${cypherSafe(targetPath)}, projectId: ${pid}, repoId: ${rid}}) MERGE (a)-[:IMPORTS]->(b)`,
    );
  }

  for (const fn of parsed.functions ?? []) {
    const onCreateSets: string[] = [];
    const onMatchSets: string[] = [];
    if (fn.lineRange) {
      const loc = fn.lineRange.end - fn.lineRange.start + 1;
      onCreateSets.push(`fn.startLine = ${fn.lineRange.start}`, `fn.endLine = ${fn.lineRange.end}`, `fn.loc = ${loc}`);
      onMatchSets.push(`fn.startLine = ${fn.lineRange.start}`, `fn.endLine = ${fn.lineRange.end}`, `fn.loc = ${loc}`);
    }
    if (fn.complexity != null && fn.complexity > 0) {
      onCreateSets.push(`fn.complexity = ${fn.complexity}`);
      onMatchSets.push(`fn.complexity = ${fn.complexity}`);
    }
    if (fn.nestingDepth != null && fn.nestingDepth >= 0) {
      onCreateSets.push(`fn.nestingDepth = ${fn.nestingDepth}`);
      onMatchSets.push(`fn.nestingDepth = ${fn.nestingDepth}`);
    }
    if (context?.commitSha != null) {
      onCreateSets.push(`fn.commitSha = ${cypherSafe(context.commitSha)}`);
      onMatchSets.push(`fn.commitSha = ${cypherSafe(context.commitSha)}`);
    }
    if (fn.description != null && fn.description.trim()) {
      onCreateSets.push(`fn.description = ${cypherSafe(fn.description.trim())}`);
      onMatchSets.push(`fn.description = ${cypherSafe(fn.description.trim())}`);
    }
    if (fn.endpointCalls?.length) {
      const json = cypherSafe(JSON.stringify(fn.endpointCalls));
      onCreateSets.push(`fn.endpointCalls = ${json}`);
      onMatchSets.push(`fn.endpointCalls = ${json}`);
    }
    const onCreate =
      onCreateSets.length > 0 ? ` ON CREATE SET ${onCreateSets.join(', ')}` : '';
    const onMatch =
      onMatchSets.length > 0 ? ` ON MATCH SET ${onMatchSets.join(', ')}` : '';
    statements.push(
      `MERGE (fn:Function {path: ${cypherSafe(path)}, name: ${cypherSafe(fn.name)}, projectId: ${pid}, repoId: ${rid}})${onCreate}${onMatch}`,
    );
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (fn:Function {path: ${cypherSafe(path)}, name: ${cypherSafe(fn.name)}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:CONTAINS]->(fn)`,
    );
  }
  for (const call of parsed.calls ?? []) {
    statements.push(
      `MATCH (caller:Function {path: ${cypherSafe(path)}, name: ${cypherSafe(call.caller)}, projectId: ${pid}, repoId: ${rid}}) MATCH (callee:Function {path: ${cypherSafe(path)}, name: ${cypherSafe(call.callee)}, projectId: ${pid}, repoId: ${rid}}) MERGE (caller)-[:CALLS]->(callee)`,
    );
  }

  for (const rc of resolvedCalls) {
    if (rc.callerPath !== path) continue;
    statements.push(`MERGE (callee:Function {path: ${cypherSafe(rc.calleePath)}, name: ${cypherSafe(rc.calleeName)}, projectId: ${pid}, repoId: ${rid}})`);
    statements.push(
      `MATCH (caller:Function {path: ${cypherSafe(rc.callerPath)}, name: ${cypherSafe(rc.callerName)}, projectId: ${pid}, repoId: ${rid}}) MATCH (callee:Function {path: ${cypherSafe(rc.calleePath)}, name: ${cypherSafe(rc.calleeName)}, projectId: ${pid}, repoId: ${rid}}) MERGE (caller)-[:CALLS]->(callee)`,
    );
  }

  for (const c of parsed.nestControllers ?? []) {
    statements.push(
      `MERGE (c:NestController {path: ${cypherSafe(path)}, name: ${cypherSafe(c.name)}, projectId: ${pid}, repoId: ${rid}}) ON CREATE SET c.route = ${c.route != null ? cypherSafe(c.route) : 'null'} ON MATCH SET c.route = ${c.route != null ? cypherSafe(c.route) : 'null'}`,
    );
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (c:NestController {path: ${cypherSafe(path)}, name: ${cypherSafe(c.name)}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:CONTAINS]->(c)`,
    );
    for (const role of c.roles ?? []) {
      const roleSafe = cypherSafe(role);
      statements.push(
        `MERGE (ar:AccessRole {name: ${roleSafe}, projectId: ${pid}, repoId: ${rid}})`,
      );
      statements.push(
        `MATCH (nc:NestController {path: ${cypherSafe(path)}, name: ${cypherSafe(c.name)}, projectId: ${pid}, repoId: ${rid}}) MATCH (ar:AccessRole {name: ${roleSafe}, projectId: ${pid}, repoId: ${rid}}) MERGE (nc)-[:ALLOWS_ACCESS_ROLE]->(ar)`,
      );
    }
  }

  const controllerRouteByName = new Map<string, string | undefined>();
  for (const c of parsed.nestControllers ?? []) {
    controllerRouteByName.set(c.name, c.route);
  }
  for (const rt of parsed.nestHttpRoutes ?? []) {
    const fullPath = nestHttpFullPath(controllerRouteByName.get(rt.controllerName), rt.routeSegment);
    const segProp = rt.routeSegment !== undefined ? cypherSafe(rt.routeSegment) : 'null';
    const fp = cypherSafe(fullPath);
    statements.push(
      `MERGE (nr:NestRoute {path: ${cypherSafe(path)}, controllerName: ${cypherSafe(rt.controllerName)}, handlerName: ${cypherSafe(rt.handlerName)}, projectId: ${pid}, repoId: ${rid}}) ON CREATE SET nr.httpMethod = ${cypherSafe(rt.httpMethod)}, nr.handlerLine = ${rt.handlerLine}, nr.routeSegment = ${segProp}, nr.fullPath = ${fp} ON MATCH SET nr.httpMethod = ${cypherSafe(rt.httpMethod)}, nr.handlerLine = ${rt.handlerLine}, nr.routeSegment = ${segProp}, nr.fullPath = ${fp}`,
    );
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (nr:NestRoute {path: ${cypherSafe(path)}, controllerName: ${cypherSafe(rt.controllerName)}, handlerName: ${cypherSafe(rt.handlerName)}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:CONTAINS]->(nr)`,
    );
    statements.push(
      `MATCH (nc:NestController {path: ${cypherSafe(path)}, name: ${cypherSafe(rt.controllerName)}, projectId: ${pid}, repoId: ${rid}}) MATCH (nr:NestRoute {path: ${cypherSafe(path)}, controllerName: ${cypherSafe(rt.controllerName)}, handlerName: ${cypherSafe(rt.handlerName)}, projectId: ${pid}, repoId: ${rid}}) MERGE (nc)-[:DECLARES_ROUTE]->(nr)`,
    );
    for (const role of rt.roles ?? []) {
      const roleSafe = cypherSafe(role);
      statements.push(`MERGE (ar:AccessRole {name: ${roleSafe}, projectId: ${pid}, repoId: ${rid}})`);
      statements.push(
        `MATCH (nr:NestRoute {path: ${cypherSafe(path)}, controllerName: ${cypherSafe(rt.controllerName)}, handlerName: ${cypherSafe(rt.handlerName)}, projectId: ${pid}, repoId: ${rid}}) MATCH (ar:AccessRole {name: ${roleSafe}, projectId: ${pid}, repoId: ${rid}}) MERGE (nr)-[:REQUIRES_ROLE]->(ar)`,
      );
    }
    for (const gName of rt.guardNames ?? []) {
      const gSafe = cypherSafe(gName);
      statements.push(`MERGE (ng:NestGuard {path: ${cypherSafe(path)}, name: ${gSafe}, projectId: ${pid}, repoId: ${rid}})`);
      statements.push(
        `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (ng:NestGuard {path: ${cypherSafe(path)}, name: ${gSafe}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:CONTAINS]->(ng)`,
      );
      statements.push(
        `MATCH (nr:NestRoute {path: ${cypherSafe(path)}, controllerName: ${cypherSafe(rt.controllerName)}, handlerName: ${cypherSafe(rt.handlerName)}, projectId: ${pid}, repoId: ${rid}}) MATCH (ng:NestGuard {path: ${cypherSafe(path)}, name: ${gSafe}, projectId: ${pid}, repoId: ${rid}}) MERGE (nr)-[:USES_GUARD]->(ng)`,
      );
    }
  }

  for (const s of parsed.nestServices ?? []) {
    statements.push(`MERGE (s:NestService {path: ${cypherSafe(path)}, name: ${cypherSafe(s.name)}, projectId: ${pid}, repoId: ${rid}})`);
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (s:NestService {path: ${cypherSafe(path)}, name: ${cypherSafe(s.name)}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:CONTAINS]->(s)`,
    );
  }
  for (const mod of parsed.nestModules ?? []) {
    statements.push(`MERGE (n:NestModule {path: ${cypherSafe(path)}, name: ${cypherSafe(mod.name)}, projectId: ${pid}, repoId: ${rid}})`);
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (n:NestModule {path: ${cypherSafe(path)}, name: ${cypherSafe(mod.name)}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:CONTAINS]->(n)`,
    );
    for (const cName of mod.controllers) {
      statements.push(
        `MATCH (m:NestModule {path: ${cypherSafe(path)}, name: ${cypherSafe(mod.name)}, projectId: ${pid}, repoId: ${rid}}) MATCH (c:NestController {path: ${cypherSafe(path)}, name: ${cypherSafe(cName)}, projectId: ${pid}, repoId: ${rid}}) MERGE (m)-[:DECLARES]->(c)`,
      );
    }
    for (const pName of mod.providers) {
      statements.push(
        `MATCH (m:NestModule {path: ${cypherSafe(path)}, name: ${cypherSafe(mod.name)}, projectId: ${pid}, repoId: ${rid}}) MATCH (s:NestService {path: ${cypherSafe(path)}, name: ${cypherSafe(pName)}, projectId: ${pid}, repoId: ${rid}}) MERGE (m)-[:DECLARES]->(s)`,
      );
    }
  }

  for (const ct of parsed.strapiContentTypes ?? []) {
    statements.push(
      `MERGE (ct:StrapiContentType {path: ${cypherSafe(path)}, name: ${cypherSafe(ct.name)}, projectId: ${pid}, repoId: ${rid}})`,
    );
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (ct:StrapiContentType {path: ${cypherSafe(path)}, name: ${cypherSafe(ct.name)}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:CONTAINS]->(ct)`,
    );
  }
  for (const c of parsed.strapiControllers ?? []) {
    const apiName = c.apiName != null ? cypherSafe(c.apiName) : 'null';
    statements.push(
      `MERGE (c:StrapiController {path: ${cypherSafe(path)}, name: ${cypherSafe(c.name)}, projectId: ${pid}, repoId: ${rid}}) ON CREATE SET c.apiName = ${apiName} ON MATCH SET c.apiName = ${apiName}`,
    );
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (c:StrapiController {path: ${cypherSafe(path)}, name: ${cypherSafe(c.name)}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:CONTAINS]->(c)`,
    );
  }
  for (const s of parsed.strapiServices ?? []) {
    const apiName = s.apiName != null ? cypherSafe(s.apiName) : 'null';
    statements.push(
      `MERGE (s:StrapiService {path: ${cypherSafe(path)}, name: ${cypherSafe(s.name)}, projectId: ${pid}, repoId: ${rid}}) ON CREATE SET s.apiName = ${apiName} ON MATCH SET s.apiName = ${apiName}`,
    );
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (s:StrapiService {path: ${cypherSafe(path)}, name: ${cypherSafe(s.name)}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:CONTAINS]->(s)`,
    );
  }

  const sb = parsed.storybookDocumentation;
  if (sb) {
    const resolvedTargets = collectResolvedStorybookTargets(path, sb, allFilePaths, importResolveOpts ?? null);
    const appendix =
      resolvedTargets.length > 0
        ? `\n\nResolved import → module path:\n${resolvedTargets.map((r) => `- ${r.localName} → ${r.targetPath}`).join('\n')}`
        : '';
    const enrichedDoc = (sb.bodyForEmbedding + appendix).slice(0, STORYBOOK_MAX_EMBED_CHARS);
    const docText = cypherSafe(enrichedDoc);
    const titleS = cypherSafe(sb.titleHint);
    statements.push(
      `MERGE (sd:StorybookDoc {sourcePath: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) ON CREATE SET sd.title = ${titleS}, sd.documentationText = ${docText} ON MATCH SET sd.title = ${titleS}, sd.documentationText = ${docText}`,
    );
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (sd:StorybookDoc {sourcePath: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:HAS_STORYBOOK_DOC]->(sd)`,
    );
    for (const compName of sb.linkedComponentNames) {
      statements.push(
        `MATCH (sd:StorybookDoc {sourcePath: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (c:Component {name: ${cypherSafe(compName)}, projectId: ${pid}, repoId: ${rid}}) MERGE (sd)-[:STORYBOOK_DESCRIBES]->(c)`,
      );
    }
    for (const { localName, targetPath } of resolvedTargets) {
      statements.push(
        `MERGE (tf:File {path: ${cypherSafe(targetPath)}, projectId: ${pid}, repoId: ${rid}})`,
      );
      statements.push(
        `MATCH (sd:StorybookDoc {sourcePath: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (tf:File {path: ${cypherSafe(targetPath)}, projectId: ${pid}, repoId: ${rid}}) MERGE (sd)-[:STORYBOOK_TARGETS_FILE {binding: ${cypherSafe(localName)}}]->(tf)`,
      );
    }
  }

  if (isStorybookStoriesPath(path)) {
    const bindings = importInfosToStorybookBindings(parsed.imports);
    const csfPayload: StorybookDocumentationExtract = {
      bodyForEmbedding: '',
      titleHint: '',
      linkedComponentNames: [],
      importBindings: bindings,
      storyMetaTargets: parsed.storybookCsf?.storyMetaTargets ?? [],
    };
    const csfResolved = collectResolvedStorybookTargets(
      path,
      csfPayload,
      allFilePaths,
      importResolveOpts ?? null,
    );
    for (const { localName, targetPath } of csfResolved) {
      if (targetPath === path) continue;
      statements.push(
        `MERGE (tf:File {path: ${cypherSafe(targetPath)}, projectId: ${pid}, repoId: ${rid}})`,
      );
      statements.push(
        `MATCH (sf:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (tf:File {path: ${cypherSafe(targetPath)}, projectId: ${pid}, repoId: ${rid}}) MERGE (sf)-[:STORYBOOK_TARGETS_FILE {binding: ${cypherSafe(localName)}}]->(tf)`,
      );
    }
  }

  const pmd = parsed.projectMarkdown;
  if (pmd) {
    const resolvedTargets = collectResolvedStorybookTargets(path, pmd, allFilePaths, importResolveOpts ?? null);
    const appendix =
      resolvedTargets.length > 0
        ? `\n\nResolved import → module path:\n${resolvedTargets.map((r) => `- ${r.localName} → ${r.targetPath}`).join('\n')}`
        : '';
    const enrichedDoc = (pmd.bodyForEmbedding + appendix).slice(0, STORYBOOK_MAX_EMBED_CHARS);
    const docText = cypherSafe(enrichedDoc);
    const titleS = cypherSafe(pmd.titleHint);
    statements.push(
      `MERGE (md:MarkdownDoc {sourcePath: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) ON CREATE SET md.title = ${titleS}, md.documentationText = ${docText} ON MATCH SET md.title = ${titleS}, md.documentationText = ${docText}`,
    );
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (md:MarkdownDoc {sourcePath: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:HAS_MARKDOWN_DOC]->(md)`,
    );
    for (const compName of pmd.linkedComponentNames) {
      statements.push(
        `MATCH (md:MarkdownDoc {sourcePath: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (c:Component {name: ${cypherSafe(compName)}, projectId: ${pid}, repoId: ${rid}}) MERGE (md)-[:MARKDOWN_DESCRIBES]->(c)`,
      );
    }
    for (const { localName, targetPath } of resolvedTargets) {
      statements.push(
        `MERGE (tf:File {path: ${cypherSafe(targetPath)}, projectId: ${pid}, repoId: ${rid}})`,
      );
      statements.push(
        `MATCH (md:MarkdownDoc {sourcePath: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (tf:File {path: ${cypherSafe(targetPath)}, projectId: ${pid}, repoId: ${rid}}) MERGE (md)-[:MARKDOWN_TARGETS_FILE {binding: ${cypherSafe(localName)}}]->(tf)`,
      );
    }
  }

  for (const dc of parsed.domainConcepts ?? []) {
    const descProp = dc.description?.trim() ? `, dc.description = ${cypherSafe(dc.description.trim())}` : '';
    const optionsProp =
      dc.options?.length && dc.options.length <= 50
        ? `, dc.options = ${cypherSafe(JSON.stringify(dc.options))}`
        : '';
    statements.push(
      `MERGE (dc:DomainConcept {name: ${cypherSafe(dc.name)}, projectId: ${pid}, repoId: ${rid}, sourcePath: ${cypherSafe(path)}}) ON CREATE SET dc.category = ${cypherSafe(dc.category)}, dc.sourceRef = ${cypherSafe(dc.sourceRef)}${descProp}${optionsProp} ON MATCH SET dc.category = ${cypherSafe(dc.category)}, dc.sourceRef = ${cypherSafe(dc.sourceRef)}${descProp}${optionsProp}`,
    );
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (dc:DomainConcept {name: ${cypherSafe(dc.name)}, projectId: ${pid}, repoId: ${rid}, sourcePath: ${cypherSafe(path)}}) MERGE (dc)-[:DEFINED_IN]->(f)`,
    );
  }

  return statements;
}

/** Re-export para callers que importan desde producer. */
export { runCypherBatch } from 'ariadne-common';

/** Índices recomendados para File, Function, Component, DomainConcept (projectId, repoId, path, name). */
const FALKOR_INDEXES = [
  'CREATE INDEX FOR (f:File) ON (f.projectId)',
  'CREATE INDEX FOR (f:File) ON (f.projectId, f.repoId)',
  'CREATE INDEX FOR (f:File) ON (f.path)',
  'CREATE INDEX FOR (fn:Function) ON (fn.projectId)',
  'CREATE INDEX FOR (fn:Function) ON (fn.path)',
  'CREATE INDEX FOR (fn:Function) ON (fn.name)',
  'CREATE INDEX FOR (c:Component) ON (c.projectId)',
  'CREATE INDEX FOR (c:Component) ON (c.name)',
  'CREATE INDEX FOR (m:Model) ON (m.projectId)',
  'CREATE INDEX FOR (m:Model) ON (m.projectId, m.repoId)',
  'CREATE INDEX FOR (m:Model) ON (m.name)',
  'CREATE INDEX FOR (e:Enum) ON (e.projectId)',
  'CREATE INDEX FOR (e:Enum) ON (e.projectId, e.repoId)',
  'CREATE INDEX FOR (e:Enum) ON (e.name)',
  'CREATE INDEX FOR (dc:DomainConcept) ON (dc.projectId)',
  'CREATE INDEX FOR (dc:DomainConcept) ON (dc.category)',
  'CREATE INDEX FOR (ctx:Context) ON (ctx.projectId)',
  'CREATE INDEX FOR (ctx:Context) ON (ctx.name)',
  'CREATE INDEX FOR (d:Document) ON (d.projectId)',
  'CREATE INDEX FOR (d:Document) ON (d.path)',
  'CREATE INDEX FOR (sb:StorybookDoc) ON (sb.projectId)',
  'CREATE INDEX FOR (sb:StorybookDoc) ON (sb.projectId, sb.repoId)',
  'CREATE INDEX FOR (sb:StorybookDoc) ON (sb.sourcePath)',
  'CREATE INDEX FOR (md:MarkdownDoc) ON (md.projectId)',
  'CREATE INDEX FOR (md:MarkdownDoc) ON (md.projectId, md.repoId)',
  'CREATE INDEX FOR (md:MarkdownDoc) ON (md.sourcePath)',
  'CREATE INDEX FOR (ar:AccessRole) ON (ar.projectId)',
  'CREATE INDEX FOR (ar:AccessRole) ON (ar.projectId, ar.repoId)',
  'CREATE INDEX FOR (ar:AccessRole) ON (ar.name)',
  'CREATE INDEX FOR (nr:NestRoute) ON (nr.projectId)',
  'CREATE INDEX FOR (nr:NestRoute) ON (nr.projectId, nr.repoId)',
  'CREATE INDEX FOR (nr:NestRoute) ON (nr.fullPath)',
  'CREATE INDEX FOR (ng:NestGuard) ON (ng.projectId)',
  'CREATE INDEX FOR (ng:NestGuard) ON (ng.projectId, ng.repoId)',
  'CREATE INDEX FOR (ng:NestGuard) ON (ng.name)',
];

/**
 * Crea índices FalkorDB si no existen. Ignora errores "already indexed".
 * Invocar al inicio de runFullSync.
 */
export async function ensureFalkorIndexes(client: GraphClient): Promise<void> {
  for (const idx of FALKOR_INDEXES) {
    try {
      await client.query(idx);
    } catch (err) {
      const msg = String(err ?? '');
      if (!/already|exists|indexed|duplicate/i.test(msg)) {
        throw err;
      }
    }
  }
}

/** Etiquetas de nodos que tienen projectId y deben tener repoId (multi-root). */
const REPOID_BACKFILL_LABELS = [
  'File',
  'Component',
  'Function',
  'Route',
  'Model',
  'Enum',
  'NestModule',
  'NestController',
  'NestRoute',
  'NestGuard',
  'NestService',
  'AccessRole',
  'StrapiContentType',
  'StrapiController',
  'StrapiService',
  'DomainConcept',
  'Prop',
  'Hook',
  'Context',
  'Document',
  'StorybookDoc',
  'MarkdownDoc',
];

/**
 * Backfill repoId en nodos indexados antes de multi-root: SET repoId = projectId donde repoId falte.
 * Idempotente; no toca nodos que ya tengan repoId. Ejecutar al arranque del ingest para que no falle
 * hasta que se reindexe todo.
 */
export async function runFalkorRepoIdBackfill(client: GraphClient): Promise<void> {
  for (const label of REPOID_BACKFILL_LABELS) {
    try {
      await client.query(
        `MATCH (n:${label}) WHERE n.projectId IS NOT NULL AND n.repoId IS NULL SET n.repoId = n.projectId`,
      );
    } catch (err) {
      const msg = String(err ?? '');
      if (!/label|Label|does not exist/i.test(msg)) {
        throw err;
      }
    }
  }
}

/**
 * Build Cypher to remove a file and its contained nodes from the graph (orphan cleanup).
 * Path debe ser relativo al repo. Filtra por projectId y repoId (multi-root).
 */
export function buildCypherDeleteFile(relativePath: string, projectId: string, repoId: string): string[] {
  const path = cypherSafe(relativePath);
  const pid = cypherSafe(projectId);
  const rid = cypherSafe(repoId);
  return [
    `MATCH (dc:DomainConcept {sourcePath: ${path}, projectId: ${pid}, repoId: ${rid}})-[:DEFINED_IN]->(:File {path: ${path}, projectId: ${pid}, repoId: ${rid}}) DETACH DELETE dc`,
    `MATCH (d:Document {path: ${path}, projectId: ${pid}, repoId: ${rid}}) DETACH DELETE d`,
    `MATCH (f:File {path: ${path}, projectId: ${pid}, repoId: ${rid}}) OPTIONAL MATCH (f)-[:HAS_STORYBOOK_DOC]->(sd:StorybookDoc) DETACH DELETE sd`,
    `MATCH (f:File {path: ${path}, projectId: ${pid}, repoId: ${rid}}) OPTIONAL MATCH (f)-[:HAS_MARKDOWN_DOC]->(md:MarkdownDoc) DETACH DELETE md`,
    `MATCH (f:File {path: ${path}, projectId: ${pid}, repoId: ${rid}}) OPTIONAL MATCH (f)-[:CONTAINS]->(child) DETACH DELETE child, f`,
  ];
}
