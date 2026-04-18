/**
 * @fileoverview Cliente FalkorDB: grafo principal (opcional shard por projectId) y shadow.
 */
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { FalkorDB } from 'falkordb';
import {
  SHADOW_GRAPH_NAME,
  graphNameForProject,
  shadowGraphNameForSession,
  isProjectShardingEnabled,
  domainSegmentFromRepoPath,
  effectiveShardMode,
  listGraphNamesForProjectRouting,
  type FalkorShardMode,
} from 'ariadne-common';

/** Servicio de conexión FalkorDB (getGraph(projectId?), getShadowGraph). */
@Injectable()
export class FalkorService implements OnModuleDestroy {
  private client: Awaited<ReturnType<typeof FalkorDB.connect>> | null = null;

  private routingCache = new Map<string, { shardMode: FalkorShardMode; domainSegments: string[] }>();

  private async getClient() {
    if (!this.client) {
      const host = process.env.FALKORDB_HOST ?? 'localhost';
      const port = parseInt(process.env.FALKORDB_PORT ?? '6379', 10);
      this.client = await FalkorDB.connect({ socket: { host, port } });
    }
    return this.client;
  }

  private async getProjectRouting(projectId: string): Promise<{
    shardMode: FalkorShardMode;
    domainSegments: string[];
  }> {
    const hit = this.routingCache.get(projectId);
    if (hit) return hit;
    let parsed: { shardMode: FalkorShardMode; domainSegments: string[] } = {
      shardMode: effectiveShardMode(null),
      domainSegments: [],
    };
    const base = process.env.INGEST_URL?.replace(/\/$/, '') ?? '';
    if (base) {
      try {
        const res = await fetch(`${base}/projects/${projectId}/graph-routing`, {
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const j = (await res.json()) as {
            shardMode: FalkorShardMode;
            domainSegments?: string[];
          };
          parsed = {
            shardMode: j.shardMode ?? effectiveShardMode(null),
            domainSegments: Array.isArray(j.domainSegments) ? j.domainSegments : [],
          };
        }
      } catch {
        /* ingest no alcanzable: mismo criterio que env */
      }
    }
    this.routingCache.set(projectId, parsed);
    return parsed;
  }

  /** Nombres de grafo Falkor para fan-out si hace falta (subgrafos por dominio). */
  async getProjectGraphNames(projectId: string): Promise<string[]> {
    if (!isProjectShardingEnabled()) {
      return [graphNameForProject(undefined)];
    }
    const r = await this.getProjectRouting(projectId);
    return listGraphNamesForProjectRouting(
      projectId,
      r.shardMode === 'domain' ? 'domain' : 'project',
      r.domainSegments,
    );
  }

  /**
   * Grafos Falkor y el `projectId` que llevan los nodos en cada uno (propio + whitelist de dominios vía ingest).
   * Usado por C4 y cualquier fan-out que deba alinearse con `graph-routing`.
   */
  async getCypherShardContexts(
    projectId: string,
  ): Promise<Array<{ graphName: string; cypherProjectId: string }>> {
    const pid = String(projectId ?? '').trim();
    if (!pid) {
      return [];
    }
    const base = process.env.INGEST_URL?.replace(/\/$/, '') ?? '';
    if (base) {
      try {
        const res = await fetch(`${base}/projects/${encodeURIComponent(pid)}/graph-routing`, {
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const j = (await res.json()) as {
            cypherShardContexts?: Array<{ graphName: string; cypherProjectId: string }>;
          };
          if (Array.isArray(j.cypherShardContexts) && j.cypherShardContexts.length > 0) {
            return j.cypherShardContexts;
          }
        }
      } catch {
        /* ingest no alcanzable */
      }
    }
    const names = await this.getProjectGraphNames(pid);
    return names.map((graphName) => ({ graphName, cypherProjectId: pid }));
  }

  /**
   * Grafo principal. Con FALKOR_SHARD_BY_PROJECT, pasar projectId del índice Ariadne/repo.
   * Con partición por dominio, pasar `repoRelativePath` (ruta de archivo relativa al repo) para abrir el subgrafo.
   */
  async getGraph(projectId?: string | null, opts?: { repoRelativePath?: string | null }) {
    const client = await this.getClient();
    if (!isProjectShardingEnabled() || !projectId) {
      return client.selectGraph(graphNameForProject(projectId ?? undefined));
    }
    const r = await this.getProjectRouting(projectId);
    if (r.shardMode === 'domain' && opts?.repoRelativePath) {
      return client.selectGraph(
        graphNameForProject(projectId, {
          shardMode: 'domain',
          domainSegment: domainSegmentFromRepoPath(opts.repoRelativePath),
        }),
      );
    }
    return client.selectGraph(graphNameForProject(projectId));
  }

  /** Grafo shadow (SDD / compare). Sin sesión: grafo legacy `FalkorSpecsShadow`. */
  /** Abre un grafo por nombre lógico (p. ej. fan-out multi-shard). */
  async selectGraphByLogicalName(graphName: string) {
    const client = await this.getClient();
    return client.selectGraph(graphName);
  }

  async getShadowGraph(shadowSessionId?: string | null) {
    const client = await this.getClient();
    const name =
      shadowSessionId && String(shadowSessionId).trim()
        ? shadowGraphNameForSession(String(shadowSessionId).trim())
        : SHADOW_GRAPH_NAME;
    return client.selectGraph(name);
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }
}
