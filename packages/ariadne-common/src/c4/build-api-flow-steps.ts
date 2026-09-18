import { formatHttpCallLabel } from './api-flow-labels.util.js';
import type { ApiFlowStep } from './to-archify-sequence.js';

export interface ApiFlowStepInput {
  routePath: string;
  screenName: string;
  method: string;
  apiPath?: string;
  backendPath?: string;
  handlerName?: string;
  modelName?: string;
  modelTable?: string;
  serviceMethod?: string;
  httpStatusCode?: number;
}

/** Status HTTP: explícito del grafo, o heurística Nest (POST→201, DELETE→204). */
export function inferHttpStatusCode(method: string, explicit?: number): number {
  if (explicit != null && explicit >= 100 && explicit < 600) return explicit;
  const m = method.trim().toUpperCase();
  if (m === 'POST') return 201;
  if (m === 'DELETE') return 204;
  return 200;
}

export function buildDbQueryLabel(
  input: Pick<ApiFlowStepInput, 'modelName' | 'modelTable' | 'serviceMethod'>,
): string {
  const entity = input.modelName ?? input.modelTable;
  if (input.serviceMethod && entity) return `${input.serviceMethod}(${entity})`;
  if (input.serviceMethod) return input.serviceMethod;
  if (entity) return `query ${entity}`;
  return 'query';
}

export function formatHttpResponseLabel(status: number): string {
  if (status === 204) return `${status} No Content`;
  if (status === 201) return `${status} Created`;
  return `${status} JSON`;
}

/** Pasos request/response completos para secuencia Archify. */
export function buildApiFlowSteps(input: ApiFlowStepInput): ApiFlowStep[] {
  const status = inferHttpStatusCode(input.method, input.httpStatusCode);
  const responseLabel = formatHttpResponseLabel(status);
  const clientCall = formatHttpCallLabel(input.method, input.apiPath ?? input.backendPath ?? '/api');
  const backendCall = input.backendPath ?? input.handlerName ?? 'handler';
  const dbQuery = buildDbQueryLabel(input);
  const dbReturn = input.modelName ?? input.modelTable ? `${input.modelName ?? input.modelTable} rows` : 'rows';
  const backendReturn = input.handlerName ? `${input.handlerName}()` : 'DTO';

  return [
    {
      id: 'open',
      from: 'user',
      to: 'web',
      label: `navega ${input.routePath} → ${input.screenName}`,
      variant: 'default',
    },
    {
      id: 'call',
      from: 'web',
      to: 'api',
      label: clientCall,
      variant: 'emphasis',
    },
    {
      id: 'handler',
      from: 'api',
      to: 'backend',
      label: backendCall,
      variant: 'emphasis',
    },
    {
      id: 'db',
      from: 'backend',
      to: 'db',
      label: dbQuery,
      variant: 'dashed',
    },
    {
      id: 'db-return',
      from: 'db',
      to: 'backend',
      label: dbReturn,
      variant: 'return',
    },
    {
      id: 'backend-return',
      from: 'backend',
      to: 'api',
      label: backendReturn,
      variant: 'return',
    },
    {
      id: 'response',
      from: 'api',
      to: 'web',
      label: responseLabel,
      variant: 'return',
    },
  ];
}
