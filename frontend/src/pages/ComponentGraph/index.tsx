/**
 * Explorador visual del grafo de componente: dependencias + impacto legacy.
 * Alcance: select de proyecto (multi-root) o repositorio aislado → select de componentes desde graph-summary.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '@/api';
import type { Project, Repository } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type GraphNode = { id: string; kind: string; name?: string; path?: string };
type GraphEdge = { source: string; target: string; kind: string };

type ScopeOption = {
  key: string;
  /** UUID pasado a GET /graph/component?projectId= (nodo/shard en Falkor). */
  graphProjectId: string;
  label: string;
  detail: string;
  /** Repos cuyo graph-summary usamos para listar componentes. */
  repoIdsForSummary: string[];
  group: 'project' | 'standalone';
};

function buildScopeOptions(projects: Project[], repos: Repository[]): ScopeOption[] {
  const repoIdsInProjects = new Set<string>();
  for (const p of projects) {
    for (const r of p.repositories) repoIdsInProjects.add(r.id);
  }

  const out: ScopeOption[] = [];

  for (const p of projects) {
    const repoIds = p.repositories.map((r) => r.id);
    if (repoIds.length === 0) continue;
    out.push({
      key: `project:${p.id}`,
      graphProjectId: p.id,
      label: p.name?.trim() || `Proyecto ${p.id.slice(0, 8)}…`,
      detail: p.repositories.map((r) => `${r.projectKey}/${r.repoSlug}`).join(', '),
      repoIdsForSummary: repoIds,
      group: 'project',
    });
  }

  for (const r of repos) {
    if (repoIdsInProjects.has(r.id)) continue;
    out.push({
      key: `repo:${r.id}`,
      graphProjectId: r.id,
      label: `${r.projectKey}/${r.repoSlug}`,
      detail: 'Repositorio sin proyecto',
      repoIdsForSummary: [r.id],
      group: 'standalone',
    });
  }

  return out.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

function extractComponentNames(samples: Record<string, unknown[]> | undefined): string[] {
  const rows = (samples?.Component ?? []) as Array<{ name?: unknown }>;
  const names = new Set<string>();
  for (const row of rows) {
    const n = row?.name;
    if (typeof n === 'string' && n.trim()) names.add(n.trim());
  }
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

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
  const [scopeKey, setScopeKey] = useState<string>(() => search.get('scope') ?? '');
  const [graphProjectId, setGraphProjectId] = useState(() => search.get('projectId') ?? '');
  const [name, setName] = useState(() => search.get('name') ?? '');
  const [depth, setDepth] = useState(() => search.get('depth') ?? '2');

  const [scopeOptions, setScopeOptions] = useState<ScopeOption[]>([]);
  const [scopesLoading, setScopesLoading] = useState(true);
  const [scopesErr, setScopesErr] = useState<string | null>(null);

  const [componentNames, setComponentNames] = useState<string[]>([]);
  const [componentsLoading, setComponentsLoading] = useState(false);
  const [componentsErr, setComponentsErr] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [meta, setMeta] = useState<{ componentName: string; depth: number } | null>(null);

  const [pan, setPan] = useState({ x: 420, y: 280 });
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<{ sx: number; sy: number; px: number; py: number } | null>(null);

  /** Nombre en URL para hidratar el select cuando carguen los componentes del alcance. */
  const urlComponentRef = useRef<string | null>(search.get('name'));

  const selectedScope = useMemo(
    () => scopeOptions.find((o) => o.key === scopeKey) ?? null,
    [scopeOptions, scopeKey],
  );

  useEffect(() => {
    let cancel = false;
    (async () => {
      setScopesLoading(true);
      setScopesErr(null);
      try {
        const [projects, repos] = await Promise.all([api.getProjects(), api.getRepositories()]);
        if (cancel) return;
        const opts = buildScopeOptions(projects, repos);
        setScopeOptions(opts);

        const urlPid = search.get('projectId') ?? '';
        const urlScope = search.get('scope') ?? '';
        if (urlScope && opts.some((o) => o.key === urlScope)) {
          setScopeKey(urlScope);
        } else if (urlPid) {
          const hit =
            opts.find((o) => o.graphProjectId === urlPid) ??
            opts.find((o) => o.repoIdsForSummary.includes(urlPid));
          if (hit) setScopeKey(hit.key);
          else {
            setGraphProjectId(urlPid);
            setScopeKey('');
          }
        }
      } catch (e) {
        if (!cancel) setScopesErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancel) setScopesLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedScope) {
      setComponentNames([]);
      setComponentsErr(null);
      return;
    }
    setGraphProjectId(selectedScope.graphProjectId);
    let cancel = false;
    (async () => {
      setComponentsLoading(true);
      setComponentsErr(null);
      try {
        const summaries = await Promise.all(
          selectedScope.repoIdsForSummary.map((id) => api.getGraphSummary(id, true)),
        );
        if (cancel) return;
        const merged = new Set<string>();
        for (const s of summaries) {
          for (const n of extractComponentNames(s.samples)) merged.add(n);
        }
        const list = [...merged].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        setComponentNames(list);
        const want = urlComponentRef.current;
        if (want && list.includes(want)) {
          setName(want);
          urlComponentRef.current = null;
        }
      } catch (e) {
        if (!cancel) {
          setComponentsErr(e instanceof Error ? e.message : String(e));
          setComponentNames([]);
        }
      } finally {
        if (!cancel) setComponentsLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [selectedScope?.key]);

  const load = useCallback(async () => {
    const n = name.trim();
    const pid = graphProjectId.trim();
    if (!pid) {
      setErr('Elige un proyecto o repositorio indexado.');
      return;
    }
    if (!n) {
      setErr('Elige un componente');
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const d = Math.min(10, Math.max(1, parseInt(depth, 10) || 2));
      const data = await api.getComponentGraph(n, {
        depth: d,
        projectId: pid,
      });
      setNodes(data.nodes ?? []);
      setEdges(data.edges ?? []);
      setMeta({ componentName: data.componentName, depth: data.depth });
      setSearch((prev) => {
        const p = new URLSearchParams(prev);
        p.set('name', n);
        p.set('projectId', pid);
        p.set('depth', String(d));
        if (scopeKey) p.set('scope', scopeKey);
        else p.delete('scope');
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
  }, [name, graphProjectId, depth, scopeKey, setSearch]);

  const positions = useMemo(
    () => layoutNodes(nodes, edges, meta?.componentName ?? name.trim()),
    [nodes, edges, meta?.componentName, name],
  );

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const z = Math.min(2.5, Math.max(0.4, zoom * (e.deltaY < 0 ? 1.08 : 0.92)));
    setZoom(z);
  };

  const projectOpts = scopeOptions.filter((o) => o.group === 'project');
  const standaloneOpts = scopeOptions.filter((o) => o.group === 'standalone');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-[var(--foreground)] tracking-tight">Grafo de componente</h1>
        <p className="text-sm text-[var(--foreground-muted)] mt-1">
          Elige el alcance indexado en Falkor (proyecto multi-repo o repo aislado), luego un componente de ese
          índice. Las aristas ámbar son quienes te usan (radio de explosión).
        </p>
      </div>

      <Card className="p-4 flex flex-col gap-4 border-[var(--border)] bg-[var(--card)]">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="space-y-1 min-w-[220px] flex-1">
            <Label>Proyecto o repositorio</Label>
            <Select
              value={scopeKey || undefined}
              onValueChange={(v) => {
                setScopeKey(v);
                setName('');
                setNodes([]);
                setEdges([]);
                setMeta(null);
                setErr(null);
              }}
              disabled={scopesLoading || scopeOptions.length === 0}
            >
              <SelectTrigger className="w-full min-w-[200px]">
                <SelectValue
                  placeholder={
                    scopesLoading
                      ? 'Cargando…'
                      : scopeOptions.length === 0
                        ? 'No hay proyectos ni repos'
                        : 'Selecciona alcance'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {projectOpts.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Proyectos</SelectLabel>
                    {projectOpts.map((o) => (
                      <SelectItem key={o.key} value={o.key}>
                        <span className="font-medium">{o.label}</span>
                        <span className="block text-xs text-muted-foreground truncate max-w-[280px]">
                          {o.detail}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {standaloneOpts.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Repositorios aislados</SelectLabel>
                    {standaloneOpts.map((o) => (
                      <SelectItem key={o.key} value={o.key}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
            {selectedScope && (
              <p className="text-xs text-muted-foreground font-mono">
                projectId API: {selectedScope.graphProjectId}
              </p>
            )}
            {!scopesLoading && graphProjectId && !selectedScope && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                El projectId de la URL no coincide con ningún proyecto o repo aislado en esta cuenta. Revisa el
                UUID o sincroniza el índice.
              </p>
            )}
          </div>

          <div className="space-y-1 min-w-[200px] flex-1">
            <Label htmlFor="comp-select">Componente</Label>
            <Select
              value={name.trim() || undefined}
              onValueChange={(v) => setName(v)}
              disabled={!selectedScope || componentsLoading || componentNames.length === 0}
            >
              <SelectTrigger id="comp-select" className="w-full">
                <SelectValue
                  placeholder={
                    !selectedScope
                      ? 'Primero el alcance'
                      : componentsLoading
                        ? 'Cargando componentes…'
                        : componentNames.length === 0
                          ? 'Sin componentes en muestra'
                          : 'Selecciona componente'
                  }
                />
              </SelectTrigger>
              <SelectContent className="max-h-[280px]">
                {componentNames.map((cn) => (
                  <SelectItem key={cn} value={cn}>
                    {cn}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

          <Button type="button" onClick={() => void load()} disabled={loading || !selectedScope}>
            {loading ? 'Cargando…' : 'Cargar grafo'}
          </Button>
        </div>
      </Card>

      {(scopesErr || componentsErr) && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {scopesErr ?? componentsErr}
        </div>
      )}

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
