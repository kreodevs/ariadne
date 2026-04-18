/**
 * @fileoverview Cypher para :System, :Container, PART_OF (File), COMMUNICATES_WITH (roll-up).
 */
import { cypherSafe } from 'ariadne-common';
import type { C4InfrastructureSpec } from './c4-infrastructure';

export interface C4IngestBatch {
  /** Limpia aristas C4 previas del repo */
  cleanup: string[];
  /** MERGE System + Container + relación a Project */
  merge: string[];
  /** Vincula Files a Container por prefijo de ruta */
  linkFiles: string[];
  /** Roll-up IMPORTS y CALLS → COMMUNICATES_WITH */
  rollupImports: string;
  rollupCalls: string;
}

function pidRid(projectId: string, repoId: string) {
  return { pid: cypherSafe(projectId), rid: cypherSafe(repoId) };
}

/**
 * Genera el batch Cypher completo para un (projectId, repoId).
 */
export function buildC4IngestCypher(spec: C4InfrastructureSpec, projectId: string, repoId: string): C4IngestBatch {
  const { pid, rid } = pidRid(projectId, repoId);
  const sysName = cypherSafe(spec.systemName);
  const now = cypherSafe(new Date().toISOString());

  const cleanup: string[] = [
    `MATCH (f:File {projectId: ${pid}, repoId: ${rid}})-[r:PART_OF]->(:Container) DELETE r`,
    `MATCH (a:Container {projectId: ${pid}, repoId: ${rid}})-[r:COMMUNICATES_WITH]->(b:Container {projectId: ${pid}, repoId: ${rid}}) DELETE r`,
  ];

  const merge: string[] = [
    `MERGE (s:System {projectId: ${pid}, repoId: ${rid}}) ON CREATE SET s.name = ${sysName}, s.lastC4Scan = ${now} ON MATCH SET s.name = ${sysName}, s.lastC4Scan = ${now}`,
    `MATCH (p:Project {projectId: ${pid}}) MATCH (s:System {projectId: ${pid}, repoId: ${rid}}) MERGE (p)-[:HAS_C4_SYSTEM]->(s)`,
  ];

  for (const c of spec.containers) {
    const key = cypherSafe(c.key);
    const name = cypherSafe(c.name);
    const tech = cypherSafe(c.technology ?? '');
    const kind = cypherSafe(c.c4Kind);
    merge.push(
      `MERGE (ct:Container {projectId: ${pid}, repoId: ${rid}, key: ${key}}) ON CREATE SET ct.name = ${name}, ct.technology = ${tech}, ct.c4Kind = ${kind} ON MATCH SET ct.name = ${name}, ct.technology = ${tech}, ct.c4Kind = ${kind}`,
    );
    merge.push(
      `MATCH (s:System {projectId: ${pid}, repoId: ${rid}}) MATCH (ct:Container {projectId: ${pid}, repoId: ${rid}, key: ${key}}) MERGE (s)-[:HAS_CONTAINER]->(ct)`,
    );
  }

  const linkFiles: string[] = [];
  const sorted = [...spec.containers].sort((a, b) => {
    const maxA = Math.max(0, ...a.pathPrefixes.map((p) => p.length));
    const maxB = Math.max(0, ...b.pathPrefixes.map((p) => p.length));
    return maxB - maxA;
  });

  for (const c of sorted) {
    const key = cypherSafe(c.key);
    if (c.pathPrefixes.length === 0) continue;
    for (const prefix of c.pathPrefixes) {
      const pre = cypherSafe(prefix);
      linkFiles.push(
        `MATCH (f:File {projectId: ${pid}, repoId: ${rid}}) WHERE f.path STARTS WITH ${pre} AND NOT (f)-[:PART_OF]->(:Container {projectId: ${pid}, repoId: ${rid}}) ` +
          `MATCH (ct:Container {projectId: ${pid}, repoId: ${rid}, key: ${key}}) MERGE (f)-[:PART_OF]->(ct)`,
      );
    }
  }

  const catchall =
    spec.containers.find((c) => c.key === '_unassigned') ?? spec.containers.find((c) => c.key === 'application');
  if (catchall) {
    const key = cypherSafe(catchall.key);
    linkFiles.push(
      `MATCH (f:File {projectId: ${pid}, repoId: ${rid}}) WHERE NOT (f)-[:PART_OF]->(:Container {projectId: ${pid}, repoId: ${rid}}) ` +
        `MATCH (ct:Container {projectId: ${pid}, repoId: ${rid}, key: ${key}}) MERGE (f)-[:PART_OF]->(ct)`,
    );
  }

  const rollupImports =
    `MATCH (f1:File {projectId: ${pid}, repoId: ${rid}})-[:IMPORTS]->(f2:File {projectId: ${pid}, repoId: ${rid}}) ` +
    `MATCH (f1)-[:PART_OF]->(c1:Container {projectId: ${pid}, repoId: ${rid}}), (f2)-[:PART_OF]->(c2:Container {projectId: ${pid}, repoId: ${rid}}) ` +
    `WHERE c1.key <> c2.key ` +
    `MERGE (c1)-[r:COMMUNICATES_WITH]->(c2) SET r.reason = 'imports'`;

  const rollupCalls =
    `MATCH (fn1:Function {projectId: ${pid}, repoId: ${rid}})-[:CALLS]->(fn2:Function {projectId: ${pid}, repoId: ${rid}}) ` +
    `MATCH (f1:File {projectId: ${pid}, repoId: ${rid}})-[:CONTAINS]->(fn1), (f2:File {projectId: ${pid}, repoId: ${rid}})-[:CONTAINS]->(fn2) ` +
    `MATCH (f1)-[:PART_OF]->(c1:Container {projectId: ${pid}, repoId: ${rid}}), (f2)-[:PART_OF]->(c2:Container {projectId: ${pid}, repoId: ${rid}}) ` +
    `WHERE c1.key <> c2.key ` +
    `MERGE (c1)-[r:COMMUNICATES_WITH]->(c2) SET r.reason = 'calls'`;

  return { cleanup, merge, linkFiles, rollupImports, rollupCalls };
}
