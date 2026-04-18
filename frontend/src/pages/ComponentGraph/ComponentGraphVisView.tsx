/**
 * Grafo de componente con vis-network (fuerzas, zoom, pan). Clic en nodo periférico → expandir vecindario.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { DataSet } from 'vis-data';
import { Network, type Options } from 'vis-network';
import 'vis-network/styles/vis-network.css';
import { Button } from '@/components/ui/button';
import {
  type GraphEdge,
  type GraphNode,
  filterValidEdges,
  labelFor,
  resolveFocalNode,
} from './componentGraphFlow';

const VIS_NETWORK_OPTIONS = {
  autoResize: true,
  physics: {
    enabled: true,
    solver: 'forceAtlas2Based' as const,
    forceAtlas2Based: {
      gravitationalConstant: -42,
      centralGravity: 0.012,
      springLength: 115,
      springConstant: 0.055,
      damping: 0.55,
      avoidOverlap: 0.65,
    },
    maxVelocity: 48,
    minVelocity: 0.75,
    stabilization: {
      enabled: true,
      iterations: 380,
      updateInterval: 20,
      fit: true,
    },
  },
  layout: { improvedLayout: true },
  edges: { smooth: true },
  interaction: {
    hover: true,
    tooltipDelay: 140,
    zoomView: true,
    dragView: true,
    dragNodes: true,
    zoomSpeed: 1,
    navigationButtons: true,
    keyboard: true,
    multiselect: false,
  },
} satisfies Options;

/** Colores hex (el canvas de vis no resuelve CSS variables). */
const FOCAL_NODE_COLOR = {
  border: '#2563eb',
  background: '#1e293b',
  highlight: { border: '#3b82f6', background: '#334155' },
};

type Props = {
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  graphKey: string;
  projectId: string;
  expanding: boolean;
  rootFocalName: string;
  onExpandNode: (componentName: string) => void | Promise<void>;
};

export function ComponentGraphVisView({
  graphNodes,
  graphEdges,
  graphKey,
  projectId,
  expanding,
  rootFocalName,
  onExpandNode,
}: Props) {
  const [visLayoutGeneration, setVisLayoutGeneration] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const visNetworkRef = useRef<Network | null>(null);

  const validEdges = useMemo(() => filterValidEdges(graphNodes, graphEdges), [graphNodes, graphEdges]);
  const focalId = useMemo(() => {
    const f = resolveFocalNode(graphNodes, graphEdges, rootFocalName);
    return f?.id ?? null;
  }, [graphNodes, graphEdges, rootFocalName]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || graphNodes.length === 0) return;

    const visNodes = new DataSet(
      graphNodes.map((n) => {
        const isFocal = focalId !== null && n.id === focalId;
        return {
          id: n.id,
          label: `${labelFor(n)} (${n.kind})`,
          shape: 'box' as const,
          font: { size: 12 },
          ...(isFocal
            ? {
                color: FOCAL_NODE_COLOR,
                borderWidth: 3,
              }
            : {}),
        };
      }),
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

    const network = new Network(el, { nodes: visNodes, edges: visEdges }, { ...VIS_NETWORK_OPTIONS });
    visNetworkRef.current = network;

    const onStabilized = () => {
      network.setOptions({ physics: { enabled: false } });
    };
    network.on('stabilizationIterationsDone', onStabilized);

    const onClick = (params: { nodes: string[] }) => {
      if (expanding || !projectId.trim()) return;
      const id = params.nodes[0];
      if (id == null || focalId == null || id === focalId) return;
      const gn = graphNodes.find((n) => n.id === id);
      if (!gn) return;
      const cn =
        typeof gn.name === 'string' && gn.name.trim() ? gn.name.trim() : labelFor(gn);
      if (!cn) return;
      void onExpandNode(cn);
    };
    network.on('click', onClick);

    const fit = () => {
      network.fit({ animation: { duration: 320, easingFunction: 'easeInOutQuad' } });
    };
    const raf = requestAnimationFrame(() => requestAnimationFrame(fit));

    const ro = new ResizeObserver(() => {
      network.redraw();
    });
    ro.observe(el);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      network.off('stabilizationIterationsDone', onStabilized);
      network.off('click', onClick);
      network.destroy();
      visNetworkRef.current = null;
    };
  }, [graphNodes, validEdges, graphKey, focalId, projectId, expanding, onExpandNode, visLayoutGeneration]);

  if (graphNodes.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-[var(--foreground-muted)] border border-dashed border-[var(--border)] rounded-lg bg-[var(--muted)]/30"
        style={{ height: 560 }}
      >
        Carga un componente para ver el vecindario en el grafo Falkor (depends + legacy_impact).
      </div>
    );
  }

  return (
    <div
      className="component-graph-vis w-full rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--background)] flex flex-col"
      style={{ height: 560 }}
    >
      <div className="flex flex-wrap items-start gap-3 border-b border-[var(--border)] bg-[var(--card)]/50 px-3 py-2">
        <div className="flex flex-wrap gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              visNetworkRef.current?.fit({
                animation: { duration: 380, easingFunction: 'easeInOutQuad' },
              });
            }}
          >
            Encuadrar
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => setVisLayoutGeneration((n) => n + 1)}
          >
            Autolayout (re-física)
          </Button>
        </div>
        <div className="min-w-0 flex-1 text-xs text-[var(--foreground-muted)] leading-relaxed max-w-[min(100%,520px)]">
          <p className="font-semibold text-[var(--foreground)] mb-0.5">Subgrafo indexado</p>
          {expanding ? (
            <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400 mb-1">Fusionando vecindario…</p>
          ) : null}
          <p>
            Mismo <span className="font-mono">projectId</span> que la API: aristas{' '}
            <span className="font-mono">depends</span> y <span className="font-mono">legacy_impact</span>. Clic en un
            nodo periférico para ampliar (depth 1).
          </p>
        </div>
      </div>
      <div
        ref={containerRef}
        className="min-h-0 flex-1 w-full touch-none bg-[var(--background)]"
      />
    </div>
  );
}
