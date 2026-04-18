import { MarkerType, type Edge } from '@xyflow/react';
import type { ComponentGraphRFNode, NodeFlowRole } from './GraphFlowNode';

/** Tamaño fijo del nodo en RF + Dagre (evita aristas al centro tapadas por la tarjeta). */
export const COMPONENT_NODE_WIDTH = 240;
export const COMPONENT_NODE_HEIGHT = 160;

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

/** Resuelve el nodo del componente foco por nombre (prioridad sobre heurística legacy de un solo target). */
export function resolveFocalNode(
  graphNodes: GraphNode[],
  graphEdges: GraphEdge[],
  focalName: string,
): GraphNode | undefined {
  const byComponent = graphNodes.find((n) => n.kind === 'Component' && n.name === focalName);
  if (byComponent) return byComponent;
  const byName = graphNodes.find((n) => n.name === focalName);
  if (byName) return byName;

  const legacyTargets = [
    ...new Set(graphEdges.filter((e) => e.kind === 'legacy_impact').map((e) => e.target)),
  ];
  if (legacyTargets.length === 1) {
    const hit = graphNodes.find((x) => x.id === legacyTargets[0]);
    if (hit) return hit;
  }
  return graphNodes[0];
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
  return graphEdges.filter(
    (e) => e.source !== e.target && ids.has(e.source) && ids.has(e.target),
  );
}

export function toFlowElements(
  graphNodes: GraphNode[],
  graphEdges: GraphEdge[],
  positions: Map<string, { x: number; y: number }>,
  focalName: string,
): { nodes: ComponentGraphRFNode[]; edges: Edge[] } {
  /** Llamar con aristas ya validadas (`filterValidEdges`) y posiciones coherentes con el mismo corte. */
  const focal = resolveFocalNode(graphNodes, graphEdges, focalName);
  const focalId = focal?.id ?? '';

  const nodes: ComponentGraphRFNode[] = graphNodes.map((n) => {
    const pos = positions.get(n.id) ?? { x: 0, y: 0 };
    const isFocal = focalId !== '' && n.id === focalId;
    const rawLabel = labelFor(n);
    const lbl =
      isFocal && (rawLabel === 'Node' || n.kind === 'Node' || n.name === undefined)
        ? focalName
        : rawLabel;
    const pathStr = n.path != null ? safeLabel(n.path) : '';
    const role = computeRole(n.id, focalId, graphEdges, isFocal);
    const stats = edgeStatsForNode(n.id, graphEdges);
    const componentName = typeof n.name === 'string' && n.name.trim() ? n.name : lbl;

    return {
      id: n.id,
      type: 'componentGraph',
      position: pos,
      width: COMPONENT_NODE_WIDTH,
      height: COMPONENT_NODE_HEIGHT,
      data: {
        label: lbl,
        kind: safeLabel(n.kind),
        subtitle: pathStr && pathStr !== lbl ? pathStr : undefined,
        isFocal,
        role,
        stats,
        componentName,
        expandable: !isFocal,
      },
    };
  });

  const edges: Edge[] = graphEdges.map((e) => {
    const isLegacy = e.kind === 'legacy_impact';
    const stroke = isLegacy ? LEGACY_STROKE : DEPENDS_STROKE;
    const shortLabel = isLegacy ? 'legacy' : 'depends';
    const directDependsFromFocal =
      e.kind === 'depends' && focalId !== '' && e.source === focalId && e.target !== focalId;
    return {
      id: `e-${e.source}-${e.target}-${e.kind}`,
      source: e.source,
      target: e.target,
      sourceHandle: 'out',
      targetHandle: 'in',
      type: 'smoothstep',
      animated: directDependsFromFocal,
      zIndex: 1,
      style: {
        stroke,
        strokeWidth: isLegacy ? 2.5 : directDependsFromFocal ? 2.75 : 2,
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
