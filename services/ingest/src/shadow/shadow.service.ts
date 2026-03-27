/**
 * @fileoverview Indexa archivos en un grafo FalkorDB por sesión (namespace shadow) para compare SDD.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { FalkorDB } from 'falkordb';
import { getFalkorConfig, shadowGraphNameForSession } from '../pipeline/falkor';
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
   * Parsea e indexa los archivos en un grafo shadow por sesión (`FalkorSpecsShadow:<shadowSessionId>`).
   * @param {ShadowFile[]} files - Array de { path, content } (código propuesto).
   * @param {{ shadowSessionId?: string }} [opts] - Opcional: reutilizar namespace; si no se pasa, se genera UUID.
   * @returns {Promise<{ ok: boolean; indexed: number; statements: number; shadowSessionId: string; shadowGraphName: string }>}
   */
  async indexShadow(
    files: ShadowFile[],
    opts?: { shadowSessionId?: string },
  ): Promise<{
    ok: boolean;
    indexed: number;
    statements: number;
    shadowSessionId: string;
    shadowGraphName: string;
  }> {
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

    const rawSession = opts?.shadowSessionId?.trim();
    const shadowSessionId = rawSession && rawSession.length > 0 ? rawSession : randomUUID();
    let shadowGraphName: string;
    try {
      shadowGraphName = shadowGraphNameForSession(shadowSessionId);
    } catch {
      throw new BadRequestException({ error: 'invalid shadowSessionId' });
    }

    const config = getFalkorConfig();
    const client = await FalkorDB.connect({
      socket: { host: config.host, port: config.port },
    });
    try {
      const graph = client.selectGraph(shadowGraphName);
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
      return {
        ok: true,
        indexed: files.length,
        statements: allStatements.length,
        shadowSessionId,
        shadowGraphName,
      };
    } finally {
      await client.close();
    }
  }
}
