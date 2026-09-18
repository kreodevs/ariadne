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
  route?: 'auto' | 'straight' | 'drop' | 'bottom-channel' | 'top-channel' | 'right-channel' | 'left-channel';
  fromSide?: 'left' | 'right' | 'top' | 'bottom';
  toSide?: 'left' | 'right' | 'top' | 'bottom';
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
    from: string;
    to: string;
    variant?: string;
    label?: string;
    route?: string;
    fromSide?: string;
    toSide?: string;
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
      viewBox: [Math.max(980, (maxCol + 1) * 196), 680],
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
      from: t.from,
      to: t.to,
      variant: t.variant ?? 'default',
      ...(t.label ? { label: t.label } : {}),
      ...(t.route ? { route: t.route } : {}),
      ...(t.fromSide ? { fromSide: t.fromSide } : {}),
      ...(t.toSide ? { toSide: t.toSide } : {}),
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
      { id: 'terminal', label: 'Terminal' },
    ],
    states: [
      { id: 'queued', type: 'start', label: 'Queued', sublabel: 'job creado', lane: 'main', col: 0, tag: 'entry' },
      { id: 'running', type: 'active', label: 'Running', sublabel: 'worker activo', lane: 'main', col: 1, tag: 'work' },
      { id: 'indexing', type: 'active', label: 'Indexing', sublabel: 'parse files', lane: 'main', col: 2, tag: 'phase' },
      { id: 'writing_graph', type: 'active', label: 'Writing graph', sublabel: 'Falkor MERGE', lane: 'main', col: 3, tag: 'phase' },
      { id: 'completed', type: 'success', label: 'Completed', sublabel: 'grafo fresco', lane: 'main', col: 4, tag: 'done' },
      { id: 'failed', type: 'failure', label: 'Failed', sublabel: 'error / timeout', lane: 'terminal', col: 2, tag: 'terminal' },
    ],
    transitions: [
      { id: 'q-run', from: 'queued', to: 'running', variant: 'emphasis' },
      { id: 'run-idx', from: 'running', to: 'indexing', variant: 'default' },
      { id: 'idx-write', from: 'indexing', to: 'writing_graph', variant: 'default' },
      { id: 'write-done', from: 'writing_graph', to: 'completed', variant: 'emphasis' },
      {
        id: 'write-fail',
        from: 'writing_graph',
        to: 'failed',
        variant: 'security',
        route: 'bottom-channel',
        fromSide: 'bottom',
        toSide: 'top',
      },
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
      { id: 'main', label: 'Request path' },
      { id: 'terminal', label: 'Respuesta' },
    ],
    states: [
      { id: 'navigate', type: 'start', label: 'Navigate', sublabel: route, lane: 'main', col: 0 },
      { id: 'request', type: 'active', label: 'HTTP request', sublabel: 'fetch / axios', lane: 'main', col: 1 },
      { id: 'handler', type: 'active', label: 'Handler', sublabel: 'Nest route', lane: 'main', col: 2 },
      { id: 'query', type: 'active', label: 'Query', sublabel: 'DB read/write', lane: 'main', col: 3 },
      { id: 'respond', type: 'decision', label: 'Respond', sublabel: '2xx JSON', lane: 'main', col: 4 },
      { id: 'render', type: 'success', label: 'Render UI', sublabel: 'pantalla actualizada', lane: 'terminal', col: 1 },
      { id: 'error', type: 'failure', label: 'Error', sublabel: '4xx / 5xx', lane: 'terminal', col: 2 },
    ],
    transitions: [
      { id: 'nav-req', from: 'navigate', to: 'request', variant: 'emphasis' },
      { id: 'req-handler', from: 'request', to: 'handler', variant: 'emphasis' },
      { id: 'handler-query', from: 'handler', to: 'query', variant: 'default' },
      { id: 'query-respond', from: 'query', to: 'respond', variant: 'default' },
      {
        id: 'respond-render',
        from: 'respond',
        to: 'render',
        variant: 'emphasis',
        route: 'bottom-channel',
        fromSide: 'bottom',
        toSide: 'top',
      },
      {
        id: 'query-error',
        from: 'query',
        to: 'error',
        variant: 'security',
        route: 'bottom-channel',
        fromSide: 'bottom',
        toSide: 'top',
      },
    ],
    evidence: [
      {
        source: 'navigation_map',
        reason: 'Ciclo request/response complementario a secuencia Archify',
      },
    ],
  };
}
