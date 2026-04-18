/**
 * Mapea la respuesta GET /api/graph/c4-model a nodos/aristas React Flow (subflows: sistema → contenedores).
 */
import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { C4ModelResponse } from '@/types';

export type C4SystemData = { label: string; repoId: string };
export type C4ContainerData = {
  label: string;
  kind: string;
  technology?: string;
};

export type C4SystemRFNode = Node<C4SystemData, 'c4System'>;
export type C4ContainerRFNode = Node<C4ContainerData, 'c4Container'>;

const COL_W = 200;
const ROW_H = 118;
const PAD = 20;
const HEADER = 40;
const COLS = 3;

export function buildC4FlowElements(data: C4ModelResponse): {
  nodes: Node[];
  edges: Edge[];
} {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let sysX = 0;

  for (const sys of data.systems) {
    const sysId = `c4-sys-${sys.repoId}`;
    const n = sys.containers.length;
    const cols = Math.min(COLS, Math.max(1, n));
    const rows = Math.max(1, Math.ceil(n / cols));
    const cw = Math.max(420, PAD * 2 + cols * COL_W + (cols - 1) * 12);
    const ch = Math.max(220, HEADER + PAD + rows * ROW_H + (rows - 1) * 10 + PAD);

    nodes.push({
      id: sysId,
      type: 'c4System',
      position: { x: sysX, y: 0 },
      data: { label: sys.name, repoId: sys.repoId },
      style: { width: cw, height: ch },
      zIndex: 0,
    });

    sys.containers.forEach((c, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      nodes.push({
        id: `c4-ct-${sys.repoId}-${c.key}`,
        type: 'c4Container',
        parentId: sysId,
        position: { x: PAD + col * (COL_W + 12), y: HEADER + PAD + row * (ROW_H + 10) },
        extent: 'parent',
        data: {
          label: c.name,
          kind: c.c4Kind,
          ...(c.technology ? { technology: c.technology } : {}),
        },
        zIndex: 1,
      });
    });

    for (const e of sys.communicates) {
      const src = `c4-ct-${sys.repoId}-${e.sourceKey}`;
      const tgt = `c4-ct-${sys.repoId}-${e.targetKey}`;
      edges.push({
        id: `c4-e-${sys.repoId}-${e.sourceKey}-${e.targetKey}-${e.reason ?? ''}`,
        source: src,
        target: tgt,
        type: 'smoothstep',
        zIndex: 2,
        label: e.reason ?? 'communicates',
        style: { stroke: 'var(--foreground-muted)', strokeWidth: 1.75 },
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--foreground-muted)', width: 16, height: 16 },
        labelStyle: { fontSize: 9, fill: 'var(--foreground-muted)' },
        labelShowBg: true,
        labelBgStyle: { fill: 'var(--card)', fillOpacity: 0.95 },
      });
    }

    sysX += cw + 64;
  }

  return { nodes, edges };
}
