/**
 * @fileoverview Indexa archivos en grafo FalkorSpecsShadow para compare SDD.
 */
import { Injectable } from '@nestjs/common';
import { FalkorDB } from 'falkordb';
import { getFalkorConfig } from '../pipeline/falkor';
import { SHADOW_GRAPH_NAME } from '../pipeline/falkor';
import { parseSource } from '../pipeline/parser';
import {
  buildCypherForFile,
  resolveCrossFileCalls,
  resolveImportPath,
  runCypherBatch,
} from '../pipeline/producer';
import { buildProjectMergeCypher } from '../pipeline/project';
import { buildCypherForPrismaSchema } from '../pipeline/prisma-extract';
import { loadTsconfigPathsFromShadowFiles } from '../pipeline/tsconfig-resolve';
import { chunkMarkdown } from '../pipeline/markdown-chunk';
import { buildCypherForMarkdownFile } from '../pipeline/markdown-graph';
import type { ParsedFile } from '../pipeline/parser';

const SHADOW_PROJECT_ID = '00000000-0000-0000-0000-000000000000';

/** Archivo a indexar en shadow (path + contenido). */
export interface ShadowFile {
  path: string;
  content: string;
}

/** Indexa archivos en FalkorSpecsShadow para compare de props (SDD). */
@Injectable()
export class ShadowService {
  /**
   * Parsea e indexa los archivos en el grafo FalkorSpecsShadow para compare SDD.
   * @param {ShadowFile[]} files - Array de { path, content } (código propuesto).
   * @returns {Promise<{ ok: boolean; indexed: number; statements: number }>} ok, número de archivos indexados y sentencias Cypher ejecutadas.
   */
  async indexShadow(files: ShadowFile[]): Promise<{ ok: boolean; indexed: number; statements: number }> {
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error('body.files array required');
    }
    const norm = (p: string) => p.replace(/\\/g, '/');
    const pathSet = new Set(files.map((f) => norm(f.path)));
    const parsedByPath = new Map<string, ParsedFile>();
    const prismaFiles: { path: string; content: string }[] = [];
    const markdownFiles: { path: string; content: string }[] = [];
    for (const { path, content } of files) {
      const p = norm(path);
      if (p.toLowerCase().endsWith('.prisma')) {
        prismaFiles.push({ path: p, content });
        continue;
      }
      if (p.toLowerCase().endsWith('.md')) {
        markdownFiles.push({ path: p, content });
        continue;
      }
      const out = parseSource(p, content);
      const parsed = out && 'root' in out ? out.parsed : out;
      if (parsed) parsedByPath.set(p, { ...parsed, path: p });
    }
    const parsedFiles = Array.from(parsedByPath.values());
    const tsconfigPaths = loadTsconfigPathsFromShadowFiles(files.map((f) => ({ path: norm(f.path), content: f.content })));
    const resolveOpts = tsconfigPaths ? { tsconfig: tsconfigPaths, prefix: '' } : { prefix: '' };
    const resolvePath = (from: string, spec: string) =>
      resolveImportPath(norm(from), spec, pathSet, resolveOpts);
    const resolvedCalls = resolveCrossFileCalls(parsedFiles, pathSet, resolvePath);

    const allStatements: string[] = [];
    for (const parsed of parsedFiles) {
      const resolvedImports: string[] = [];
      for (const imp of parsed.imports) {
        const r = resolvePath(parsed.path, imp.specifier);
        if (r) resolvedImports.push(r);
      }
      const callsForFile = resolvedCalls.filter((rc) => rc.callerPath === parsed.path);
      const statements = buildCypherForFile(
        parsed,
        resolvedImports,
        pathSet,
        callsForFile,
        SHADOW_PROJECT_ID,
        SHADOW_PROJECT_ID,
      );
      allStatements.push(...statements);
    }
    for (const pf of prismaFiles) {
      const st = await buildCypherForPrismaSchema(pf.path, pf.content, SHADOW_PROJECT_ID, SHADOW_PROJECT_ID);
      allStatements.push(...st);
    }
    for (const mf of markdownFiles) {
      const chunks = chunkMarkdown(mf.content);
      const st = buildCypherForMarkdownFile(mf.path, chunks, SHADOW_PROJECT_ID, SHADOW_PROJECT_ID);
      allStatements.push(...st);
    }

    const config = getFalkorConfig();
    const client = await FalkorDB.connect({
      socket: { host: config.host, port: config.port },
    });
    try {
      const graph = client.selectGraph(SHADOW_GRAPH_NAME);
      const graphClient = { query: (cypher: string) => graph.query(cypher) };
      await graphClient.query('MATCH (n) DETACH DELETE n');
      await graph.query(
        buildProjectMergeCypher({
          projectId: SHADOW_PROJECT_ID,
          projectName: 'Shadow',
          rootPath: '',
        }),
      );
      await runCypherBatch(graphClient, allStatements);
      return { ok: true, indexed: files.length, statements: allStatements.length };
    } finally {
      await client.close();
    }
  }
}
