import { MarkerType, type Edge } from '@xyflow/react';
import type { ComponentGraphRFNode } from './GraphFlowNode';

export type GraphNode = { id: string; kind: string; name?: string; path?: string };
export type GraphEdge = { source: string; target: string; kind: string };

export function labelFor(n: GraphNode): string {
  if (n.path) return n.path.split('/').pop() || n.path;
  return n.name ?? n.kind;
}

/** Layout en abanico: foco al centro, dependencias a un lado, impacto legacy al otro. */
export function layoutNodes(
  nodes: GraphNode[],
  edges: GraphEdge[],
  centerName: string,
): Map<string, { x: number; y: number }> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const center =
    nodes.find((n) => n.kind === 'Component' && n.name === centerName) ?? nodes[0];
  const centerId = center?.id ?? '';
  const pos = new Map<string, { x: number; y: number }>();
  if (!centerId) return pos;

  const depTargets = edges.filter((e) => e.kind === 'depends' && e.source === centerId).map((e) => e.target);
  const impactSources = edges
    .filter((e) => e.kind === 'legacy_impact' && e.target === centerId)
    .map((e) => e.source);

  pos.set(centerId, { x: 0, y: 0 });

  const placeArc = (ids: string[], startAngle: number, spread: number, radius: number) => {
    if (ids.length === 0) return;
    const step = ids.length === 1 ? 0 : spread / (ids.length - 1);
    ids.forEach((id, i) => {
      const a = startAngle + i * step;
      pos.set(id, { x: radius * Math.cos(a), y: radius * Math.sin(a) });
    });
  };

  placeArc(depTargets, -Math.PI * 0.35, Math.PI * 0.7, 260);
  placeArc(impactSources, Math.PI * 0.65, Math.PI * 0.7, 280);

  for (const n of nodes) {
    if (pos.has(n.id)) continue;
    const x = (Math.random() - 0.5) * 80;
    const y = (Math.random() - 0.5) * 80;
    pos.set(n.id, { x: 420 + x, y: 420 + y });
  }

  void byId;
  return pos;
}

const DEPENDS_STROKE = '#3b82f6';
const LEGACY_STROKE = '#f59e0b';

export function toFlowElements(
  graphNodes: GraphNode[],
  graphEdges: GraphEdge[],
  positions: Map<string, { x: number; y: number }>,
  focalName: string,
): { nodes: ComponentGraphRFNode[]; edges: Edge[] } {
  const nodes: ComponentGraphRFNode[] = graphNodes.map((n) => {
    const pos = positions.get(n.id) ?? { x: 0, y: 0 };
    const isFocal = n.kind === 'Component' && n.name === focalName;
    const lbl = labelFor(n);
    return {
      id: n.id,
      type: 'componentGraph',
      position: pos,
      data: {
        label: lbl,
        kind: n.kind,
        subtitle: n.path && n.path !== lbl ? n.path : undefined,
        isFocal,
      },
    };
  });

  const edges: Edge[] = graphEdges.map((e, i) => {
    const isLegacy = e.kind === 'legacy_impact';
    const stroke = isLegacy ? LEGACY_STROKE : DEPENDS_STROKE;
    return {
      id: `e-${e.source}-${e.target}-${i}`,
      source: e.source,
      target: e.target,
      type: 'smoothstep',
      animated: !isLegacy && e.kind === 'depends',
      style: {
        stroke,
        strokeWidth: isLegacy ? 2 : 1.5,
        ...(isLegacy ? { strokeDasharray: '6 4' } : {}),
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: stroke,
        width: 16,
        height: 16,
      },
    };
  });

  return { nodes, edges };
}
