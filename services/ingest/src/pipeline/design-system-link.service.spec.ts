import { describe, expect, it, vi, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { CypherGuardError, validateReadOnlyCypher } from 'ariadne-common';
import { DesignSystemLinkService } from './design-system-link.service';

type QueryCall = { cypher: string; options?: { params: Record<string, unknown> } };

function buildHarness(opts?: {
  shards?: Array<{ graphName: string; cypherProjectId: string }>;
  mergeError?: Error;
  getClientError?: Error;
}) {
  const calls: QueryCall[] = [];
  const graph = {
    query: vi.fn(async (cypher: string, options?: { params: Record<string, unknown> }) => {
      calls.push({ cypher, options });
      if (opts?.mergeError && cypher.includes('MERGE (ds:DesignSystemComponent')) {
        throw opts.mergeError;
      }
      if (cypher.includes('-[:IMPORTS]->')) {
        return { data: [{ fromPath: 'src/App.tsx', toPath: 'src/components/ui/button.tsx' }] };
      }
      if (cypher.includes('-[:CONTAINS]->(c:Component)')) {
        return { data: [{ name: 'App' }] };
      }
      return { data: [] };
    }),
  };
  const selectGraph = vi.fn(() => graph);
  const falkor = {
    getClient: vi.fn(async () => {
      if (opts?.getClientError) throw opts.getClientError;
      return { selectGraph };
    }),
  };
  const projects = {
    getCypherShardContexts: vi.fn(async () =>
      opts?.shards ?? [{ graphName: 'graph_proj_1', cypherProjectId: 'proj-1' }],
    ),
  };
  // Cast: el servicio solo usa estos dos métodos de cada dependencia.
  const service = new DesignSystemLinkService(falkor as never, projects as never);
  return { service, calls, selectGraph, falkor, projects };
}

describe('DesignSystemLinkService.linkAfterSync', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('escribe los enlaces MERGE por la ruta de escritura del grafo, no por el guard read-only', async () => {
    const { service, calls, selectGraph } = buildHarness();

    const result = await service.linkAfterSync('proj-1', 'repo-1');

    expect(result).toEqual({ linked: 1 });
    expect(selectGraph).toHaveBeenCalledWith('graph_proj_1');

    const mergeCall = calls.find((c) => c.cypher.includes('MERGE (ds:DesignSystemComponent'));
    expect(mergeCall).toBeDefined();
    expect(mergeCall?.options?.params).toMatchObject({
      dsName: 'shadcn:button',
      lib: 'shadcn',
      compName: 'App',
      projectId: 'proj-1',
      repoId: 'repo-1',
    });

    // Premisa del bug: ese mismo Cypher es rechazado por el guard read-only de query_graph.
    expect(() => validateReadOnlyCypher(mergeCall!.cypher)).toThrow(CypherGuardError);
  });

  it('no aplica LIMIT del executor de chat a las lecturas de imports', async () => {
    const { service, calls } = buildHarness();

    await service.linkAfterSync('proj-1', 'repo-1');

    const importsRead = calls.find((c) => c.cypher.includes('-[:IMPORTS]->'));
    expect(importsRead?.cypher).not.toMatch(/\bLIMIT\b/);
  });

  it('un fallo de escritura en el paso post-sync no propaga excepción y se registra', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { service } = buildHarness({ mergeError: new Error('Missing parameters') });

    await expect(service.linkAfterSync('proj-1', 'repo-1')).resolves.toEqual({ linked: 0 });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Missing parameters'));
  });

  it('un fallo al obtener el cliente Falkor no propaga excepción', async () => {
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { service } = buildHarness({ getClientError: new Error('connect ECONNREFUSED') });

    await expect(service.linkAfterSync('proj-1', 'repo-1')).resolves.toEqual({ linked: 0 });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
  });

  it('usa el grafo por defecto del proyecto si no hay shards resueltos', async () => {
    const { service, selectGraph, projects } = buildHarness({ shards: [] });

    await service.linkAfterSync('proj-1', 'repo-1');

    expect(projects.getCypherShardContexts).toHaveBeenCalledWith('proj-1');
    expect(selectGraph).toHaveBeenCalled();
  });
});
