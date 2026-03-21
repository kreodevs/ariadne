/**
 * Servicio de ejecución Cypher y formateo de resultados para el chat.
 * Centraliza conexión a FalkorDB y presentación de datos para reducir complejidad en ChatService.
 */

import { Injectable } from '@nestjs/common';
import { FalkorDB } from 'falkordb';
import { getFalkorConfig, GRAPH_NAME } from '../pipeline/falkor';
import { RepositoriesService } from '../repositories/repositories.service';

@Injectable()
export class ChatCypherService {
  constructor(private readonly repos: RepositoriesService) {}

  private async resolveProjectIdForRepo(repoId: string): Promise<string> {
    const ids = await this.repos.getProjectIdsForRepo(repoId);
    return ids[0] ?? repoId;
  }

  /** Prefijos típicos de monorepos para muestreo estratificado (evita sesgo alfabético hacia apps/admin). */
  private static MONOREPO_PREFIXES = ['apps/admin', 'apps/api', 'apps/worker', 'apps/web', 'packages/'];

  /** Resumen de lo indexado en FalkorDB. full=true devuelve todos los ítems (sin LIMIT); si no, muestras estratificadas por apps/ para monorepos. */
  async getGraphSummary(repositoryId: string, full = false): Promise<{
    counts: Record<string, number>;
    samples: Record<string, unknown[]>;
  }> {
    const repo = await this.repos.findOne(repositoryId);
    const projectId = await this.resolveProjectIdForRepo(repo.id);

    const config = getFalkorConfig();
    const client = await FalkorDB.connect({
      socket: { host: config.host, port: config.port },
    });

    const limit = full ? '' : ' LIMIT 12';
    const limitPerPrefix = full ? '' : ' LIMIT 4';
    const labels = ['File', 'Component', 'Function', 'Model', 'Route', 'Hook', 'Context', 'DomainConcept', 'Prop', 'NestController', 'NestService', 'NestModule'];
    const counts: Record<string, number> = {};
    const samples: Record<string, unknown[]> = {};

    try {
      const graph = client.selectGraph(GRAPH_NAME);
      const params = { projectId };

      for (const label of labels) {
        const countRes = await graph.query(
          `MATCH (n:${label}) WHERE n.projectId = $projectId RETURN count(n) as c`,
          { params },
        );
        const count = ((countRes as { data?: [{ c: number }] })?.data?.[0]?.c) ?? 0;
        if (count > 0) {
          counts[label] = count;

          const pathLabels = ['File', 'Component', 'Function', 'Model', 'Route', 'NestController', 'NestService', 'NestModule'];
          const useStratified = !full && pathLabels.includes(label);

          if (useStratified) {
            const seen = new Set<string>();
            const merged: Record<string, unknown>[] = [];
            for (const prefix of ChatCypherService.MONOREPO_PREFIXES) {
              let q: string;
              if (label === 'File') {
                q = `MATCH (n:File) WHERE n.projectId = $projectId AND n.path STARTS WITH $prefix RETURN n.path as path ORDER BY n.path${limitPerPrefix}`;
              } else if (label === 'Component') {
                q = `MATCH (f:File)-[:CONTAINS]->(n:Component) WHERE n.projectId = $projectId AND f.projectId = $projectId AND f.path STARTS WITH $prefix RETURN f.path as path, n.name as name ORDER BY f.path, n.name${limitPerPrefix}`;
              } else if (label === 'Function') {
                q = `MATCH (n:Function) WHERE n.projectId = $projectId AND n.path STARTS WITH $prefix RETURN n.path as path, n.name as name ORDER BY n.path, n.name${limitPerPrefix}`;
              } else if (label === 'Model') {
                q = `MATCH (n:Model) WHERE n.projectId = $projectId AND n.path STARTS WITH $prefix RETURN n.path as path, n.name as name ORDER BY n.path, n.name${limitPerPrefix}`;
              } else if (label === 'Route') {
                q = `MATCH (n:Route) WHERE n.projectId = $projectId AND n.path STARTS WITH $prefix RETURN n.path as path, n.componentName as componentName ORDER BY n.path${limitPerPrefix}`;
              } else {
                q = `MATCH (n:${label}) WHERE n.projectId = $projectId AND n.path STARTS WITH $prefix RETURN n.name as name, n.path as path ORDER BY n.path, n.name${limitPerPrefix}`;
              }
              try {
                const res = await graph.query(q, { params: { ...params, prefix } });
                const rows = (res as { data?: Record<string, unknown>[] })?.data ?? [];
                for (const row of rows) {
                  const key = (row.path ?? row.name ?? JSON.stringify(row)) as string;
                  if (!seen.has(key)) {
                    seen.add(key);
                    merged.push(row);
                  }
                }
              } catch {
                /* prefix sin resultados, seguir */
              }
            }
            if (merged.length > 0) {
              samples[label] = merged;
            }
          }

          if (!samples[label] || (Array.isArray(samples[label]) && samples[label].length === 0)) {
            let sampleQuery: string;
            if (label === 'File') sampleQuery = `MATCH (n:File) WHERE n.projectId = $projectId RETURN n.path as path ORDER BY n.path${limit}`;
            else if (label === 'Component') sampleQuery = `MATCH (f:File)-[:CONTAINS]->(n:Component) WHERE n.projectId = $projectId AND f.projectId = $projectId RETURN f.path as path, n.name as name ORDER BY f.path, n.name${limit}`;
            else if (label === 'Function') sampleQuery = `MATCH (n:Function) WHERE n.projectId = $projectId RETURN n.path as path, n.name as name, n.endpointCalls as endpointCalls ORDER BY n.path, n.name${limit}`;
            else if (label === 'Model') sampleQuery = `MATCH (n:Model) WHERE n.projectId = $projectId RETURN n.path as path, n.name as name ORDER BY n.path, n.name${limit}`;
            else if (label === 'Route') sampleQuery = `MATCH (n:Route) WHERE n.projectId = $projectId RETURN n.path as path, n.componentName as componentName ORDER BY n.path${limit}`;
            else if (label === 'Hook') sampleQuery = `MATCH (n:Hook) WHERE n.projectId = $projectId RETURN n.name as name ORDER BY n.name${limit}`;
            else if (label === 'Context') sampleQuery = `MATCH (f:File)-[:CONTAINS]->(n:Context) WHERE n.projectId = $projectId AND f.projectId = $projectId RETURN n.name as name, f.path as path ORDER BY n.name, f.path${limit}`;
            else if (label === 'DomainConcept') sampleQuery = `MATCH (n:DomainConcept) WHERE n.projectId = $projectId RETURN n.name as name, n.category as category, n.sourcePath as path ORDER BY n.category, n.name${limit}`;
            else sampleQuery = `MATCH (n:${label}) WHERE n.projectId = $projectId RETURN n.name as name, n.path as path ORDER BY n.path, n.name${limit}`;

            const sampleRes = await graph.query(sampleQuery, { params });
            samples[label] = (sampleRes as { data?: Record<string, unknown>[] })?.data ?? [];
          }

          if (full && label === 'Hook') {
            const byName = new Map<string, { name: string; path?: string }>();
            for (const row of samples[label] as Array<{ name: string; path?: string }>) {
              if (!byName.has(row.name)) byName.set(row.name, { name: row.name, path: row.path });
            }
            samples[label] = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
          }
        }
      }
    } finally {
      await client.close();
    }

    return { counts, samples };
  }

  /** Ejecuta una query Cypher en FalkorDB con projectId como param. */
  async executeCypher(
    projectId: string,
    cypher: string,
    extraParams?: Record<string, unknown>,
  ): Promise<unknown[]> {
    const config = getFalkorConfig();
    const client = await FalkorDB.connect({
      socket: { host: config.host, port: config.port },
    });
    try {
      const graph = client.selectGraph(GRAPH_NAME);
      const params = { projectId, ...extraParams };
      const res = await graph.query(cypher, { params });
      return (res as { data?: Record<string, unknown>[] })?.data ?? [];
    } finally {
      await client.close();
    }
  }

  /** Ejecuta Cypher sin params (para vector query con vecf32 inline). */
  async executeCypherRaw(cypher: string): Promise<unknown[]> {
    const config = getFalkorConfig();
    const client = await FalkorDB.connect({
      socket: { host: config.host, port: config.port },
    });
    try {
      const graph = client.selectGraph(GRAPH_NAME);
      const res = await graph.query(cypher);
      return (res as { data?: Record<string, unknown>[] })?.data ?? [];
    } finally {
      await client.close();
    }
  }

  /** Formatea resultados para lectura humana (sin JSON crudo). */
  formatResultsHuman(rows: unknown[], max = 25): string {
    if (rows.length === 0) return '';
    const arr = rows.slice(0, max) as Record<string, unknown>[];
    const rawKeys = Array.from(new Set(arr.flatMap((r) => Object.keys(r)))).filter((k) => k !== 'projectId');
    const norm = (r: Record<string, unknown>) => {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(r)) {
        const clean = k.replace(/^(fn|f|c|r|dc)\./, '');
        out[clean] = r[k];
      }
      return out;
    };
    const keys = rawKeys.map((k) => k.replace(/^(fn|f|c|r|dc)\./, ''));

    const hasDomainConcept = keys.some((k) => k === 'category') && keys.some((k) => k === 'name');
    if (hasDomainConcept && arr.length > 5) {
      const byCategory = new Map<string, string[]>();
      for (const r of arr.map(norm)) {
        const name = String(r.name ?? '');
        const cat = String(r.category ?? 'concepto');
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat)!.push(name);
      }
      const lines: string[] = [];
      for (const [cat, names] of byCategory) {
        const uniq = Array.from(new Set(names)).slice(0, 15);
        lines.push(`**${cat}**: ${uniq.join(', ')}${names.length > 15 ? '…' : ''}`);
      }
      const more = rows.length > max ? `\n\n_… ${rows.length - max} conceptos más (usa el chat para tipos de cotización)_` : '';
      return lines.join('\n') + more;
    }

    const hasPath = keys.some((k) => k === 'path' || k === 'file');
    const hasName = keys.some((k) => k === 'name' || k === 'component');
    const hasUsos = keys.some((k) => k === 'usos');

    if (hasPath && hasName) {
      const byPath = new Map<string, string[]>();
      for (const r of arr.map(norm)) {
        const path = String(r.path ?? r.file ?? '');
        const name = String(r.name ?? r.component ?? '');
        const usos = r.usos != null ? ` (${r.usos} usos)` : '';
        if (!byPath.has(path)) byPath.set(path, []);
        byPath.get(path)!.push(name + usos);
      }
      const lines: string[] = [];
      for (const [path, names] of byPath) {
        const short = path.split('/').pop() ?? path;
        lines.push(`**${short}**\n  ${names.join(', ')}`);
      }
      const more = rows.length > max ? `\n\n_… y ${rows.length - max} más_` : '';
      return lines.join('\n\n') + more;
    }

    if (keys.length <= 3) {
      const lines = arr.map((r) => {
        const n = norm(r);
        return keys.map((k) => String(n[k] ?? '—')).join(' · ');
      });
      return lines.join('\n') + (rows.length > max ? `\n\n_… y ${rows.length - max} más_` : '');
    }

    return arr.map((r) => JSON.stringify(norm(r))).join('\n') + (rows.length > max ? `\n\n_… y ${rows.length - max} más_` : '');
  }
}
