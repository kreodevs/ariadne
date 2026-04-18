import dagre from '@dagrejs/dagre';
import type { GraphEdge, GraphNode } from './componentGraphFlow';
import {
  COMPONENT_NODE_HEIGHT,
  COMPONENT_NODE_WIDTH,
  filterValidEdges,
} from './componentGraphFlow';

/**
 * Layout en capas (LR): foco a la izquierda, dependientes en columna a la derecha.
 * Con TB + muchos hijos, Dagre ponía todos en una sola fila horizontal (difícil de leer).
 * Aristas: depends = foco→hijo, legacy = consumidor→foco.
 */
export function layoutWithDagre(
  graphNodes: GraphNode[],
  graphEdges: GraphEdge[],
  focalId: string | null,
): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  if (graphNodes.length === 0) return pos;

  const validEdges = filterValidEdges(graphNodes, graphEdges);
  if (validEdges.length === 0 && graphNodes.length > 1) {
    return fallbackGrid(graphNodes);
  }

  const g = new dagre.graphlib.Graph({ compound: false }).setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: 'LR',
    ranksep: 88,
    nodesep: 56,
    marginx: 32,
    marginy: 32,
  });

  for (const n of graphNodes) {
    g.setNode(n.id, { width: COMPONENT_NODE_WIDTH, height: COMPONENT_NODE_HEIGHT });
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
      pos.set(n.id, { x: nd.x - COMPONENT_NODE_WIDTH / 2, y: nd.y - COMPONENT_NODE_HEIGHT / 2 });
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
    pos.set(n.id, {
      x: col * (COMPONENT_NODE_WIDTH + 40) - (cols * (COMPONENT_NODE_WIDTH + 40)) / 2,
      y: row * (COMPONENT_NODE_HEIGHT + 36),
    });
  });
  return pos;
}
