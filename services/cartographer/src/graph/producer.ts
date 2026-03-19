/**
 * @fileoverview Transforma resultados de archivos parseados en operaciones Cypher MERGE y las ejecuta contra FalkorDB. Idempotente.
 */

import {
  cypherSafe,
  buildExportsMap,
  resolveCrossFileCalls,
  runCypherBatch,
  type GraphClient,
  type ResolvedCallInfo,
} from "ariadne-common";
import type { ParsedFile } from "../parser/parser.js";

export type { GraphClient, ResolvedCallInfo } from "ariadne-common";

/**
 * Resuelve un specifier de import a una ruta de archivo existente. Solo se resuelven specifiers relativos (que empiezan con .).
 * @param {string} fromPath - Ruta del archivo que importa.
 * @param {string} specifier - Especificador del import (ej. './utils', '../hooks').
 * @param {Set<string>} existingPaths - Conjunto de rutas de archivos existentes en el scan.
 * @returns {string | null} Ruta resuelta o null si es node_modules, absoluto o no resuelto.
 */
export function resolveImportPath(
  fromPath: string,
  specifier: string,
  existingPaths: Set<string>
): string | null {
  if (specifier.startsWith(".")) {
    const base = fromPath.slice(0, fromPath.lastIndexOf("/") + 1);
    const joined = (base + specifier).replace(/\/+/g, "/").replace(/\/\.\//g, "/");
    const candidates = [
      joined,
      joined + ".js",
      joined + ".jsx",
      joined + ".ts",
      joined + ".tsx",
      joined + "/index.js",
      joined + "/index.jsx",
      joined + "/index.ts",
      joined + "/index.tsx",
    ];
    for (const c of candidates) {
      const normalized = c.replace(/\/index\.(js|jsx|ts|tsx)$/, "");
      const withIndex = [normalized + ".js", normalized + ".jsx", normalized + ".ts", normalized + ".tsx"];
      for (const p of withIndex) {
        if (existingPaths.has(p)) return p;
      }
      if (existingPaths.has(c)) return c;
    }
  }
  return null;
}

/** Re-export para callers que importan desde producer. */
export { buildExportsMap, resolveCrossFileCalls } from "ariadne-common";

/**
 * Genera las sentencias Cypher MERGE para un archivo parseado (File, CONTAINS, IMPORTS, CALLS, etc.).
 * @param {ParsedFile} parsed - Archivo parseado (path, components, functions, imports, etc.).
 * @param {string[]} resolvedImportPaths - Rutas de archivos importados ya resueltas.
 * @param {Set<string>} allFilePaths - Conjunto de todas las rutas del proyecto.
 * @param {ResolvedCallInfo[]} [resolvedCalls] - Llamadas entre archivos resueltas (opcional).
 * @param {string} projectId - ID del proyecto en el grafo.
 * @returns {string[]} Lista de sentencias Cypher (MERGE/ MATCH MERGE).
 */
export function buildCypherForFile(
  parsed: ParsedFile,
  resolvedImportPaths: string[],
  allFilePaths: Set<string>,
  resolvedCalls: ResolvedCallInfo[] = [],
  projectId: string
): string[] {
  const path = parsed.path;
  const ext = path.slice(path.lastIndexOf(".")) || ".js";
  const now = new Date().toISOString();
  const statements: string[] = [];
  const pid = cypherSafe(projectId);

  // MERGE File (idempotent, update lastScan)
  statements.push(
    `MERGE (f:File {path: ${cypherSafe(path)}, projectId: ${pid}}) ON CREATE SET f.extension = ${cypherSafe(ext)}, f.lastScan = ${cypherSafe(now)} ON MATCH SET f.extension = ${cypherSafe(ext)}, f.lastScan = ${cypherSafe(now)}`
  );
  // (Project)-[:CONTAINS]->(File)
  statements.push(
    `MATCH (p:Project {projectId: ${pid}}) MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}}) MERGE (p)-[:CONTAINS]->(f)`
  );

  for (const c of parsed.components) {
    statements.push(
      `MERGE (c:Component {name: ${cypherSafe(c.name)}, projectId: ${pid}}) ON CREATE SET c.type = ${cypherSafe(c.type)}, c.isLegacy = ${c.isLegacy} ON MATCH SET c.type = ${cypherSafe(c.type)}, c.isLegacy = ${c.isLegacy}`
    );
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}}) MATCH (comp:Component {name: ${cypherSafe(c.name)}, projectId: ${pid}}) MERGE (f)-[:CONTAINS]->(comp)`
    );

    for (const h of parsed.hooksUsed) {
      statements.push(`MERGE (h:Hook {name: ${cypherSafe(h.name)}, projectId: ${pid}})`);
      statements.push(
        `MATCH (comp:Component {name: ${cypherSafe(c.name)}, projectId: ${pid}}) MATCH (h:Hook {name: ${cypherSafe(h.name)}, projectId: ${pid}}) MERGE (comp)-[:USES_HOOK]->(h)`
      );
    }

    for (const r of parsed.renders) {
      statements.push(
        `MERGE (child:Component {name: ${cypherSafe(r.componentName)}, projectId: ${pid}})`
      );
      statements.push(
        `MATCH (parent:Component {name: ${cypherSafe(c.name)}, projectId: ${pid}}) MATCH (child:Component {name: ${cypherSafe(r.componentName)}, projectId: ${pid}}) MERGE (parent)-[:RENDERS]->(child)`
      );
    }
    const props = parsed.propsByComponent?.[c.name];
    if (props?.length) {
      for (const p of props) {
        statements.push(
          `MERGE (p:Prop {name: ${cypherSafe(p.name)}, componentName: ${cypherSafe(c.name)}, projectId: ${pid}}) SET p.required = ${p.required}`
        );
        statements.push(
          `MATCH (comp:Component {name: ${cypherSafe(c.name)}, projectId: ${pid}}) MATCH (p:Prop {name: ${cypherSafe(p.name)}, componentName: ${cypherSafe(c.name)}, projectId: ${pid}}) MERGE (comp)-[:HAS_PROP]->(p)`
        );
      }
    }
  }

  for (const targetPath of resolvedImportPaths) {
    if (!allFilePaths.has(targetPath)) continue;
    if (targetPath === path) continue;
    statements.push(`MERGE (b:File {path: ${cypherSafe(targetPath)}, projectId: ${pid}})`);
    statements.push(
      `MATCH (a:File {path: ${cypherSafe(path)}, projectId: ${pid}}) MATCH (b:File {path: ${cypherSafe(targetPath)}, projectId: ${pid}}) MERGE (a)-[:IMPORTS]->(b)`
    );
  }

  // Function nodes (path + name) and File CONTAINS Function
  for (const fn of parsed.functions ?? []) {
    statements.push(
      `MERGE (fn:Function {path: ${cypherSafe(path)}, name: ${cypherSafe(fn.name)}, projectId: ${pid}})`
    );
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}}) MATCH (fn:Function {path: ${cypherSafe(path)}, name: ${cypherSafe(fn.name)}, projectId: ${pid}}) MERGE (f)-[:CONTAINS]->(fn)`
    );
  }
  // CALLS between functions in the same file (caller -> callee)
  for (const call of parsed.calls ?? []) {
    statements.push(
      `MATCH (caller:Function {path: ${cypherSafe(path)}, name: ${cypherSafe(call.caller)}, projectId: ${pid}}) MATCH (callee:Function {path: ${cypherSafe(path)}, name: ${cypherSafe(call.callee)}, projectId: ${pid}}) MERGE (caller)-[:CALLS]->(callee)`
    );
  }
  // CALLS cross-file (only emit from caller's file)
  for (const rc of resolvedCalls) {
    if (rc.callerPath !== path) continue;
    statements.push(`MERGE (callee:Function {path: ${cypherSafe(rc.calleePath)}, name: ${cypherSafe(rc.calleeName)}, projectId: ${pid}})`);
    statements.push(
      `MATCH (caller:Function {path: ${cypherSafe(rc.callerPath)}, name: ${cypherSafe(rc.callerName)}, projectId: ${pid}}) MATCH (callee:Function {path: ${cypherSafe(rc.calleePath)}, name: ${cypherSafe(rc.calleeName)}, projectId: ${pid}}) MERGE (caller)-[:CALLS]->(callee)`
    );
  }

  for (const c of parsed.nestControllers ?? []) {
    statements.push(
      `MERGE (c:NestController {path: ${cypherSafe(path)}, name: ${cypherSafe(c.name)}, projectId: ${pid}}) ON CREATE SET c.route = ${c.route != null ? cypherSafe(c.route) : "null"} ON MATCH SET c.route = ${c.route != null ? cypherSafe(c.route) : "null"}`
    );
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}}) MATCH (c:NestController {path: ${cypherSafe(path)}, name: ${cypherSafe(c.name)}, projectId: ${pid}}) MERGE (f)-[:CONTAINS]->(c)`
    );
  }
  for (const s of parsed.nestServices ?? []) {
    statements.push(`MERGE (s:NestService {path: ${cypherSafe(path)}, name: ${cypherSafe(s.name)}, projectId: ${pid}})`);
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}}) MATCH (s:NestService {path: ${cypherSafe(path)}, name: ${cypherSafe(s.name)}, projectId: ${pid}}) MERGE (f)-[:CONTAINS]->(s)`
    );
  }
  for (const mod of parsed.nestModules ?? []) {
    statements.push(`MERGE (n:NestModule {path: ${cypherSafe(path)}, name: ${cypherSafe(mod.name)}, projectId: ${pid}})`);
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}}) MATCH (n:NestModule {path: ${cypherSafe(path)}, name: ${cypherSafe(mod.name)}, projectId: ${pid}}) MERGE (f)-[:CONTAINS]->(n)`
    );
    for (const cName of mod.controllers) {
      statements.push(
        `MATCH (m:NestModule {path: ${cypherSafe(path)}, name: ${cypherSafe(mod.name)}, projectId: ${pid}}) MATCH (c:NestController {path: ${cypherSafe(path)}, name: ${cypherSafe(cName)}, projectId: ${pid}}) MERGE (m)-[:DECLARES]->(c)`
      );
    }
    for (const pName of mod.providers) {
      statements.push(
        `MATCH (m:NestModule {path: ${cypherSafe(path)}, name: ${cypherSafe(mod.name)}, projectId: ${pid}}) MATCH (s:NestService {path: ${cypherSafe(path)}, name: ${cypherSafe(pName)}, projectId: ${pid}}) MERGE (m)-[:DECLARES]->(s)`
      );
    }
  }

  for (const ct of parsed.strapiContentTypes ?? []) {
    statements.push(`MERGE (ct:StrapiContentType {path: ${cypherSafe(path)}, name: ${cypherSafe(ct.name)}, projectId: ${pid}})`);
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}}) MATCH (ct:StrapiContentType {path: ${cypherSafe(path)}, name: ${cypherSafe(ct.name)}, projectId: ${pid}}) MERGE (f)-[:CONTAINS]->(ct)`
    );
  }
  for (const c of parsed.strapiControllers ?? []) {
    const apiName = c.apiName != null ? cypherSafe(c.apiName) : "null";
    statements.push(
      `MERGE (c:StrapiController {path: ${cypherSafe(path)}, name: ${cypherSafe(c.name)}, projectId: ${pid}}) ON CREATE SET c.apiName = ${apiName} ON MATCH SET c.apiName = ${apiName}`
    );
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}}) MATCH (c:StrapiController {path: ${cypherSafe(path)}, name: ${cypherSafe(c.name)}, projectId: ${pid}}) MERGE (f)-[:CONTAINS]->(c)`
    );
  }
  for (const s of parsed.strapiServices ?? []) {
    const apiName = s.apiName != null ? cypherSafe(s.apiName) : "null";
    statements.push(
      `MERGE (s:StrapiService {path: ${cypherSafe(path)}, name: ${cypherSafe(s.name)}, projectId: ${pid}}) ON CREATE SET s.apiName = ${apiName} ON MATCH SET s.apiName = ${apiName}`
    );
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}}) MATCH (s:StrapiService {path: ${cypherSafe(path)}, name: ${cypherSafe(s.name)}, projectId: ${pid}}) MERGE (f)-[:CONTAINS]->(s)`
    );
  }

  return statements;
}

/** Re-export; cartographer usa batch size 0 (todas de una vez) por defecto. */
export { runCypherBatch } from "ariadne-common";
