import dagre from '@dagrejs/dagre';
import type { GraphEdge, GraphNode } from './componentGraphFlow';
import { filterValidEdges } from './componentGraphFlow';

const NODE_W = 240;
const NODE_H = 150;

/**
 * Layout en capas (TB): consumidores legacy arriba, foco al centro, dependientes abajo.
 * Dagre recibe aristas orientadas: depends = foco→hijo, legacy = consumidor→foco.
 */
export function layoutWithDagre(
  graphNodes: GraphNode[],
  graphEdges: GraphEdge[],
  focalId: string | null,
): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  if (graphNodes.length === 0) return pos;

  const validEdges = filterValidEdges(graphNodes, graphEdges);
  const g = new dagre.graphlib.Graph({ compound: false }).setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: 'TB',
    ranksep: 72,
    nodesep: 48,
    marginx: 24,
    marginy: 24,
  });

  for (const n of graphNodes) {
    g.setNode(n.id, { width: NODE_W, height: NODE_H });
  }

  const seenLayout = new Set<string>();
  for (const e of validEdges) {
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
    const k = `${e.source}|${e.target}`;
    if (seenLayout.has(k)) continue;
    seenLayout.add(k);
    g.setEdge(e.source, e.target);
  }

  try {
    dagre.layout(g);
  } catch {
    return fallbackGrid(graphNodes);
  }

  for (const n of graphNodes) {
    const nd = g.node(n.id);
    if (nd && typeof nd.x === 'number' && typeof nd.y === 'number') {
      pos.set(n.id, { x: nd.x - NODE_W / 2, y: nd.y - NODE_H / 2 });
    }
  }

  if (focalId && pos.has(focalId)) {
    const fp = pos.get(focalId)!;
    for (const id of [...pos.keys()]) {
      const p = pos.get(id)!;
      pos.set(id, { x: p.x - fp.x, y: p.y - fp.y });
    }
  } else if (focalId && !pos.has(focalId)) {
    /* focal sin coordenadas dagre */
    pos.set(focalId, { x: 0, y: 0 });
  }

  for (const n of graphNodes) {
    if (!pos.has(n.id)) {
      pos.set(n.id, { x: (Math.random() - 0.5) * 120, y: (Math.random() - 0.5) * 120 });
    }
  }

  return pos;
}

function fallbackGrid(graphNodes: GraphNode[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const cols = Math.ceil(Math.sqrt(graphNodes.length));
  graphNodes.forEach((n, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    pos.set(n.id, { x: col * 280 - (cols * 280) / 2, y: row * 200 });
  });
  return pos;
}
