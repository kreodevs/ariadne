import { describe, expect, it } from 'vitest';
import { listOpenApiOperationsFromRoot } from './openapi-spec-ingest';

describe('openapi-spec-ingest', () => {
  it('extrae successStatusCode del primer 2xx en responses', () => {
    const ops = listOpenApiOperationsFromRoot({
      paths: {
        '/events': {
          get: { responses: { '200': { description: 'ok' } } },
          post: { responses: { '201': { description: 'created' }, '400': {} } },
        },
      },
    });
    expect(ops.find((o) => o.method === 'GET')?.successStatusCode).toBe(200);
    expect(ops.find((o) => o.method === 'POST')?.successStatusCode).toBe(201);
  });
});
