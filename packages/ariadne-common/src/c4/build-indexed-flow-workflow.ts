import type { IndexedFlowPayload } from './workflow-targets.types.js';
import type { SyncWorkflowEdge, SyncWorkflowSpec } from './to-archify-workflow.js';

export function buildEnumStatusWorkflowSpec(
  enumName: string,
  modelName: string,
  fieldName: string,
  values: string[],
): SyncWorkflowSpec {
  const ids = values.map((v, i) => `s${i}`);
  const mainPath = ids.length > 0 ? ids : ['start'];
  const nodes =
    values.length > 0
      ? values.map((value, i) => ({
          id: ids[i]!,
          lane: 'main',
          col: Math.min(5, i),
          type: i === 0 ? 'external' : i === values.length - 1 ? 'cloud' : 'backend',
          label: value,
          sublabel: `${modelName}.${fieldName}`,
        }))
      : [{ id: 'start', lane: 'main', col: 0, type: 'external', label: enumName, sublabel: 'sin valores' }];

  return {
    title: `${modelName}.${fieldName} — ${enumName}`,
    subtitle: 'Estados Prisma indexados',
    lanes: [{ id: 'main', label: 'Estados' }],
    mainPath,
    nodes,
    edges: ids.slice(0, -1).map((from, i) => ({
      id: `e-${i}`,
      from,
      to: ids[i + 1]!,
      variant: 'emphasis' as const,
    })),
    evidence: [{ source: 'package_json', reason: `Enum ${enumName} en schema Prisma` }],
  };
}

export function buildServiceChainWorkflowSpec(
  routeLabel: string,
  handlerName: string,
  chain: string[],
): SyncWorkflowSpec {
  const steps = [handlerName, ...chain.filter((s) => s !== handlerName)].slice(0, 6);
  const ids = steps.map((_, i) => `step${i}`);
  const nodes = steps.map((name, i) => ({
    id: ids[i]!,
    lane: i % 2 === 0 ? 'api' : 'service',
    col: Math.min(5, i),
    type: i === 0 ? 'backend' : i === steps.length - 1 ? 'database' : 'backend',
    label: name,
    sublabel: i === 0 ? 'handler' : 'CALLS',
  }));

  return {
    title: `Service chain — ${routeLabel}`,
    subtitle: handlerName,
    lanes: [
      { id: 'api', label: 'Controller' },
      { id: 'service', label: 'Servicios' },
    ],
    mainPath: ids,
    nodes,
    edges: ids.slice(0, -1).map((from, i) => ({
      id: `c-${i}`,
      from,
      to: ids[i + 1]!,
      variant: 'emphasis' as const,
      ...(i > 0 ? { route: 'drop' as const, fromSide: 'bottom' as const, toSide: 'top' as const } : {}),
    })),
    evidence: [{ source: 'falkor', reason: `CALLS chain desde ${handlerName}` }],
  };
}

export function buildJourneyWorkflowSpec(
  segment: string,
  routes: string[],
): SyncWorkflowSpec {
  const limited = routes.slice(0, 6);
  const ids = limited.map((_, i) => `r${i}`);
  return {
    title: `Journey — ${segment}`,
    subtitle: `${limited.length} rutas relacionadas`,
    lanes: [{ id: 'main', label: 'Navegación' }],
    mainPath: ids,
    nodes: limited.map((path, i) => ({
      id: ids[i]!,
      lane: 'main',
      col: Math.min(5, i),
      type: i === 0 ? 'external' : i === limited.length - 1 ? 'cloud' : 'frontend',
      label: path.split('/').filter(Boolean).pop() ?? path,
      sublabel: path,
    })),
    edges: ids.slice(0, -1).map((from, i) => ({
      id: `j-${i}`,
      from,
      to: ids[i + 1]!,
      variant: 'default' as const,
    })),
    evidence: [{ source: 'navigation_map', reason: `Prefijo de ruta ${segment}` }],
  };
}

export function indexedFlowPayloadToWorkflowSpec(payload: IndexedFlowPayload): SyncWorkflowSpec {
  const edges: SyncWorkflowEdge[] = payload.edges.map((e) => ({
    id: e.id,
    from: e.from,
    to: e.to,
    label: e.label,
    variant: e.variant,
    role: e.role,
    route: e.route as SyncWorkflowEdge['route'],
    fromSide: e.fromSide as SyncWorkflowEdge['fromSide'],
    toSide: e.toSide as SyncWorkflowEdge['toSide'],
  }));
  return {
    title: payload.title,
    subtitle: payload.subtitle,
    lanes: payload.lanes,
    mainPath: payload.mainPath,
    nodes: payload.nodes,
    edges,
    evidence: [{ source: 'falkor', reason: `Flow indexado (${payload.kind})` }],
  };
}
