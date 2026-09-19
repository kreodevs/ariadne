import type { C4Evidence } from './c4-model.types.js';

export interface SyncWorkflowNode {
  id: string;
  lane: string;
  col: number;
  type: string;
  label: string;
  sublabel?: string;
}

export interface SyncWorkflowEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  variant?: 'default' | 'emphasis' | 'security' | 'dashed';
  role?: 'error' | 'branch' | 'return';
  route?: 'auto' | 'straight' | 'drop' | 'outside-right' | 'return-left' | 'bottom-channel' | 'up-channel';
  fromSide?: 'left' | 'right' | 'top' | 'bottom';
  toSide?: 'left' | 'right' | 'top' | 'bottom';
}

export interface SyncWorkflowSpec {
  title: string;
  subtitle?: string;
  lanes: Array<{ id: string; label: string; variant?: string }>;
  mainPath: string[];
  nodes: SyncWorkflowNode[];
  edges: SyncWorkflowEdge[];
  evidence?: C4Evidence[];
}

export interface ArchifyWorkflowIr {
  schema_version: 1;
  diagram_type: 'workflow';
  meta: {
    title: string;
    subtitle?: string;
    animation?: 'trace' | 'none';
  };
  lanes: Array<{ id: string; label: string; variant?: string }>;
  phases?: Array<{ id: string; label: string; fromCol: number; toCol: number; variant?: string }>;
  groups?: Array<{ id: string; label: string; lane: string; fromCol: number; toCol: number; variant?: string }>;
  mainPath: string[];
  nodes: Array<{
    id: string;
    lane: string;
    col: number;
    type: string;
    label: string;
    sublabel?: string;
    width?: number;
  }>;
  edges: Array<{
    from: string;
    to: string;
    label?: string;
    variant?: string;
    role?: string;
    route?: string;
    fromSide?: string;
    toSide?: string;
  }>;
  cards?: Array<{ dot: string; title: string; items: string[] }>;
}

function isSyncPipelineWorkflow(spec: SyncWorkflowSpec): boolean {
  return (
    spec.mainPath.includes('writing_graph') &&
    spec.lanes.some((l) => l.id === 'graph') &&
    spec.lanes.some((l) => l.id === 'trigger')
  );
}

/** Spec de workflow → Archify IR (fases/grupos solo en pipeline full-sync). */
export function syncWorkflowToArchifyWorkflow(spec: SyncWorkflowSpec): ArchifyWorkflowIr {
  const syncPipeline = isSyncPipelineWorkflow(spec);
  const maxCol = Math.min(5, spec.nodes.reduce((m, n) => Math.max(m, n.col), 0));

  const ir: ArchifyWorkflowIr = {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: {
      title: spec.title,
      ...(spec.subtitle ? { subtitle: spec.subtitle } : syncPipeline
        ? { subtitle: 'Full sync: indexación → Falkor → embeddings → C4' }
        : {}),
      animation: 'trace',
    },
    lanes: spec.lanes,
    mainPath: spec.mainPath,
    nodes: spec.nodes.map((n) => ({
      id: n.id,
      lane: n.lane,
      col: n.col,
      type: n.type,
      label: n.label,
      ...(n.sublabel ? { sublabel: n.sublabel } : {}),
    })),
    edges: spec.edges.map((e) => ({
      from: e.from,
      to: e.to,
      ...(e.label ? { label: e.label } : {}),
      variant: e.variant ?? 'default',
      ...(e.role ? { role: e.role } : {}),
      ...(e.route ? { route: e.route } : {}),
      ...(e.fromSide ? { fromSide: e.fromSide } : {}),
      ...(e.toSide ? { toSide: e.toSide } : {}),
    })),
  };

  if (syncPipeline) {
    ir.phases = [
      { id: 'prepare', label: 'Preparar', fromCol: 0, toCol: 1 },
      { id: 'index', label: 'Indexar', fromCol: 2, toCol: 3, variant: 'emphasis' },
      { id: 'finalize', label: 'Finalizar', fromCol: 4, toCol: maxCol, variant: 'dashed' },
    ];
    ir.groups = [
      {
        id: 'graph_write',
        label: 'Escritura grafo',
        lane: 'graph',
        fromCol: 3,
        toCol: 3,
        variant: 'emphasis',
      },
    ];
    ir.cards = [
      {
        dot: 'cyan',
        title: 'Origen',
        items: ['Fases alineadas con sync.service.ts', 'Ramas de error en indexing y writing_graph'],
      },
    ];
  }

  return ir;
}

/** Spec determinista del pipeline de sync (sin depender de Falkor). */
export function buildDefaultSyncWorkflowSpec(projectLabel?: string): SyncWorkflowSpec {
  const title = projectLabel
    ? `Sync pipeline — ${projectLabel}`
    : 'Ariadne full sync pipeline';
  return {
    title,
    subtitle: 'Desde cola hasta grafo Falkor, embeddings y C4',
    lanes: [
      { id: 'trigger', label: 'Trigger' },
      { id: 'ingest', label: 'Ingest' },
      { id: 'graph', label: 'FalkorDB' },
      { id: 'post', label: 'Post-sync' },
      { id: 'exceptions', label: 'Errores', variant: 'exception' },
    ],
    mainPath: ['queued', 'mapping', 'indexing', 'writing_graph', 'post_sync', 'completed'],
    nodes: [
      { id: 'queued', lane: 'trigger', col: 0, type: 'external', label: 'Queued', sublabel: 'sync job' },
      { id: 'mapping', lane: 'ingest', col: 1, type: 'backend', label: 'Mapping', sublabel: 'archivos / clone' },
      { id: 'indexing', lane: 'graph', col: 2, type: 'backend', label: 'Indexing', sublabel: 'parse AST' },
      { id: 'writing_graph', lane: 'graph', col: 3, type: 'database', label: 'Writing graph', sublabel: 'MERGE Cypher' },
      { id: 'post_sync', lane: 'post', col: 4, type: 'messagebus', label: 'Post-sync', sublabel: 'embeddings + C4' },
      { id: 'completed', lane: 'post', col: 5, type: 'cloud', label: 'Completed', sublabel: 'grafo listo' },
      { id: 'failed', lane: 'exceptions', col: 2, type: 'security', label: 'Failed', sublabel: 'job error' },
    ],
    edges: [
      { id: 'q-map', from: 'queued', to: 'mapping', variant: 'default' },
      {
        id: 'map-idx',
        from: 'mapping',
        to: 'indexing',
        variant: 'emphasis',
        route: 'drop',
        fromSide: 'bottom',
        toSide: 'top',
      },
      { id: 'idx-write', from: 'indexing', to: 'writing_graph', variant: 'emphasis' },
      { id: 'write-post', from: 'writing_graph', to: 'post_sync', variant: 'default', route: 'drop', fromSide: 'bottom', toSide: 'top' },
      { id: 'post-done', from: 'post_sync', to: 'completed', variant: 'emphasis' },
      {
        id: 'idx-fail',
        from: 'indexing',
        to: 'failed',
        label: 'error',
        variant: 'security',
        role: 'error',
        route: 'drop',
        fromSide: 'bottom',
        toSide: 'top',
      },
      {
        id: 'write-fail',
        from: 'writing_graph',
        to: 'failed',
        label: 'error',
        variant: 'security',
        role: 'error',
        route: 'outside-right',
        fromSide: 'right',
        toSide: 'right',
      },
    ],
    evidence: [
      {
        source: 'package_json',
        reason: 'Fases de sync.service.ts (mapping → indexing → writing_graph → embeddings)',
      },
    ],
  };
}
