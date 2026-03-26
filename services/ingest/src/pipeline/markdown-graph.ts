/**
 * Cypher para archivos Markdown: File + nodos Document (chunks) y HAS_CHUNK.
 */
import { cypherSafe } from 'ariadne-common';
import type { MarkdownChunk } from './markdown-chunk';

const DOC_KIND = 'markdown';

export function buildCypherForMarkdownFile(
  filePath: string,
  chunks: MarkdownChunk[],
  projectId: string,
  repoId: string,
): string[] {
  const pid = cypherSafe(projectId);
  const rid = cypherSafe(repoId);
  const path = filePath;
  const ext = '.md';
  const now = new Date().toISOString();
  const statements: string[] = [];

  statements.push(
    `MERGE (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) ON CREATE SET f.extension = ${cypherSafe(ext)}, f.lastScan = ${cypherSafe(now)}, f.isDocumentation = true ON MATCH SET f.extension = ${cypherSafe(ext)}, f.lastScan = ${cypherSafe(now)}, f.isDocumentation = true`,
  );
  statements.push(
    `MATCH (p:Project {projectId: ${pid}}) MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MERGE (p)-[:CONTAINS]->(f)`,
  );

  for (const ch of chunks) {
    const text = ch.text.slice(0, 12000);
    const head = ch.heading.slice(0, 200);
    statements.push(
      `MERGE (d:Document {path: ${cypherSafe(path)}, chunkIndex: ${ch.chunkIndex}, projectId: ${pid}, repoId: ${rid}}) ON CREATE SET d.docKind = ${cypherSafe(DOC_KIND)}, d.heading = ${cypherSafe(head)}, d.chunkText = ${cypherSafe(text)} ON MATCH SET d.docKind = ${cypherSafe(DOC_KIND)}, d.heading = ${cypherSafe(head)}, d.chunkText = ${cypherSafe(text)}`,
    );
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (d:Document {path: ${cypherSafe(path)}, chunkIndex: ${ch.chunkIndex}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:HAS_CHUNK]->(d)`,
    );
  }

  return statements;
}
