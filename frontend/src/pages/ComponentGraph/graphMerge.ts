import type { GraphEdge, GraphNode } from './componentGraphFlow';

function edgeKey(e: GraphEdge): string {
  return `${e.source}|${e.target}|${e.kind}`;
}

/** Une nodos por `id` (el último gana en campos superpuestos). */
export function mergeGraphNodes(existing: GraphNode[], incoming: GraphNode[]): GraphNode[] {
  const byId = new Map<string, GraphNode>();
  for (const n of existing) byId.set(n.id, { ...n });
  for (const n of incoming) {
    const prev = byId.get(n.id);
    byId.set(n.id, prev ? { ...prev, ...n } : { ...n });
  }
  return [...byId.values()];
}

/** Une aristas sin duplicar (mismo source, target y kind). */
export function mergeGraphEdges(existing: GraphEdge[], incoming: GraphEdge[]): GraphEdge[] {
  const seen = new Set(existing.map(edgeKey));
  const out = [...existing];
  for (const e of incoming) {
    const k = edgeKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}
