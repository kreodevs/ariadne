import type { ApiFlowStepInput } from './build-api-flow-steps.js';
import { buildDbQueryLabel, formatHttpResponseLabel, inferHttpStatusCode } from './build-api-flow-steps.js';
import type { SyncWorkflowSpec } from './to-archify-workflow.js';

/** Convierte un flujo API indexado (misma evidencia que secuencia) en workflow Archify. */
export function buildRouteFlowWorkflowSpec(input: ApiFlowStepInput & { screenName?: string }): SyncWorkflowSpec {
  const route = input.routePath;
  const screen = input.screenName ?? 'Screen';
  const status = inferHttpStatusCode(input.method, input.httpStatusCode);
  const responseLabel = formatHttpResponseLabel(status);
  const clientCall = `${input.method} ${input.apiPath ?? input.backendPath ?? '/api'}`;
  const dbQuery = buildDbQueryLabel(input);

  return {
    title: `Feature flow — ${route}`,
    subtitle: `${screen} · request/response`,
    lanes: [
      { id: 'trigger', label: 'Entrada' },
      { id: 'client', label: 'Cliente' },
      { id: 'api', label: 'API' },
      { id: 'data', label: 'Datos' },
      { id: 'response', label: 'Respuesta' },
      { id: 'exceptions', label: 'Errores', variant: 'exception' },
    ],
    mainPath: ['navigate', 'request', 'handler', 'query', 'respond', 'render'],
    nodes: [
      { id: 'navigate', lane: 'trigger', col: 0, type: 'external', label: 'Navigate', sublabel: route },
      { id: 'request', lane: 'client', col: 1, type: 'frontend', label: 'HTTP request', sublabel: clientCall },
      {
        id: 'handler',
        lane: 'api',
        col: 2,
        type: 'backend',
        label: 'Handler',
        sublabel: input.handlerName ?? input.backendPath ?? 'route',
      },
      {
        id: 'query',
        lane: 'data',
        col: 3,
        type: 'database',
        label: 'Query',
        sublabel: dbQuery,
      },
      { id: 'respond', lane: 'response', col: 4, type: 'backend', label: 'Respond', sublabel: responseLabel },
      { id: 'render', lane: 'response', col: 5, type: 'frontend', label: 'Render UI', sublabel: screen },
      { id: 'failed', lane: 'exceptions', col: 2, type: 'security', label: 'Error', sublabel: '4xx / 5xx' },
    ],
    edges: [
      { id: 'nav-req', from: 'navigate', to: 'request', variant: 'default' },
      {
        id: 'req-handler',
        from: 'request',
        to: 'handler',
        variant: 'emphasis',
        route: 'drop',
        fromSide: 'bottom',
        toSide: 'top',
      },
      { id: 'handler-query', from: 'handler', to: 'query', variant: 'emphasis' },
      {
        id: 'query-respond',
        from: 'query',
        to: 'respond',
        variant: 'default',
        route: 'drop',
        fromSide: 'bottom',
        toSide: 'top',
      },
      { id: 'respond-render', from: 'respond', to: 'render', variant: 'emphasis' },
      {
        id: 'handler-fail',
        from: 'handler',
        to: 'failed',
        variant: 'security',
        role: 'error',
        route: 'bottom-channel',
        fromSide: 'bottom',
        toSide: 'top',
      },
    ],
    evidence: [{ source: 'falkor', reason: `Route flow ${route}` }],
  };
}
