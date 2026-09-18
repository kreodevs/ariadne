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
  schema_version: 2;
  diagram_type: 'workflow';
  meta: {
    title: string;
    subtitle?: string;
    animation?: 'trace' | 'none';
    quality_profile?: 'showcase';
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
    id: string;
    from: string;
    to: string;
    label?: string;
    variant?: string;
    role?: string;
  }>;
  cards?: Array<{ dot: string; title: string; items: string[] }>;
}

/** Pipeline full-sync de Ariadne → Archify workflow IR. */
export function syncWorkflowToArchifyWorkflow(spec: SyncWorkflowSpec): ArchifyWorkflowIr {
  const maxCol = spec.nodes.reduce((m, n) => Math.max(m, n.col), 0);
  return {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: {
      title: spec.title,
      subtitle: spec.subtitle ?? 'Full sync: indexación → Falkor → embeddings → C4',
      animation: 'trace',
      quality_profile: 'showcase',
    },
    lanes: spec.lanes,
    phases: [
      { id: 'prepare', label: 'Preparar', fromCol: 0, toCol: 1 },
      { id: 'index', label: 'Indexar', fromCol: 2, toCol: 3, variant: 'emphasis' },
      { id: 'finalize', label: 'Finalizar', fromCol: 4, toCol: maxCol },
    ],
    groups: [
      {
        id: 'graph_write',
        label: 'Escritura grafo',
        lane: 'ingest',
        fromCol: 3,
        toCol: 4,
        variant: 'emphasis',
      },
    ],
    mainPath: spec.mainPath,
    nodes: spec.nodes.map((n) => ({
      id: n.id,
      lane: n.lane,
      col: n.col,
      type: n.type,
      label: n.label,
      ...(n.sublabel ? { sublabel: n.sublabel } : {}),
      width: 132,
    })),
    edges: spec.edges.map((e) => ({
      id: e.id,
      from: e.from,
      to: e.to,
      ...(e.label ? { label: e.label } : {}),
      variant: e.variant ?? 'default',
      ...(e.role ? { role: e.role } : {}),
    })),
    cards: [
      {
        dot: 'cyan',
        title: 'Origen',
        items: ['Fases alineadas con sync.service.ts', 'Ramas de error en indexing y writing_graph'],
      },
    ],
  };
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
    ],
    mainPath: ['queued', 'mapping', 'indexing', 'writing_graph', 'embeddings', 'c4_ingest', 'completed'],
    nodes: [
      { id: 'queued', lane: 'trigger', col: 0, type: 'external', label: 'Queued', sublabel: 'sync job' },
      { id: 'mapping', lane: 'ingest', col: 1, type: 'backend', label: 'Mapping', sublabel: 'archivos / clone' },
      { id: 'indexing', lane: 'ingest', col: 2, type: 'backend', label: 'Indexing', sublabel: 'parse AST' },
      { id: 'writing_graph', lane: 'graph', col: 3, type: 'database', label: 'Writing graph', sublabel: 'MERGE Cypher' },
      { id: 'embeddings', lane: 'post', col: 4, type: 'messagebus', label: 'Embeddings', sublabel: 'RAG vectors' },
      { id: 'c4_ingest', lane: 'post', col: 5, type: 'backend', label: 'C4 ingest', sublabel: 'snapshots' },
      { id: 'completed', lane: 'post', col: 6, type: 'cloud', label: 'Completed', sublabel: 'grafo listo' },
      { id: 'failed', lane: 'ingest', col: 3, type: 'security', label: 'Failed', sublabel: 'job error' },
    ],
    edges: [
      { id: 'q-map', from: 'queued', to: 'mapping', variant: 'default' },
      { id: 'map-idx', from: 'mapping', to: 'indexing', variant: 'emphasis' },
      { id: 'idx-write', from: 'indexing', to: 'writing_graph', variant: 'emphasis' },
      { id: 'write-embed', from: 'writing_graph', to: 'embeddings', variant: 'default' },
      { id: 'embed-c4', from: 'embeddings', to: 'c4_ingest', variant: 'default' },
      { id: 'c4-done', from: 'c4_ingest', to: 'completed', variant: 'emphasis' },
      { id: 'idx-fail', from: 'indexing', to: 'failed', label: 'error', variant: 'security', role: 'error' },
      { id: 'write-fail', from: 'writing_graph', to: 'failed', label: 'error', variant: 'security', role: 'error' },
    ],
    evidence: [
      {
        source: 'package_json',
        reason: 'Fases de sync.service.ts (mapping → indexing → writing_graph → embeddings)',
      },
    ],
  };
}
