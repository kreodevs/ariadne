/**
 * @fileoverview Cliente FalkorDB: grafo principal (opcional shard por projectId) y shadow.
 */
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { FalkorDB } from 'falkordb';
import { SHADOW_GRAPH_NAME, graphNameForProject } from 'ariadne-common';

/** Servicio de conexión FalkorDB (getGraph(projectId?), getShadowGraph). */
@Injectable()
export class FalkorService implements OnModuleDestroy {
  private client: Awaited<ReturnType<typeof FalkorDB.connect>> | null = null;

  private async getClient() {
    if (!this.client) {
      const host = process.env.FALKORDB_HOST ?? 'localhost';
      const port = parseInt(process.env.FALKORDB_PORT ?? '6379', 10);
      this.client = await FalkorDB.connect({ socket: { host, port } });
    }
    return this.client;
  }

  /**
   * Grafo principal. Con FALKOR_SHARD_BY_PROJECT, pasar projectId del índice Ariadne/repo.
   */
  async getGraph(projectId?: string | null) {
    const client = await this.getClient();
    return client.selectGraph(graphNameForProject(projectId ?? undefined));
  }

  /** Grafo shadow (SDD / compare). */
  async getShadowGraph() {
    const client = await this.getClient();
    return client.selectGraph(SHADOW_GRAPH_NAME);
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }
}
