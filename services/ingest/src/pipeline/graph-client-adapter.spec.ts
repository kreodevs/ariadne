import { describe, expect, it, vi } from 'vitest';
import { executeUnwindBatch } from 'ariadne-common';
import { toGraphClient } from './graph-client-adapter';

describe('toGraphClient', () => {
  it('reenvía los parámetros de la sentencia (no los descarta)', async () => {
    const query = vi.fn(async () => ({ data: [] }));
    const client = toGraphClient({ query });

    await client.query('UNWIND $batch AS f RETURN f', { params: { batch: [{ path: 'a.ts' }] } });

    expect(query).toHaveBeenCalledWith('UNWIND $batch AS f RETURN f', {
      params: { batch: [{ path: 'a.ts' }] },
    });
  });

  it('sin parámetros llama al grafo solo con la sentencia', async () => {
    const query = vi.fn(async () => ({ data: [] }));
    const client = toGraphClient({ query });

    await client.query('MATCH (n) RETURN n');

    expect(query).toHaveBeenCalledWith('MATCH (n) RETURN n');
  });

  it('executeUnwindBatch envía $batch y los parámetros estáticos al grafo', async () => {
    const query = vi.fn(async () => ({ data: [] }));
    const client = toGraphClient({ query });

    await executeUnwindBatch(
      client,
      'UNWIND $batch AS f MERGE (file:File {path: f.path, projectId: $projectId})',
      [{ path: 'a.ts' }, { path: 'b.ts' }],
      500,
      { projectId: 'proj-1', repoId: 'repo-1' },
    );

    expect(query).toHaveBeenCalledTimes(1);
    const [, options] = query.mock.calls[0] as unknown as [string, { params: Record<string, unknown> }];
    expect(options.params).toMatchObject({
      projectId: 'proj-1',
      repoId: 'repo-1',
      batch: [{ path: 'a.ts' }, { path: 'b.ts' }],
    });
  });
});
