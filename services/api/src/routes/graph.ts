import { Router, Request, Response } from "express";
import { getGraph, getShadowGraph } from "../falkor.js";
import {
  cacheGet,
  cacheSet,
  impactCacheKey,
  componentCacheKey,
  contractCacheKey,
  CACHE_TTL,
} from "../cache.js";

export const graphRouter = Router();

/**
 * GET /graph/impact/:nodeId
 * Qué archivos/componentes se verían afectados si se modifica el nodo (función/componente).
 */
graphRouter.get("/impact/:nodeId", async (req: Request, res: Response) => {
  const nodeId = req.params.nodeId;
  if (!nodeId) {
    return res.status(400).json({ error: "nodeId required" });
  }
  const cached = await cacheGet<{ nodeId: string; dependents: unknown[] }>(impactCacheKey(nodeId));
  if (cached) return res.json(cached);
  try {
    const graph = await getGraph();
    const q = `MATCH (n {name: $nodeName})<-[:CALLS|RENDERS*]-(dependent) RETURN dependent.name AS name, labels(dependent) AS labels`;
    const result = (await graph.query(q, { params: { nodeName: nodeId } })) as {
      headers?: string[];
      data?: unknown[][];
    };
    const data = result.data ?? [];
    const headers = result.headers ?? ["name", "labels"];
    const dependents = data.map((row: unknown) => {
      const arr = Array.isArray(row) ? row : [row];
      const nameIdx = headers.indexOf("name");
      const labelsIdx = headers.indexOf("labels");
      return {
        name: nameIdx >= 0 ? arr[nameIdx] : arr[0],
        labels: labelsIdx >= 0 ? arr[labelsIdx] : arr[1],
      };
    });
    const payload = { nodeId, dependents };
    await cacheSet(impactCacheKey(nodeId), payload, CACHE_TTL.impact);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * GET /graph/component/:name?depth=2
 * Dependencias directas e indirectas del componente.
 */
graphRouter.get("/component/:name", async (req: Request, res: Response) => {
  const name = req.params.name;
  const depth = Math.min(10, Math.max(1, parseInt(req.query.depth as string, 10) || 2));
  if (!name) {
    return res.status(400).json({ error: "name required" });
  }
  const cached = await cacheGet<{ componentName: string; depth: number; dependencies: unknown[] }>(
    componentCacheKey(name, depth)
  );
  if (cached) return res.json(cached);
  try {
    const graph = await getGraph();
    const q = `MATCH (c:Component {name: $componentName})-[*1..${depth}]->(dependency) RETURN c, dependency`;
    const result = (await graph.query(q, { params: { componentName: name } })) as {
      headers?: string[];
      data?: unknown[][];
    };
    const data = result.data ?? [];
    const headers = result.headers ?? ["c", "dependency"];
    const depIdx = headers.indexOf("dependency");
    const seen = new Set<string>();
    const dependencies: { name?: string; path?: string }[] = [];
    for (const row of data as unknown[]) {
      const arr = Array.isArray(row) ? row : [row];
      const dep = depIdx >= 0 && arr[depIdx] != null ? arr[depIdx] : arr[1];
      const obj = dep && typeof dep === "object" ? (dep as Record<string, unknown>) : { name: String(dep) };
      const key = String(obj.name ?? obj.path ?? JSON.stringify(obj));
      if (seen.has(key)) continue;
      seen.add(key);
      dependencies.push({ name: obj.name as string, path: obj.path as string });
    }
    const payload = { componentName: name, depth, dependencies };
    await cacheSet(componentCacheKey(name, depth), payload, CACHE_TTL.component);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * GET /graph/contract/:componentName
 * Props y firma del componente (HAS_PROP en FalkorDB).
 */
graphRouter.get("/contract/:componentName", async (req: Request, res: Response) => {
  const componentName = req.params.componentName;
  if (!componentName) {
    return res.status(400).json({ error: "componentName required" });
  }
  const cached = await cacheGet<{ componentName: string; props: { name: string; required: boolean }[] }>(
    contractCacheKey(componentName)
  );
  if (cached) return res.json(cached);
  try {
    const graph = await getGraph();
    const q = `MATCH (c:Component {name: $componentName})-[:HAS_PROP]->(p:Prop) RETURN p.name AS name, p.required AS required`;
    const result = (await graph.query(q, { params: { componentName } })) as {
      headers?: string[];
      data?: unknown[][];
    };
    const data = result.data ?? [];
    const headers = result.headers ?? ["name", "required"];
    const nameIdx = headers.indexOf("name");
    const requiredIdx = headers.indexOf("required");
    const props = data.map((row: unknown) => {
      const arr = Array.isArray(row) ? row : [row];
      return {
        name: (nameIdx >= 0 ? arr[nameIdx] : arr[0]) as string,
        required: requiredIdx >= 0 ? arr[requiredIdx] === true || arr[requiredIdx] === "true" : false,
      };
    });
    const payload = { componentName, props };
    await cacheSet(contractCacheKey(componentName), payload, CACHE_TTL.contract);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

async function getPropsForComponent(
  graph: Awaited<ReturnType<typeof getGraph>>,
  componentName: string
): Promise<{ name: string; required: boolean }[]> {
  const q = `MATCH (c:Component {name: $componentName})-[:HAS_PROP]->(p:Prop) RETURN p.name AS name, p.required AS required`;
  const result = (await graph.query(q, { params: { componentName } })) as {
    headers?: string[];
    data?: unknown[][];
  };
  const data = result.data ?? [];
  const headers = result.headers ?? ["name", "required"];
  const nameIdx = headers.indexOf("name");
  const requiredIdx = headers.indexOf("required");
  return data.map((row: unknown) => {
    const arr = Array.isArray(row) ? row : [row];
    return {
      name: (nameIdx >= 0 ? arr[nameIdx] : arr[0]) as string,
      required: requiredIdx >= 0 ? arr[requiredIdx] === true || arr[requiredIdx] === "true" : false,
    };
  });
}

/**
 * GET /graph/compare/:componentName
 * Compara props del componente en grafo principal vs shadow (tras indexar código propuesto).
 */
graphRouter.get("/compare/:componentName", async (req: Request, res: Response) => {
  const componentName = req.params.componentName;
  if (!componentName) {
    return res.status(400).json({ error: "componentName required" });
  }
  try {
    const [mainGraph, shadowGraph] = await Promise.all([getGraph(), getShadowGraph()]);
    const [mainProps, shadowProps] = await Promise.all([
      getPropsForComponent(mainGraph, componentName),
      getPropsForComponent(shadowGraph, componentName),
    ]);
    const mainSet = new Set(mainProps.map((p) => p.name));
    const shadowSet = new Set(shadowProps.map((p) => p.name));
    const missingInShadow = mainProps.filter((p) => !shadowSet.has(p.name)).map((p) => p.name);
    const extraInShadow = shadowProps.filter((p) => !mainSet.has(p.name)).map((p) => p.name);
    const match = missingInShadow.length === 0 && extraInShadow.length === 0;
    res.json({
      componentName,
      match,
      mainProps,
      shadowProps,
      missingInShadow,
      extraInShadow,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** Shadow indexing: microservicio ingest (POST /shadow). */
const SHADOW_URL = process.env.INGEST_URL ?? "http://ingest:3002";

/**
 * POST /graph/shadow
 * Proxy a Ingest o Cartographer: indexa archivos en AriadneSpecsShadow.
 * Body: { files: [{ path, content }] }.
 */
graphRouter.post("/shadow", async (req: Request, res: Response) => {
  const body = req.body as { files?: { path: string; content: string }[] };
  if (!body?.files || !Array.isArray(body.files)) {
    return res.status(400).json({ error: "body.files array required" });
  }
  try {
    const r = await fetch(`${SHADOW_URL}/shadow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: body.files }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

// Re-export for consumers that need the base URL
export { SHADOW_URL };
