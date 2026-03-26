/**
 * Explorador visual del grafo de componente: dependencias + radio de explosión (impacto legacy).
 * Consume GET /api/graph/component/:name (Nest). Pan/zoom en SVG (sin dependencias extra).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';

type GraphNode = { id: string; kind: string; name?: string; path?: string };
type GraphEdge = { source: string; target: string; kind: string };

function labelFor(n: GraphNode): string {
  if (n.path) return n.path.split('/').pop() || n.path;
  return n.name ?? n.kind;
}

function layoutNodes(
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

  placeArc(depTargets, -Math.PI * 0.35, Math.PI * 0.7, 220);
  placeArc(impactSources, Math.PI * 0.65, Math.PI * 0.7, 240);

  for (const n of nodes) {
    if (pos.has(n.id)) continue;
    const x = (Math.random() - 0.5) * 80;
    const y = (Math.random() - 0.5) * 80;
    pos.set(n.id, { x: 300 + x, y: 300 + y });
  }

  void byId;
  return pos;
}

export function ComponentGraphExplorer() {
  const [search, setSearch] = useSearchParams();
  const [name, setName] = useState(() => search.get('name') ?? '');
  const [projectId, setProjectId] = useState(() => search.get('projectId') ?? '');
  const [depth, setDepth] = useState(() => search.get('depth') ?? '2');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [meta, setMeta] = useState<{ componentName: string; depth: number } | null>(null);

  const [pan, setPan] = useState({ x: 420, y: 280 });
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<{ sx: number; sy: number; px: number; py: number } | null>(null);

  const load = useCallback(async () => {
    const n = name.trim();
    if (!n) {
      setErr('Indica el nombre del componente');
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const d = Math.min(10, Math.max(1, parseInt(depth, 10) || 2));
      const data = await api.getComponentGraph(n, {
        depth: d,
        projectId: projectId.trim() || undefined,
      });
      setNodes(data.nodes ?? []);
      setEdges(data.edges ?? []);
      setMeta({ componentName: data.componentName, depth: data.depth });
      setSearch((prev) => {
        const p = new URLSearchParams(prev);
        p.set('name', n);
        p.set('depth', String(d));
        if (projectId.trim()) p.set('projectId', projectId.trim());
        else p.delete('projectId');
        return p;
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setNodes([]);
      setEdges([]);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }, [name, projectId, depth, setSearch]);

  useEffect(() => {
    const n = search.get('name');
    if (n) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- carga inicial por URL
  }, []);

  const positions = useMemo(
    () => layoutNodes(nodes, edges, meta?.componentName ?? name.trim()),
    [nodes, edges, meta?.componentName, name],
  );

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const z = Math.min(2.5, Math.max(0.4, zoom * (e.deltaY < 0 ? 1.08 : 0.92)));
    setZoom(z);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-[var(--foreground)] tracking-tight">Grafo de componente</h1>
        <p className="text-sm text-[var(--foreground-muted)] mt-1">
          Dependencias hacia abajo; aristas «legacy impact» muestran quienes romperían si cambias el nodo
          central.
        </p>
      </div>

      <Card className="p-4 flex flex-wrap gap-4 items-end border-[var(--border)] bg-[var(--card)]">
        <div className="space-y-1">
          <Label htmlFor="comp-name">Componente</Label>
          <Input
            id="comp-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="p. ej. BoardCard"
            className="w-48"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="proj-id">projectId (opcional)</Label>
          <Input
            id="proj-id"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder="UUID índice / repo"
            className="w-56 font-mono text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="depth">Profundidad</Label>
          <Input
            id="depth"
            type="number"
            min={1}
            max={10}
            value={depth}
            onChange={(e) => setDepth(e.target.value)}
            className="w-20"
          />
        </div>
        <Button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Cargando…' : 'Cargar grafo'}
        </Button>
      </Card>

      {err && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {err}
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-xs text-[var(--foreground-muted)]">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-0.5 bg-blue-500" /> depends
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-0.5 bg-amber-500" /> legacy impact (te usan)
        </span>
      </div>

      <Card className="overflow-hidden border-[var(--border)] bg-[var(--background)]">
        <svg
          width="100%"
          height={560}
          className="touch-none cursor-grab active:cursor-grabbing"
          onWheel={onWheel}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            setDrag({ sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y });
          }}
          onMouseMove={(e) => {
            if (!drag) return;
            setPan({
              x: drag.px + (e.clientX - drag.sx),
              y: drag.py + (e.clientY - drag.sy),
            });
          }}
          onMouseUp={() => setDrag(null)}
          onMouseLeave={() => setDrag(null)}
        >
          <defs>
            <marker id="arrow-blue" markerWidth={8} markerHeight={8} refX={6} refY={4} orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="rgb(59, 130, 246)" />
            </marker>
            <marker id="arrow-amber" markerWidth={8} markerHeight={8} refX={6} refY={4} orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="rgb(245, 158, 11)" />
            </marker>
          </defs>
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {edges.map((e, i) => {
              const a = positions.get(e.source);
              const b = positions.get(e.target);
              if (!a || !b) return null;
              const stroke = e.kind === 'legacy_impact' ? 'rgb(245, 158, 11)' : 'rgb(59, 130, 246)';
              const marker = e.kind === 'legacy_impact' ? 'url(#arrow-amber)' : 'url(#arrow-blue)';
              return (
                <line
                  key={`${e.source}-${e.target}-${i}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={stroke}
                  strokeWidth={1.5 / zoom}
                  markerEnd={marker}
                  opacity={0.85}
                />
              );
            })}
            {nodes.map((n) => {
              const p = positions.get(n.id);
              if (!p) return null;
              const isCenter =
                n.kind === 'Component' && n.name === (meta?.componentName ?? name.trim());
              const r = isCenter ? 28 : 22;
              return (
                <g key={n.id} transform={`translate(${p.x},${p.y})`}>
                  <circle
                    r={r}
                    fill={isCenter ? 'var(--primary)' : 'var(--card)'}
                    stroke="var(--border)"
                    strokeWidth={2 / zoom}
                  />
                  <text
                    textAnchor="middle"
                    dy={4}
                    className="select-none pointer-events-none"
                    fill={isCenter ? 'var(--primary-foreground)' : 'var(--foreground)'}
                    style={{ fontSize: 10 / zoom, maxWidth: r * 2 }}
                  >
                    {labelFor(n).slice(0, 18)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </Card>
    </div>
  );
}
