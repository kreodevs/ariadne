/**
 * Post-sync: link Components to shadcn/Kreo design-system imports via File IMPORTS edges.
 *
 * Escribe en FalkorDB por la ruta de escritura del ingest (cliente compartido + shards del proyecto),
 * NO por `ChatCypherService.executeCypher`: ese executor es read-only (`guardCypherQuery`) y bloquea MERGE.
 * Nunca lanza: un fallo aquí se registra en log y no debe afectar al job de sync ya completado.
 */
import { Injectable, Logger } from '@nestjs/common';
import { FalkorClientService, type FalkorDbClient } from './falkor-client.service';
import { graphNameForProject, isProjectShardingEnabled } from './falkor';
import { ProjectsService } from '../projects/projects.service';

const SHADCN_PATTERNS = [
  '/components/ui/',
  '@/components/ui/',
  'components/ui/',
];

const KREO_PATTERNS = ['@kreo/', '/kreo/', 'kreo-ui', '@kreodevs/kreo'];

export function classifyImportPath(importPath: string): 'shadcn' | 'kreo' | null {
  const p = importPath.toLowerCase();
  if (SHADCN_PATTERNS.some((x) => p.includes(x.replace('@/', '')) || p.includes('components/ui'))) {
    return 'shadcn';
  }
  if (KREO_PATTERNS.some((x) => p.includes(x.toLowerCase()))) return 'kreo';
  return null;
}

type ShardTarget = { graphName: string; cypherProjectId: string };

type GraphHandle = ReturnType<FalkorDbClient['selectGraph']>;
type QueryOptions = NonNullable<Parameters<GraphHandle['query']>[1]>;

@Injectable()
export class DesignSystemLinkService {
  private readonly logger = new Logger(DesignSystemLinkService.name);

  constructor(
    private readonly falkor: FalkorClientService,
    private readonly projects: ProjectsService,
  ) {}

  async linkAfterSync(projectId: string, repoId: string): Promise<{ linked: number }> {
    let linked = 0;
    try {
      const client = await this.falkor.getClient();
      const shards = await this.resolveShards(projectId);
      for (const shard of shards) {
        try {
          linked += await this.linkShard(client.selectGraph(shard.graphName), shard.cypherProjectId, repoId);
        } catch (err) {
          this.logger.error(
            `Design-system link failed on graph ${shard.graphName} for repo ${repoId}: ${errorMessage(err)}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(`Design-system link failed for repo ${repoId}: ${errorMessage(err)}`);
    }
    if (linked > 0) this.logger.log(`Design-system links: ${linked} for repo ${repoId}`);
    return { linked };
  }

  private async resolveShards(projectId: string): Promise<ShardTarget[]> {
    const contexts = await this.projects.getCypherShardContexts(projectId);
    if (contexts.length > 0) return contexts;
    return [
      {
        graphName: graphNameForProject(isProjectShardingEnabled() ? projectId : undefined),
        cypherProjectId: projectId,
      },
    ];
  }

  /** Lee imports y componentes de un grafo y escribe los enlaces DS en ese mismo grafo. */
  private async linkShard(graph: GraphHandle, projectId: string, repoId: string): Promise<number> {
    const rows = (await this.run(
      graph,
      `MATCH (a:File {projectId: $projectId, repoId: $repoId})-[:IMPORTS]->(b:File)
       RETURN a.path AS fromPath, b.path AS toPath`,
      { projectId, repoId },
    )) as Array<{ fromPath?: string; toPath?: string }>;

    let linked = 0;
    for (const row of rows) {
      const fromPath = String(row.fromPath ?? '');
      const toPath = String(row.toPath ?? '');
      const lib = classifyImportPath(toPath);
      if (!lib) continue;
      const compRows = (await this.run(
        graph,
        `MATCH (f:File {path: $fromPath, projectId: $projectId, repoId: $repoId})-[:CONTAINS]->(c:Component)
         RETURN c.name AS name LIMIT 5`,
        { fromPath, projectId, repoId },
      )) as Array<{ name?: string }>;
      for (const cr of compRows) {
        const compName = String(cr.name ?? '');
        if (!compName) continue;
        const dsName = `${lib}:${toPath.split('/').pop()?.replace(/\.tsx?$/, '') ?? 'unknown'}`;
        await this.run(
          graph,
          `MERGE (ds:DesignSystemComponent {name: $dsName, library: $lib, projectId: $projectId, repoId: $repoId})
           ON CREATE SET ds.importPath = $toPath
           WITH ds
           MATCH (c:Component {name: $compName, projectId: $projectId, repoId: $repoId})
           MERGE (c)-[:USES_DS_COMPONENT]->(ds)`,
          { dsName, lib, toPath, compName, projectId, repoId },
        );
        linked++;
      }
    }
    return linked;
  }

  private async run(graph: GraphHandle, cypher: string, params: Record<string, unknown>): Promise<unknown[]> {
    const res = (await graph.query(cypher, { params: params as QueryOptions['params'] })) as
      | { data?: unknown[] }
      | undefined;
    return res?.data ?? [];
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
