/**
 * Cartographer: static analysis ingestor. Scans SCAN_PATH, parses with Tree-sitter, persists to FalkorDB.
 * Does not modify source (read-only). Idempotent MERGE.
 * Full scan on startup; if WATCH=true (default in Docker), incremental scan on file add/change.
 */

import { readFile } from "node:fs/promises";
import { FalkorDB } from "falkordb";
import chokidar from "chokidar";
import { discoverFiles, toRelativePath, matchesScanFilter } from "./scanner/scanner.js";
import { parseSource } from "./parser/parser.js";
import {
  buildCypherForFile,
  resolveCrossFileCalls,
  resolveImportPath,
  runCypherBatch,
} from "./graph/producer.js";
import type { ParsedFile } from "./parser/parser.js";
import { getFalkorConfig, graphNameForProject, isProjectShardingEnabled } from "./graph/falkor.js";
import { getProjectInfo, buildProjectMergeCypher } from "./graph/project.js";
import { createShadowServer, SHADOW_GRAPH_NAME } from "./shadow-server.js";

const SCAN_PATH = process.env.SCAN_PATH ?? "/app/src-to-analyze";
const WATCH = process.env.WATCH !== "false";
const DEBOUNCE_MS = 400;

type GraphClient = { query: (cypher: string) => Promise<unknown> };

/** Lee un archivo, parsea, resuelve imports y CALLS, ejecuta Cypher MERGE en el grafo. */
async function indexFile(
  absPath: string,
  pathSet: Set<string>,
  graphClient: GraphClient,
  projectId: string
): Promise<void> {
  const rel = toRelativePath(absPath, SCAN_PATH);
  let source: string;
  try {
    source = await readFile(absPath, "utf-8");
  } catch {
    return;
  }
  const parsed = parseSource(rel, source);
  if (!parsed) return;
  const resolvedImports: string[] = [];
  for (const imp of parsed.imports) {
    const r = resolveImportPath(rel, imp.specifier, pathSet);
    if (r) resolvedImports.push(r);
  }
  const statements = buildCypherForFile(parsed, resolvedImports, pathSet, [], projectId);
  await runCypherBatch(graphClient, statements);
}

/** Descubre archivos en SCAN_PATH, parsea todos, resuelve cross-file calls, y ejecuta Cypher por archivo. Actualiza pathSet. */
async function runFullScan(
  graphClient: GraphClient,
  pathSet: Set<string>,
  projectId: string
): Promise<void> {
  const absolutePaths = await discoverFiles(SCAN_PATH);
  const relativePaths = absolutePaths.map((p) => toRelativePath(p, SCAN_PATH));
  pathSet.clear();
  for (const r of relativePaths) pathSet.add(r);

  const parsedFiles: ParsedFile[] = [];
  for (let i = 0; i < absolutePaths.length; i++) {
    try {
      const source = await readFile(absolutePaths[i], "utf-8");
      const parsed = parseSource(relativePaths[i], source);
      if (parsed) parsedFiles.push(parsed);
    } catch {
      // skip unreadable
    }
  }
  const resolvePath = (from: string, spec: string) =>
    resolveImportPath(from, spec, pathSet);
  const resolvedCalls = resolveCrossFileCalls(parsedFiles, pathSet, resolvePath);

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
      projectId,
    );
    await runCypherBatch(graphClient, statements);
  }
}

/** Conecta a FalkorDB, hace full scan inicial, opcionalmente arranca watcher y shadow server. */
async function main(): Promise<void> {
  const config = getFalkorConfig();
  const client = await FalkorDB.connect({
    socket: { host: config.host, port: config.port },
  });
  const projectInfo = await getProjectInfo(SCAN_PATH);
  const graph = client.selectGraph(
    graphNameForProject(isProjectShardingEnabled() ? projectInfo.projectId : undefined),
  );
  const graphClient = { query: (cypher: string) => graph.query(cypher) };
  const pathSet = new Set<string>();

  await graph.query(buildProjectMergeCypher(projectInfo));
  await runFullScan(graphClient, pathSet, projectInfo.projectId);
  console.log(
    `Cartographer: full scan indexed ${pathSet.size} files into ${graphNameForProject(isProjectShardingEnabled() ? projectInfo.projectId : undefined)} (project ${projectInfo.projectName})`,
  );

  if (!WATCH) {
    await client.close();
    return;
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const pending = new Set<string>();

  const flushPending = async () => {
    debounceTimer = null;
    const paths = Array.from(pending);
    pending.clear();
    for (const abs of paths) {
      try {
        await indexFile(abs, pathSet, graphClient, projectInfo.projectId);
        console.log(`Cartographer: re-indexed ${toRelativePath(abs, SCAN_PATH)}`);
      } catch (err) {
        console.error(`Cartographer: error indexing ${abs}`, err);
      }
    }
  };

  const schedule = (absPath: string) => {
    if (!matchesScanFilter(absPath)) return;
    pending.add(absPath);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flushPending, DEBOUNCE_MS);
  };

  const watcher = chokidar.watch(SCAN_PATH, {
    ignored: (p) => p.includes("node_modules") || p.includes(".git"),
    ignoreInitial: true,
  });

  watcher.on("add", (absPath: string) => {
    const rel = toRelativePath(absPath, SCAN_PATH);
    pathSet.add(rel);
    schedule(absPath);
  });

  watcher.on("change", (absPath: string) => schedule(absPath));

  watcher.on("unlink", (absPath: string) => {
    const rel = toRelativePath(absPath, SCAN_PATH);
    pathSet.delete(rel);
    pending.delete(absPath);
  });

  watcher.on("error", (err) => console.error("Cartographer watcher error:", err));

  console.log("Cartographer: watching for changes (WATCH=true)");

  const shadowPort = process.env.SHADOW_SERVER_PORT;
  if (shadowPort) {
    const shadowGraph = client.selectGraph(SHADOW_GRAPH_NAME);
    const shadowClient: GraphClient = { query: (cypher: string) => shadowGraph.query(cypher) };
    const shadowApp = createShadowServer(() => Promise.resolve(shadowClient));
    shadowApp.listen(Number(shadowPort), () => {
      console.log(`Cartographer: shadow server on port ${shadowPort}`);
    });
  }

  process.on("SIGTERM", () => {
    watcher.close();
    client.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
