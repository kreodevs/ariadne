/**
 * Panel colapsable: misma carga en memoria que React Flow — vis-network (layout físico) + JSON crudo.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { DataSet } from 'vis-data';
import { Network } from 'vis-network';
import { ChevronRight } from 'lucide-react';
import 'vis-network/styles/vis-network.css';
import {
  type GraphEdge,
  type GraphNode,
  filterValidEdges,
  labelFor,
} from './componentGraphFlow';

export type ComponentGraphDebugHints = {
  suggestResync?: boolean;
  messageEs?: string;
} | null;

export type ComponentGraphDebugMeta = { componentName: string; depth: number } | null;

type Props = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  graphHints: ComponentGraphDebugHints;
  meta: ComponentGraphDebugMeta;
  /** Ocultar en vista C4 u otras rutas donde no aplica. */
  hidden?: boolean;
};

export function ComponentGraphDebugPanel({
  nodes,
  edges,
  graphHints,
  meta,
  hidden,
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const jsonText = useMemo(
    () =>
      JSON.stringify(
        {
          nodes,
          edges,
          graphHints,
          meta,
        },
        null,
        2,
      ),
    [nodes, edges, graphHints, meta],
  );

  /** Misma regla que React Flow: solo aristas con extremos en nodos (sin self-loops). */
  const validEdges = useMemo(() => filterValidEdges(nodes, edges), [nodes, edges]);

  useEffect(() => {
    if (hidden || !open) return;
    const el = containerRef.current;
    if (!el || nodes.length === 0) return;

    const visNodes = new DataSet(
      nodes.map((n) => ({
        id: n.id,
        label: `${labelFor(n)} (${n.kind})`,
        shape: 'box' as const,
        font: { size: 12 },
      })),
    );

    const visEdges = new DataSet(
      validEdges.map((e, i) => ({
        id: `e-${i}-${e.source}-${e.target}-${e.kind}`,
        from: e.source,
        to: e.target,
        arrows: 'to' as const,
        color:
          e.kind === 'legacy_impact'
            ? ({ color: '#d97706', highlight: '#f59e0b' } as const)
            : ({ color: '#2563eb', highlight: '#3b82f6' } as const),
        dashes: e.kind === 'legacy_impact',
        label: e.kind,
        font: { size: 10, align: 'middle' as const },
      })),
    );

    const network = new Network(
      el,
      { nodes: visNodes, edges: visEdges },
      {
        physics: {
          enabled: true,
          stabilization: { iterations: 200 },
        },
        layout: { improvedLayout: true },
        edges: { smooth: true },
        interaction: { navigationButtons: true, hover: true, tooltipDelay: 120 },
      },
    );
    const fit = () => {
      network.fit({ animation: { duration: 280, easingFunction: 'easeInOutQuad' } });
    };
    const raf = requestAnimationFrame(() => requestAnimationFrame(fit));

    const ro = new ResizeObserver(() => {
      network.redraw();
      fit();
    });
    ro.observe(el);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      network.destroy();
    };
  }, [hidden, open, nodes, validEdges]);

  if (hidden) return null;

  return (
    <details
      className="group rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)]"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-200 group-open:rotate-90" />
        Debug
        <span className="text-xs font-normal text-[var(--foreground-muted)]">
          (vis-network + JSON del estado en memoria)
        </span>
      </summary>
      <div className="border-t border-[var(--border)] p-3">
        {nodes.length === 0 ? (
          <p className="text-sm text-[var(--foreground-muted)]">
            Carga un grafo para ver la vista alternativa y el payload.
          </p>
        ) : (
          <div className="grid min-h-[min(420px,50vh)] grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="flex min-h-[280px] min-w-0 flex-col gap-1">
              <p className="text-xs text-[var(--foreground-muted)]">
                Aristas visibles: mismas que React Flow (<span className="font-mono">filterValidEdges</span>).
                JSON: datos crudos (<span className="font-mono">nodes</span> / <span className="font-mono">edges</span>).
              </p>
              <div
                ref={containerRef}
                className="min-h-[260px] flex-1 rounded-md border border-[var(--border)] bg-[var(--background)]"
              />
            </div>
            <div className="flex min-h-[280px] min-w-0 flex-col gap-1">
              <p className="text-xs text-[var(--foreground-muted)]">JSON</p>
              <pre className="max-h-[min(420px,50vh)] flex-1 overflow-auto rounded-md border border-[var(--border)] bg-[var(--muted)]/40 p-3 text-[11px] leading-relaxed font-mono text-[var(--foreground)]">
                {jsonText}
              </pre>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
