import { MarkerType, type Edge } from '@xyflow/react';
import type { ComponentGraphRFNode, NodeFlowRole } from './GraphFlowNode';

export type GraphNode = { id: string; kind: string; name?: string; path?: string };
export type GraphEdge = { source: string; target: string; kind: string };

/** Evita renderizar objetos crudos si la API devolviera algo raro. */
export function safeLabel(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    for (const k of ['name', 'path', 'label', 'title']) {
      const s = o[k];
      if (typeof s === 'string' && s.trim()) return s;
    }
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function labelFor(n: GraphNode): string {
  const path = n.path != null ? safeLabel(n.path) : '';
  if (path) return path.split('/').pop() || path;
  return safeLabel(n.name) || safeLabel(n.kind);
}

function resolveFocalNode(graphNodes: GraphNode[], focalName: string): GraphNode | undefined {
  const byComponent = graphNodes.find((n) => n.kind === 'Component' && n.name === focalName);
  if (byComponent) return byComponent;
  return graphNodes.find((n) => n.name === focalName);
}

/** Layout en abanico: foco al centro, dependencias a un lado, impacto legacy al otro. */
export function layoutNodes(
  nodes: GraphNode[],
  edges: GraphEdge[],
  centerName: string,
): Map<string, { x: number; y: number }> {
  const center = resolveFocalNode(nodes, centerName) ?? nodes[0];
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

  return pos;
}

const DEPENDS_STROKE = '#60a5fa';
const LEGACY_STROKE = '#fbbf24';

function computeRole(
  nodeId: string,
  focalId: string,
  edges: GraphEdge[],
  isFocal: boolean,
): NodeFlowRole {
  if (isFocal) return 'focal';
  if (edges.some((e) => e.kind === 'depends' && e.source === focalId && e.target === nodeId)) {
    return 'dependency';
  }
  if (edges.some((e) => e.kind === 'legacy_impact' && e.source === nodeId && e.target === focalId)) {
    return 'legacy_consumer';
  }
  return 'related';
}

function edgeStatsForNode(
  nodeId: string,
  edges: GraphEdge[],
): { dependsOut: number; dependsIn: number; legacyOut: number; legacyIn: number } {
  let dependsOut = 0;
  let dependsIn = 0;
  let legacyOut = 0;
  let legacyIn = 0;
  for (const e of edges) {
    if (e.kind === 'depends') {
      if (e.source === nodeId) dependsOut++;
      if (e.target === nodeId) dependsIn++;
    } else if (e.kind === 'legacy_impact') {
      if (e.source === nodeId) legacyOut++;
      if (e.target === nodeId) legacyIn++;
    }
  }
  return { dependsOut, dependsIn, legacyOut, legacyIn };
}

/** Solo aristas cuyos extremos existen (evita paths rotos en React Flow). */
export function filterValidEdges(graphNodes: GraphNode[], graphEdges: GraphEdge[]): GraphEdge[] {
  const ids = new Set(graphNodes.map((n) => n.id));
  return graphEdges.filter((e) => ids.has(e.source) && ids.has(e.target));
}

export function toFlowElements(
  graphNodes: GraphNode[],
  graphEdges: GraphEdge[],
  positions: Map<string, { x: number; y: number }>,
  focalName: string,
): { nodes: ComponentGraphRFNode[]; edges: Edge[] } {
  /** Llamar con aristas ya validadas (`filterValidEdges`) y el mismo conjunto en `layoutNodes`. */
  const focal = resolveFocalNode(graphNodes, focalName);
  const focalId = focal?.id ?? '';

  const nodes: ComponentGraphRFNode[] = graphNodes.map((n) => {
    const pos = positions.get(n.id) ?? { x: 0, y: 0 };
    const isFocal = focalId !== '' && n.id === focalId;
    const lbl = labelFor(n);
    const pathStr = n.path != null ? safeLabel(n.path) : '';
    const role = computeRole(n.id, focalId, graphEdges, isFocal);
    const stats = edgeStatsForNode(n.id, graphEdges);

    return {
      id: n.id,
      type: 'componentGraph',
      position: pos,
      data: {
        label: lbl,
        kind: safeLabel(n.kind),
        subtitle: pathStr && pathStr !== lbl ? pathStr : undefined,
        isFocal,
        role,
        stats,
      },
    };
  });

  const edges: Edge[] = graphEdges.map((e, i) => {
    const isLegacy = e.kind === 'legacy_impact';
    const stroke = isLegacy ? LEGACY_STROKE : DEPENDS_STROKE;
    const shortLabel = isLegacy ? 'legacy' : 'depends';
    return {
      id: `e-${e.source}-${e.target}-${i}`,
      source: e.source,
      target: e.target,
      type: 'smoothstep',
      animated: !isLegacy && e.kind === 'depends',
      style: {
        stroke,
        strokeWidth: isLegacy ? 2.5 : 2,
        ...(isLegacy ? { strokeDasharray: '8 5' } : {}),
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: stroke,
        width: 18,
        height: 18,
      },
      label: shortLabel,
      labelStyle: { fontSize: 10, fontWeight: 600, fill: stroke },
      labelShowBg: true,
      labelBgStyle: { fill: 'var(--card)', fillOpacity: 0.95 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
    };
  });

  return { nodes, edges };
}
