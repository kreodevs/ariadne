import type { C4Evidence } from './c4-model.types.js';

export interface LifecycleState {
  id: string;
  type: 'start' | 'active' | 'waiting' | 'decision' | 'success' | 'failure' | 'neutral';
  label: string;
  sublabel?: string;
  lane: string;
  col: number;
  tag?: string;
}

export interface LifecycleTransition {
  id: string;
  from: string;
  to: string;
  variant?: 'default' | 'emphasis' | 'security' | 'dashed';
  label?: string;
}

export interface EntityLifecycleSpec {
  title: string;
  subtitle?: string;
  lanes: Array<{ id: string; label: string }>;
  states: LifecycleState[];
  transitions: LifecycleTransition[];
  evidence?: C4Evidence[];
}

export interface ArchifyLifecycleIr {
  schema_version: 1;
  diagram_type: 'lifecycle';
  meta: {
    title: string;
    subtitle?: string;
    animation?: 'trace' | 'none';
    quality_profile?: 'showcase';
    viewBox?: [number, number];
  };
  lanes: Array<{ id: string; label: string }>;
  states: Array<{
    id: string;
    type: string;
    label: string;
    sublabel?: string;
    lane: string;
    col: number;
    step?: string;
    tag?: string;
  }>;
  transitions: Array<{
    id: string;
    from: string;
    to: string;
    variant?: string;
    label?: string;
  }>;
  cards?: Array<{ dot: string; title: string; items: string[] }>;
}

export function entityLifecycleToArchifyLifecycle(spec: EntityLifecycleSpec): ArchifyLifecycleIr {
  const maxCol = spec.states.reduce((m, s) => Math.max(m, s.col), 0);
  return {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: {
      title: spec.title,
      subtitle: spec.subtitle,
      animation: 'trace',
      quality_profile: 'showcase',
      viewBox: [Math.max(900, (maxCol + 1) * 180), 560],
    },
    lanes: spec.lanes,
    states: spec.states.map((s, i) => ({
      id: s.id,
      type: s.type,
      label: s.label,
      ...(s.sublabel ? { sublabel: s.sublabel } : {}),
      lane: s.lane,
      col: s.col,
      step: String(i + 1).padStart(2, '0'),
      ...(s.tag ? { tag: s.tag } : {}),
    })),
    transitions: spec.transitions.map((t) => ({
      id: t.id,
      from: t.from,
      to: t.to,
      variant: t.variant ?? 'default',
      ...(t.label ? { label: t.label } : {}),
    })),
    cards: [
      {
        dot: 'emerald',
        title: spec.title,
        items: [
          'Estados ordenados de izquierda a derecha',
          'Transiciones de error y terminal sin retorno',
        ],
      },
    ],
  };
}

export function buildSyncJobLifecycleSpec(projectLabel?: string): EntityLifecycleSpec {
  return {
    title: projectLabel ? `Sync job — ${projectLabel}` : 'Sync job lifecycle',
    subtitle: 'Estados Postgres sync_jobs + fases payload',
    lanes: [
      { id: 'main', label: 'Progreso' },
      { id: 'waiting', label: 'En curso' },
      { id: 'terminal', label: 'Terminal' },
    ],
    states: [
      { id: 'queued', type: 'start', label: 'Queued', sublabel: 'job creado', lane: 'main', col: 0, tag: 'entry' },
      { id: 'running', type: 'active', label: 'Running', sublabel: 'worker activo', lane: 'main', col: 1, tag: 'work' },
      { id: 'indexing', type: 'active', label: 'Indexing', sublabel: 'parse files', lane: 'waiting', col: 0, tag: 'phase' },
      { id: 'writing_graph', type: 'active', label: 'Writing graph', sublabel: 'Falkor MERGE', lane: 'waiting', col: 1, tag: 'phase' },
      { id: 'completed', type: 'success', label: 'Completed', sublabel: 'grafo fresco', lane: 'main', col: 2, tag: 'done' },
      { id: 'failed', type: 'failure', label: 'Failed', sublabel: 'error / timeout', lane: 'terminal', col: 0, tag: 'terminal' },
    ],
    transitions: [
      { id: 'q-run', from: 'queued', to: 'running', variant: 'emphasis' },
      { id: 'run-idx', from: 'running', to: 'indexing', variant: 'default' },
      { id: 'idx-write', from: 'indexing', to: 'writing_graph', variant: 'default' },
      { id: 'write-done', from: 'writing_graph', to: 'completed', variant: 'emphasis' },
      { id: 'run-fail', from: 'running', to: 'failed', variant: 'security', label: 'error' },
      { id: 'idx-fail', from: 'indexing', to: 'failed', variant: 'security', label: 'parse error' },
      { id: 'write-fail', from: 'writing_graph', to: 'failed', variant: 'security', label: 'graph error' },
    ],
    evidence: [
      {
        source: 'package_json',
        reason: 'SyncJob.status + payload.phase en sync.service.ts',
      },
    ],
  };
}

export function buildApiRequestLifecycleSpec(routePath?: string): EntityLifecycleSpec {
  const route = routePath ?? '/api/resource';
  return {
    title: `Request lifecycle — ${route}`,
    subtitle: 'Navegación UI → API → persistencia → respuesta',
    lanes: [
      { id: 'client', label: 'Cliente' },
      { id: 'server', label: 'Servidor' },
      { id: 'data', label: 'Datos' },
      { id: 'terminal', label: 'Respuesta' },
    ],
    states: [
      { id: 'navigate', type: 'start', label: 'Navigate', sublabel: route, lane: 'client', col: 0 },
      { id: 'request', type: 'active', label: 'HTTP request', sublabel: 'fetch / axios', lane: 'client', col: 1 },
      { id: 'handler', type: 'active', label: 'Handler', sublabel: 'Nest route', lane: 'server', col: 0 },
      { id: 'query', type: 'active', label: 'Query', sublabel: 'DB read/write', lane: 'data', col: 0 },
      { id: 'respond', type: 'decision', label: 'Respond', sublabel: '2xx JSON', lane: 'terminal', col: 0 },
      { id: 'render', type: 'success', label: 'Render UI', sublabel: 'pantalla actualizada', lane: 'terminal', col: 1 },
      { id: 'error', type: 'failure', label: 'Error', sublabel: '4xx / 5xx', lane: 'terminal', col: 2 },
    ],
    transitions: [
      { id: 'nav-req', from: 'navigate', to: 'request', variant: 'emphasis' },
      { id: 'req-handler', from: 'request', to: 'handler', variant: 'emphasis' },
      { id: 'handler-query', from: 'handler', to: 'query', variant: 'default' },
      { id: 'query-respond', from: 'query', to: 'respond', variant: 'default' },
      { id: 'respond-render', from: 'respond', to: 'render', variant: 'emphasis' },
      { id: 'handler-error', from: 'handler', to: 'error', variant: 'security', label: 'exception' },
      { id: 'query-error', from: 'query', to: 'error', variant: 'security', label: 'db error' },
    ],
    evidence: [
      {
        source: 'navigation_map',
        reason: 'Ciclo request/response complementario a secuencia Archify',
      },
    ],
  };
}
