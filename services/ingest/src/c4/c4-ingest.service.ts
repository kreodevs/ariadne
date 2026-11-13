/**
 * @fileoverview MERGE nodos C4 en Falkor durante sync.
 */
import { Injectable, Logger } from '@nestjs/common';
import { graphNameForProject, isProjectShardingEnabled } from '../pipeline/falkor';
import { runCypherBatch } from '../pipeline/producer';
import { FalkorClientService } from '../pipeline/falkor-client.service';
import { buildC4IngestCypher } from './c4-cypher';
import { scanC4Infrastructure } from './c4-infrastructure';
import { getC4Settings } from './c4-settings.util';
import { toGraphClient } from '../pipeline/graph-client-adapter';

@Injectable()
export class C4IngestService {
  private readonly logger = new Logger(C4IngestService.name);

  isEnabled(): boolean {
    return getC4Settings().enabled;
  }

  async ingestDuringSync(params: {
    projectId: string;
    repoId: string;
    systemName: string;
    pathSet: Set<string>;
    getContent: (relPath: string) => Promise<string | null>;
    shardMode: 'project' | 'domain';
    ensuredGraphs: Set<string>;
    prepareGraph: (relPath: string) => Promise<{ query: (cypher: string) => Promise<unknown> }>;
  }): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      const { spec } = await scanC4Infrastructure(
        params.pathSet,
        params.getContent,
        params.systemName,
      );
      const batch = buildC4IngestCypher(spec, params.projectId, params.repoId);
      const pidArg = isProjectShardingEnabled() ? params.projectId : undefined;
      const graphNames =
        params.ensuredGraphs.size > 0
          ? [...params.ensuredGraphs]
          : [
              params.shardMode === 'domain'
                ? graphNameForProject(pidArg, { shardMode: 'domain', domainSegment: '_root' })
                : graphNameForProject(pidArg),
            ];

      const client = await this.falkor.getClient();
      for (const gname of graphNames) {
        const graph = client.selectGraph(gname);
        const gc = toGraphClient(graph);
        await runCypherBatch(gc, batch.cleanup);
        await runCypherBatch(gc, batch.merge);
        await runCypherBatch(gc, batch.linkFiles);
        await graph.query(batch.rollupImports);
        await graph.query(batch.rollupCalls);
      }
    } catch (err) {
      this.logger.warn(
        `C4 ingest: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  constructor(private readonly falkor: FalkorClientService) {}
}
