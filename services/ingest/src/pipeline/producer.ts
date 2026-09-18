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
import { resolveTypeOrmTargetName } from './typeorm-schema.util';
import type { TsconfigPaths } from './tsconfig-resolve';
import { resolveWithTsconfig } from './tsconfig-resolve';
import type { StorybookDocumentationExtract } from './storybook-documentation';
import { STORYBOOK_MAX_EMBED_CHARS } from './storybook-documentation';
import { importInfosToStorybookBindings, isStorybookStoriesPath } from './storybook-csf-ast';
import { isNonSourceEvidenceNoisePath } from '../chat/chat-evidence-path-filter';
import { apiNameFromStrapiUid } from './strapi-uid-reference-extract';
import { flowRowsToCypher } from './flow-graph-index';
import type { ParsedFlowDef } from './flow-extract';

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

  if (parsed.flows?.length) {
    const flowRows = parsed.flows.map((fl: ParsedFlowDef) => ({
      flowId: fl.flowId,
      kind: fl.kind,
      label: fl.label,
      description: fl.description ?? '',
      sourcePath: fl.sourcePath,
      payload: fl.payload,
    }));
    statements.push(...flowRowsToCypher(projectId, repoId, flowRows));
  }

  for (const r of parsed.routes ?? []) {
    const publicEntry = r.isPublicEntry ? 'true' : 'false';
    const routeSourceSet = r.routeSource
      ? `, rt.routeSource = ${cypherSafe(r.routeSource)}`
      : '';
    statements.push(
      `MERGE (rt:Route {path: ${cypherSafe(r.path)}, projectId: ${pid}, repoId: ${rid}}) ON CREATE SET rt.componentName = ${cypherSafe(r.componentName)}, rt.isPublicEntry = ${publicEntry}${routeSourceSet} ON MATCH SET rt.componentName = ${cypherSafe(r.componentName)}, rt.isPublicEntry = ${publicEntry}${routeSourceSet}`,
    );
    statements.push(
      `MATCH (p:Project {projectId: ${pid}}) MATCH (rt:Route {path: ${cypherSafe(r.path)}, projectId: ${pid}, repoId: ${rid}}) MERGE (p)-[:HAS_ROUTE]->(rt)`,
    );
    statements.push(
      `MERGE (comp:Component {name: ${cypherSafe(r.componentName)}, projectId: ${pid}, repoId: ${rid}})`,
    );
    statements.push(
      `MATCH (rt:Route {path: ${cypherSafe(r.path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (comp:Component {name: ${cypherSafe(r.componentName)}, projectId: ${pid}, repoId: ${rid}}) MERGE (rt)-[:ROUTE_TO_COMPONENT]->(comp)`,
    );
  }

  for (const m of parsed.models ?? []) {
    const sets: string[] = [];
    if (m.source) sets.push(`m.source = ${cypherSafe(m.source)}`);
    if (m.tableName?.trim()) sets.push(`m.tableName = ${cypherSafe(m.tableName.trim())}`);
    if (m.embeddable) sets.push(`m.embeddable = true`);
    if (m.indexSummary?.trim()) sets.push(`m.indexSummary = ${cypherSafe(m.indexSummary.trim())}`);
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

  const modelNamesInFile = (parsed.models ?? []).map((m) => m.name);
  for (const m of parsed.models ?? []) {
    for (const rel of m.entityRelations ?? []) {
      const targetName =
        resolveTypeOrmTargetName(rel.targetType, modelNamesInFile) ??
        (rel.targetType.endsWith('Entity') ? rel.targetType.slice(0, -6) : rel.targetType);
      const relSets: string[] = [`r.field = ${cypherSafe(rel.field)}`];
      if (rel.relationKind) relSets.push(`r.relationKind = ${cypherSafe(rel.relationKind)}`);
      if (rel.joinColumn?.trim()) relSets.push(`r.joinColumn = ${cypherSafe(rel.joinColumn.trim())}`);
      if (rel.joinTable?.trim()) relSets.push(`r.joinTable = ${cypherSafe(rel.joinTable.trim())}`);
      const relSetClause = relSets.join(', ');
      statements.push(
        `MATCH (a:Model {path: ${cypherSafe(path)}, name: ${cypherSafe(m.name)}, projectId: ${pid}, repoId: ${rid}}) MATCH (b:Model {name: ${cypherSafe(targetName)}, projectId: ${pid}, repoId: ${rid}}) MERGE (a)-[r:RELATES_TO]->(b) ON CREATE SET ${relSetClause} ON MATCH SET ${relSetClause}`,
      );
    }
  }

  for (const asset of parsed.staticAssets ?? []) {
    const detailJson = asset.cssDetail
      ? JSON.stringify(asset.cssDetail)
      : asset.htmlDetail
        ? JSON.stringify(asset.htmlDetail)
        : null;
    const detailProp = detailJson ? `, sa.detailJson = ${cypherSafe(detailJson.slice(0, 8000))}` : '';
    statements.push(
      `MERGE (sa:StaticAsset {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) ON CREATE SET sa.kind = ${cypherSafe(asset.kind)}, sa.summary = ${cypherSafe(asset.summary.slice(0, 4000))}, sa.tokensJson = ${cypherSafe(JSON.stringify(asset.tokens.slice(0, 200)))}${detailProp} ON MATCH SET sa.kind = ${cypherSafe(asset.kind)}, sa.summary = ${cypherSafe(asset.summary.slice(0, 4000))}, sa.tokensJson = ${cypherSafe(JSON.stringify(asset.tokens.slice(0, 200)))}${detailProp}`,
    );
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (sa:StaticAsset {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:CONTAINS]->(sa)`,
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
      `MERGE (nr:NestRoute {path: ${cypherSafe(path)}, controllerName: ${cypherSafe(rt.controllerName)}, handlerName: ${cypherSafe(rt.handlerName)}, projectId: ${pid}, repoId: ${rid}}) ON CREATE SET nr.httpMethod = ${cypherSafe(rt.httpMethod)}, nr.handlerLine = ${rt.handlerLine}, nr.routeSegment = ${segProp}, nr.fullPath = ${fp}${rt.httpStatusCode != null ? `, nr.httpStatusCode = ${rt.httpStatusCode}` : ''} ON MATCH SET nr.httpMethod = ${cypherSafe(rt.httpMethod)}, nr.handlerLine = ${rt.handlerLine}, nr.routeSegment = ${segProp}, nr.fullPath = ${fp}${rt.httpStatusCode != null ? `, nr.httpStatusCode = ${rt.httpStatusCode}` : ''}`,
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
    const displayName = ct.displayName != null ? cypherSafe(ct.displayName) : 'null';
    const collectionName = ct.collectionName != null ? cypherSafe(ct.collectionName) : 'null';
    const kind = ct.kind != null ? cypherSafe(ct.kind) : 'null';
    const apiName = ct.apiName != null ? cypherSafe(ct.apiName) : 'null';
    const attrs =
      ct.attributesSummary != null && ct.attributesSummary.length > 0
        ? cypherSafe(ct.attributesSummary)
        : 'null';
    const strapiUid = ct.strapiUid != null ? cypherSafe(ct.strapiUid) : 'null';
    statements.push(
      `MERGE (ct:StrapiContentType {path: ${cypherSafe(path)}, name: ${cypherSafe(ct.name)}, projectId: ${pid}, repoId: ${rid}}) ON CREATE SET ct.displayName = ${displayName}, ct.collectionName = ${collectionName}, ct.kind = ${kind}, ct.apiName = ${apiName}, ct.attributesSummary = ${attrs}, ct.strapiUid = ${strapiUid} ON MATCH SET ct.displayName = ${displayName}, ct.collectionName = ${collectionName}, ct.kind = ${kind}, ct.apiName = ${apiName}, ct.attributesSummary = ${attrs}, ct.strapiUid = ${strapiUid}`,
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

  for (const rt of parsed.strapiRoutes ?? []) {
    const handler = rt.handler != null ? cypherSafe(rt.handler) : 'null';
    const apiName = rt.apiName != null ? cypherSafe(rt.apiName) : 'null';
    const routeSource = cypherSafe(rt.routeSource);
    const description = rt.description != null ? cypherSafe(rt.description.slice(0, 500)) : 'null';
    const publicRoute = rt.publicRoute ? 'true' : 'false';
    const implicitConsumer =
      rt.routeSource === 'core_router' ? cypherSafe('strapi_admin') : 'null';
    statements.push(
      `MERGE (sr:StrapiRoute {path: ${cypherSafe(path)}, method: ${cypherSafe(rt.method)}, routePath: ${cypherSafe(rt.path)}, projectId: ${pid}, repoId: ${rid}}) ON CREATE SET sr.handler = ${handler}, sr.apiName = ${apiName}, sr.routeSource = ${routeSource}, sr.description = ${description}, sr.publicRoute = ${publicRoute}, sr.implicitConsumer = ${implicitConsumer} ON MATCH SET sr.handler = ${handler}, sr.apiName = ${apiName}, sr.routeSource = ${routeSource}, sr.description = ${description}, sr.publicRoute = ${publicRoute}, sr.implicitConsumer = ${implicitConsumer}`,
    );
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (sr:StrapiRoute {path: ${cypherSafe(path)}, method: ${cypherSafe(rt.method)}, routePath: ${cypherSafe(rt.path)}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:CONTAINS]->(sr)`,
    );
  }

  for (const ref of parsed.apiClientReferences ?? []) {
    statements.push(
      `MERGE (acr:ApiClientReference {apiPath: ${cypherSafe(ref.apiPath)}, normalizedPath: ${cypherSafe(ref.normalizedPath)}, filePath: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) ON CREATE SET acr.isDynamic = ${ref.isDynamic ? 'true' : 'false'} ON MATCH SET acr.isDynamic = ${ref.isDynamic ? 'true' : 'false'}`,
    );
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (acr:ApiClientReference {apiPath: ${cypherSafe(ref.apiPath)}, normalizedPath: ${cypherSafe(ref.normalizedPath)}, filePath: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:REFERENCES_API]->(acr)`,
    );
  }

  for (const ext of parsed.externalApiReferences ?? []) {
    statements.push(
      `MERGE (ear:ExternalApiReference {baseUrl: ${cypherSafe(ext.baseUrl)}, apiPath: ${cypherSafe(ext.apiPath)}, normalizedPath: ${cypherSafe(ext.normalizedPath)}, filePath: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) ON CREATE SET ear.service = ${cypherSafe(ext.service)}, ear.isDynamic = ${ext.isDynamic ? 'true' : 'false'} ON MATCH SET ear.service = ${cypherSafe(ext.service)}, ear.isDynamic = ${ext.isDynamic ? 'true' : 'false'}`,
    );
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (ear:ExternalApiReference {baseUrl: ${cypherSafe(ext.baseUrl)}, apiPath: ${cypherSafe(ext.apiPath)}, normalizedPath: ${cypherSafe(ext.normalizedPath)}, filePath: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:REFERENCES_EXTERNAL_API]->(ear)`,
    );
  }

  for (const uid of parsed.strapiUidReferences ?? []) {
    const apiNameLit = cypherSafe(apiNameFromStrapiUid(uid) ?? '');
    statements.push(
      `MERGE (uid:StrapiUidReference {uid: ${cypherSafe(uid)}, filePath: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) ON CREATE SET uid.apiName = ${apiNameLit} ON MATCH SET uid.apiName = ${apiNameLit}`,
    );
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (uid:StrapiUidReference {uid: ${cypherSafe(uid)}, filePath: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:REFERENCES_STRAPI_UID]->(uid)`,
    );
  }

  for (const gcr of parsed.graphQlClientReferences ?? []) {
    statements.push(
      `MERGE (gcr:GraphQlClientReference {operationName: ${cypherSafe(gcr.operationName)}, rootField: ${cypherSafe(gcr.rootField)}, filePath: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}})`,
    );
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (gcr:GraphQlClientReference {operationName: ${cypherSafe(gcr.operationName)}, rootField: ${cypherSafe(gcr.rootField)}, filePath: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:REFERENCES_GRAPHQL]->(gcr)`,
    );
  }

  for (const gq of parsed.graphQlQueries ?? []) {
    const desc = gq.description != null ? cypherSafe(gq.description) : 'null';
    const resolverOf = gq.resolverOf != null ? cypherSafe(gq.resolverOf) : 'null';
    const resolverAction = gq.resolverAction != null ? cypherSafe(gq.resolverAction) : 'null';
    statements.push(
      `MERGE (gq:GraphQlQuery {path: ${cypherSafe(path)}, name: ${cypherSafe(gq.name)}, operationKind: ${cypherSafe(gq.operationKind)}, projectId: ${pid}, repoId: ${rid}}) ON CREATE SET gq.apiName = ${cypherSafe(gq.apiName)}, gq.description = ${desc}, gq.resolverOf = ${resolverOf}, gq.resolverAction = ${resolverAction}, gq.implicitConsumer = null ON MATCH SET gq.apiName = ${cypherSafe(gq.apiName)}, gq.description = ${desc}, gq.resolverOf = ${resolverOf}, gq.resolverAction = ${resolverAction}`,
    );
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (gq:GraphQlQuery {path: ${cypherSafe(path)}, name: ${cypherSafe(gq.name)}, operationKind: ${cypherSafe(gq.operationKind)}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:CONTAINS]->(gq)`,
    );
  }

  const normPath = path.replace(/\\/g, '/');
  const lifecycleMatch = normPath.match(
    /\/(?:api|extensions)\/([^/]+)\/content-types\/([^/]+)\/lifecycles\.js$/i,
  );
  if (lifecycleMatch) {
    const schemaPath = normPath.replace(/lifecycles\.js$/i, 'schema.json');
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (ct:StrapiContentType {path: ${cypherSafe(schemaPath)}, name: ${cypherSafe(lifecycleMatch[2]!)}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:LIFECYCLE_OF]->(ct)`,
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
  if (pmd && !isNonSourceEvidenceNoisePath(path)) {
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
  'CREATE INDEX FOR (m:Model) ON (m.source)',
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
  'CREATE INDEX FOR (ct:StrapiContentType) ON (ct.projectId)',
  'CREATE INDEX FOR (ct:StrapiContentType) ON (ct.projectId, ct.repoId)',
  'CREATE INDEX FOR (ct:StrapiContentType) ON (ct.name)',
  'CREATE INDEX FOR (sa:StaticAsset) ON (sa.projectId)',
  'CREATE INDEX FOR (sa:StaticAsset) ON (sa.projectId, sa.repoId)',
  'CREATE INDEX FOR (sa:StaticAsset) ON (sa.path)',
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
  'StrapiRoute',
  'StrapiUidReference',
  'ApiClientReference',
  'ExternalApiReference',
  'GraphQlClientReference',
  'GraphQlQuery',
  'OpenApiOperation',
  'DomainConcept',
  'Prop',
  'Hook',
  'Context',
  'Document',
  'StorybookDoc',
  'MarkdownDoc',
  'StaticAsset',
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
