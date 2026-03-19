/**
 * @fileoverview Cliente FalkorDB: grafo principal y shadow.
 */
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { FalkorDB } from 'falkordb';

const GRAPH_NAME = 'FalkorSpecs';
const SHADOW_GRAPH_NAME = 'FalkorSpecsShadow';

/** Servicio de conexión FalkorDB (getGraph, getShadowGraph). */
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
   * Devuelve el grafo principal FalkorSpecs (conexión singleton).
   * @returns {Promise<Graph>}
   */
  async getGraph() {
    const client = await this.getClient();
    return client.selectGraph(GRAPH_NAME);
  }

  /**
   * Devuelve el grafo shadow FalkorSpecsShadow para compare SDD.
   * @returns {Promise<Graph>}
   */
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
