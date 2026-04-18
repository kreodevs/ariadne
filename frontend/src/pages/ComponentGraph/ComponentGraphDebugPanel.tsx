/**
 * Panel colapsable: misma carga en memoria que React Flow — vis-network (layout físico) + JSON crudo;
 * segundo bloque: Cypher contra Falkor vía API Nest (misma conexión que getComponentGraph).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { DataSet } from 'vis-data';
import { Network } from 'vis-network';
import { ChevronRight } from 'lucide-react';
import 'vis-network/styles/vis-network.css';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  /** projectId usado por la API de grafo (prefill Cypher). */
  graphProjectId: string;
  /** Nombre de componente para plantilla de consulta (URL o meta tras cargar). */
  prefillComponentName?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  graphHints: ComponentGraphDebugHints;
  meta: ComponentGraphDebugMeta;
  /** Ocultar en vista C4 u otras rutas donde no aplica. */
  hidden?: boolean;
};

function escapeCypherString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function FalkorDebugQueryBlock({
  projectId,
  prefillComponentName,
}: {
  projectId: string;
  prefillComponentName?: string;
}) {
  const defaultQuery = useMemo(() => {
    const pid = projectId.trim();
    if (!pid) {
      return 'MATCH (n) RETURN count(n) AS c LIMIT 1';
    }
    const cn = prefillComponentName?.trim();
    if (cn) {
      return [
        `MATCH (c:Component { name: '${escapeCypherString(cn)}', projectId: '${escapeCypherString(pid)}' })`,
        `RETURN c`,
        `LIMIT 25`,
      ].join('\n');
    }
    return [
      `MATCH (c:Component { projectId: '${escapeCypherString(pid)}' })`,
      `RETURN c.name AS name, labels(c) AS labels`,
      `LIMIT 50`,
    ].join('\n');
  }, [projectId, prefillComponentName]);

  const [query, setQuery] = useState(defaultQuery);
  useEffect(() => {
    setQuery(defaultQuery);
  }, [defaultQuery]);

  const [graphNameOverride, setGraphNameOverride] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resultJson, setResultJson] = useState<string | null>(null);

  const run = () => {
    setErr(null);
    setResultJson(null);
    setLoading(true);
    void (async () => {
      try {
        const r = await api.postFalkorDebugQuery({
          query,
          projectId: projectId.trim() || undefined,
          graphName: graphNameOverride.trim() || undefined,
        });
        setResultJson(JSON.stringify(r, null, 2));
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  };

  return (
    <details className="group rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)]">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-200 group-open:rotate-90" />
        Falkor (Cypher vía API)
        <span className="text-xs font-normal text-[var(--foreground-muted)]">
          misma conexión que Nest — activar FALKOR_DEBUG_CYPHER=1
        </span>
      </summary>
      <div className="border-t border-[var(--border)] space-y-3 p-3">
        <p className="text-xs text-[var(--foreground-muted)] leading-relaxed">
          No es el contenedor desde el navegador: el front llama a{' '}
          <span className="font-mono">POST /api/graph/falkor-debug-query</span> y Nest ejecuta en Falkor con{' '}
          <span className="font-mono">FalkorService</span>. Así validas que los datos coinciden con lo que devuelve{' '}
          <span className="font-mono">getComponentGraph</span> sin exponer Redis.
        </p>
        <div className="space-y-1">
          <Label htmlFor="falkor-graph-name">graphName (opcional, shard explícito)</Label>
          <Input
            id="falkor-graph-name"
            value={graphNameOverride}
            onChange={(e) => setGraphNameOverride(e.target.value)}
            placeholder="Vacío = grafo por projectId (routing habitual)"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="falkor-query">Cypher (solo lectura)</Label>
          <textarea
            id="falkor-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
            className="min-h-[160px] w-full resize-y rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs font-mono text-[var(--foreground)] placeholder:text-[var(--foreground-muted)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={run} disabled={loading || !query.trim()}>
            {loading ? 'Ejecutando…' : 'Ejecutar'}
          </Button>
        </div>
        {err ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive whitespace-pre-wrap">
            {err}
          </div>
        ) : null}
        {resultJson ? (
          <pre className="max-h-[min(480px,55vh)] overflow-auto rounded-md border border-[var(--border)] bg-[var(--muted)]/40 p-3 text-[11px] leading-relaxed font-mono text-[var(--foreground)]">
            {resultJson}
          </pre>
        ) : null}
      </div>
    </details>
  );
}

export function ComponentGraphDebugPanel({
  graphProjectId,
  prefillComponentName,
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
    <div className="space-y-3">
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
    <FalkorDebugQueryBlock projectId={graphProjectId} prefillComponentName={prefillComponentName} />
    </div>
  );
}
