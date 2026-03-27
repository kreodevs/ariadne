/**
 * Explorador visual del grafo de componente: dependencias + impacto legacy.
 * Alcance: select de proyecto (multi-root) o repositorio aislado → select de componentes desde graph-summary.
 * Vista: React Flow (@xyflow/react) — pan/zoom, minimap, controles, aristas dirigidas (depends / legacy_impact).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api } from '@/api';
import type { ScopeOption } from '@/lib/graphScope';
import { buildScopeOptions, extractComponentNames } from '@/lib/graphScope';
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
import type { ComponentGraphNodeData, ComponentGraphRFNode } from './GraphFlowNode';
import { GraphFlowNode } from './GraphFlowNode';
import {
  type GraphEdge,
  type GraphNode,
  filterValidEdges,
  resolveFocalNode,
  toFlowElements,
} from './componentGraphFlow';
import { layoutWithDagre } from './graphLayout';
import { mergeGraphEdges, mergeGraphNodes } from './graphMerge';

const RF_NODE_TYPES = { componentGraph: GraphFlowNode };

/** Tras cargar el subgrafo desde Falkor, encuadra el viewport. */
function FitViewOnGraphLoad({ graphKey }: { graphKey: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (!graphKey) return;
    const id = requestAnimationFrame(() => {
      void fitView({ padding: 0.2, duration: 320, maxZoom: 1.35 });
    });
    return () => cancelAnimationFrame(id);
  }, [graphKey, fitView]);
  return null;
}

function ComponentGraphFlowView({
  graphNodes,
  graphEdges,
  rootFocalName,
  graphKey,
  projectId,
  expanding,
  onExpandNode,
}: {
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  rootFocalName: string;
  graphKey: string;
  projectId: string;
  expanding: boolean;
  onExpandNode: (componentName: string) => void | Promise<void>;
}) {
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<ComponentGraphRFNode>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const flowPayload = useMemo(() => {
    if (graphNodes.length === 0) {
      return { nodes: [] as ComponentGraphRFNode[], edges: [] as Edge[] };
    }
    const validEdges = filterValidEdges(graphNodes, graphEdges);
    const focal = resolveFocalNode(graphNodes, graphEdges, rootFocalName);
    const focalId = focal?.id ?? null;
    const positions = layoutWithDagre(graphNodes, validEdges, focalId);
    return toFlowElements(graphNodes, validEdges, positions, rootFocalName);
  }, [graphNodes, graphEdges, rootFocalName]);

  useEffect(() => {
    setRfNodes(flowPayload.nodes);
    setRfEdges(flowPayload.edges);
  }, [flowPayload, setRfNodes, setRfEdges]);

  const onNodeClick = useCallback<NodeMouseHandler<ComponentGraphRFNode>>(
    (_evt, node) => {
      if (expanding) return;
      if (!projectId.trim()) return;
      if (node.data.isFocal || !node.data.expandable) return;
      const cn = node.data.componentName?.trim();
      if (!cn) return;
      void onExpandNode(cn);
    },
    [expanding, projectId, onExpandNode],
  );

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
      className="component-graph-rf w-full rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--background)]"
      style={{ height: 560 }}
    >
      <ReactFlow
        key={graphKey}
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={RF_NODE_TYPES}
        nodesConnectable={false}
        edgesReconnectable={false}
        deleteKeyCode={null}
        attributionPosition="bottom-right"
        minZoom={0.15}
        maxZoom={1.8}
        defaultEdgeOptions={{
          type: 'smoothstep',
        }}
        proOptions={{ hideAttribution: true }}
        elevateEdgesOnSelect
        nodesDraggable
        onNodeClick={onNodeClick}
      >
        <FitViewOnGraphLoad graphKey={graphKey} />
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--border)"
        />
        <Controls className="!bg-[var(--card)] !border-[var(--border)] [&_button]:!bg-[var(--card)] [&_button]:!border-[var(--border)] [&_button]:!text-[var(--foreground)]" />
        <MiniMap
          className="!bg-[var(--card)] !border-[var(--border)]"
          nodeStrokeWidth={2}
          nodeColor={(n) => {
            const d = n.data as ComponentGraphNodeData | undefined;
            if (d?.isFocal) return 'var(--primary)';
            return 'var(--muted-foreground)';
          }}
          maskColor="color-mix(in oklch, var(--background) 75%, transparent)"
          pannable
          zoomable
        />
        <Panel
          position="top-left"
          className="m-2 max-w-[min(100%,320px)] rounded-md border border-[var(--border)] bg-[var(--card)]/95 backdrop-blur-sm px-3 py-2 text-xs text-[var(--foreground)] shadow-sm"
        >
          <p className="font-semibold text-[var(--foreground)] mb-1">Subgrafo indexado</p>
          {expanding ? (
            <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400 mb-1">Fusionando vecindario…</p>
          ) : null}
          <p className="text-[var(--foreground-muted)] leading-relaxed">
            Mismo <span className="font-mono">projectId</span> que usa la API de grafo: vecindario de tipo{' '}
            <span className="font-mono">Component</span> con aristas <span className="font-mono">depends</span>{' '}
            (imports / uso) y <span className="font-mono">legacy_impact</span> (consumidores — radio de explosión
            al refactorizar).
          </p>
          <p className="text-[var(--foreground-muted)] mt-2 leading-relaxed">
            Los datos viven en FalkorDB como grafo de propiedad; Ariadne expone este corte para SDD y revisión de
            impacto sin escribir Cypher a mano.
          </p>
          <p className="text-[var(--foreground-muted)] mt-2 leading-relaxed">
            Clic en un nodo periférico: carga un corte de profundidad 1 y lo fusiona al grafo (sin duplicar IDs).
          </p>
        </Panel>
      </ReactFlow>
    </div>
  );
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
  /** Incrementa en cada carga exitosa para forzar remount de React Flow (evita nodos fantasma al cambiar de componente). */
  const [graphNonce, setGraphNonce] = useState(0);
  const [expanding, setExpanding] = useState(false);
  const [expandErr, setExpandErr] = useState<string | null>(null);
  /** Evita refetch del mismo componente al expandir (se resetea al cargar un grafo nuevo). */
  const expandedNamesRef = useRef<Set<string>>(new Set());

  /** Nombre en URL para hidratar el select cuando carguen los componentes del alcance. */
  const urlComponentRef = useRef<string | null>(search.get('name'));

  const selectedScope = useMemo(
    () => scopeOptions.find((o) => o.key === scopeKey) ?? null,
    [scopeOptions, scopeKey],
  );

  const rootFocalName = meta?.componentName ?? name.trim();
  const graphKey = useMemo(() => {
    if (nodes.length === 0) return '';
    return `${rootFocalName}|${graphNonce}|${nodes.length}|${edges.length}|${meta?.depth ?? ''}`;
  }, [rootFocalName, graphNonce, nodes.length, edges.length, meta?.depth]);

  const expandNode = useCallback(
    async (componentName: string) => {
      const pid = graphProjectId.trim();
      if (!pid) return;
      if (expandedNamesRef.current.has(componentName)) return;
      setExpandErr(null);
      setExpanding(true);
      try {
        const data = await api.getComponentGraph(componentName, {
          depth: 1,
          projectId: pid,
        });
        setNodes((prev) => mergeGraphNodes(prev, data.nodes ?? []));
        setEdges((prev) => mergeGraphEdges(prev, data.edges ?? []));
        expandedNamesRef.current.add(componentName);
        setGraphNonce((x) => x + 1);
      } catch (e) {
        setExpandErr(e instanceof Error ? e.message : String(e));
      } finally {
        setExpanding(false);
      }
    },
    [graphProjectId],
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
        /** Proyecto agregado: un graph-summary ya trae todo el shard; por repo: ?repoScoped=1. */
        let summaries: Awaited<ReturnType<typeof api.getGraphSummary>>[];
        if (selectedScope.repoScoped && selectedScope.repoIdsForSummary[0]) {
          summaries = [
            await api.getGraphSummary(selectedScope.repoIdsForSummary[0], true, true),
          ];
        } else if (selectedScope.repoIdsForSummary[0]) {
          summaries = [await api.getGraphSummary(selectedScope.repoIdsForSummary[0], true, false)];
        } else {
          summaries = [];
        }
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
      expandedNamesRef.current.clear();
      setGraphNonce((x) => x + 1);
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

  const projectOpts = scopeOptions.filter((o) => o.group === 'project');
  const projectRepoOpts = scopeOptions.filter((o) => o.group === 'project_repo');
  const standaloneOpts = scopeOptions.filter((o) => o.group === 'standalone');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-[var(--foreground)] tracking-tight">Grafo de componente</h1>
        <p className="text-sm text-[var(--foreground-muted)] mt-1">
          Elige el alcance indexado en Falkor (proyecto multi-repo o repo aislado), luego un componente. Aristas
          azules: <span className="font-mono">depends</span>. Ámbar discontinuas:{' '}
          <span className="font-mono">legacy_impact</span> (quienes te usan).
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
                {projectRepoOpts.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Repos por proyecto</SelectLabel>
                    {projectRepoOpts.map((o) => (
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
              onValueChange={(v) => {
                setName(v);
                setNodes([]);
                setEdges([]);
                setMeta(null);
              }}
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
        <span className="flex items-center gap-2">
          <span className="inline-block w-8 h-0.5 bg-blue-500 rounded-full" /> depends (animada)
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block w-8 h-0.5 bg-amber-500 rounded-full border border-dashed border-amber-500/80" />{' '}
          legacy_impact
        </span>
      </div>

      {expandErr && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          Expansión: {expandErr}
        </div>
      )}

      <ReactFlowProvider>
        <ComponentGraphFlowView
          graphNodes={nodes}
          graphEdges={edges}
          rootFocalName={rootFocalName}
          graphKey={graphKey}
          projectId={graphProjectId}
          expanding={expanding}
          onExpandNode={expandNode}
        />
      </ReactFlowProvider>
    </div>
  );
}
