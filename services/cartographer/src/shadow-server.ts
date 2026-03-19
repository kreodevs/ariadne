/**
 * In-memory shadow indexing: POST /shadow with { files: { path, content }[] }.
 * Clears FalkorSpecsShadow and indexes the given files into it (no filesystem).
 */

import express, { Request, Response } from "express";
import { parseSource } from "./parser/parser.js";
import {
  buildCypherForFile,
  resolveImportPath,
  runCypherBatch,
} from "./graph/producer.js";
import { buildProjectMergeCypher } from "./graph/project.js";

const SHADOW_GRAPH_NAME = "FalkorSpecsShadow";
/** Fixed projectId for ephemeral shadow graph (no filesystem root). */
const SHADOW_PROJECT_ID = "00000000-0000-0000-0000-000000000000";

type GraphClient = { query: (cypher: string) => Promise<unknown> };

export interface ShadowFile {
  path: string;
  content: string;
}

/**
 * Crea una app Express para indexación shadow: POST /shadow con { files: { path, content }[] }.
 * Limpia FalkorSpecsShadow e indexa los archivos en memoria (sin filesystem).
 * @param getShadowGraph - Factory que devuelve el cliente del grafo shadow.
 */
export function createShadowServer(getShadowGraph: () => Promise<GraphClient>) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.post("/shadow", async (req: Request, res: Response) => {
    const files = req.body?.files as ShadowFile[] | undefined;
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "body.files array required" });
    }
    const pathSet = new Set(files.map((f) => f.path));
    const allStatements: string[] = [];
    for (const { path, content } of files) {
      const parsed = parseSource(path, content);
      if (!parsed) continue;
      const resolvedImports: string[] = [];
      for (const imp of parsed.imports) {
        const r = resolveImportPath(path, imp.specifier, pathSet);
        if (r) resolvedImports.push(r);
      }
      const statements = buildCypherForFile(
        parsed,
        resolvedImports,
        pathSet,
        [],
        SHADOW_PROJECT_ID
      );
      allStatements.push(...statements);
    }
    try {
      const graph = await getShadowGraph();
      await graph.query(`MATCH (n) DETACH DELETE n`);
      await graph.query(
        buildProjectMergeCypher({
          projectId: SHADOW_PROJECT_ID,
          projectName: "Shadow",
          rootPath: "",
        })
      );
      await runCypherBatch(graph, allStatements);
      res.json({ ok: true, indexed: files.length, statements: allStatements.length });
    } catch (err) {
      console.error("Shadow index error:", err);
      res.status(500).json({ error: String(err) });
    }
  });

  return app;
}

export { SHADOW_GRAPH_NAME };
