/**
 * Servicio de ejecución Cypher y formateo de resultados para el chat.
 * Centraliza conexión a FalkorDB y presentación de datos para reducir complejidad en ChatService.
 */

import { Injectable } from '@nestjs/common';
import { FalkorDB } from 'falkordb';
import { getFalkorConfig, graphNameForProject, isProjectShardingEnabled } from '../pipeline/falkor';
import { RepositoriesService } from '../repositories/repositories.service';
import { ProjectsService } from '../projects/projects.service';

@Injectable()
export class ChatCypherService {
  constructor(
    private readonly repos: RepositoriesService,
    private readonly projects: ProjectsService,
  ) {}

  private async resolveProjectIdForRepo(repoId: string): Promise<string> {
    const ids = await this.repos.getProjectIdsForRepo(repoId);
    return ids[0] ?? repoId;
  }

  /** Prefijos típicos de monorepos para muestreo estratificado (evita sesgo alfabético hacia apps/admin). */
  private static MONOREPO_PREFIXES = ['apps/admin', 'apps/api', 'apps/worker', 'apps/web', 'packages/'];

  /** Resumen por projectId directo (multi-root). Usado por analyzeByProject. */
  async getGraphSummaryForProject(projectId: string, full = true): Promise<{
    counts: Record<string, number>;
    samples: Record<string, unknown[]>;
  }> {
    return this.getGraphSummaryInternal(projectId, full);
  }

  /** Resumen de lo indexado en FalkorDB. full=true (default) devuelve todos los ítems (sin LIMIT); full=false: muestras estratificadas por apps/ para monorepos. */
  async getGraphSummary(repositoryId: string, full = true, repoScoped = false): Promise<{
    counts: Record<string, number>;
    samples: Record<string, unknown[]>;
  }> {
    const repo = await this.repos.findOne(repositoryId);
    const projectId = await this.resolveProjectIdForRepo(repo.id);
    const repoIdFilter = repoScoped ? repo.id : undefined;
    return this.getGraphSummaryInternal(projectId, full, repoIdFilter);
  }

  private async getGraphSummaryInternal(
    projectId: string,
    full = true,
    repoIdFilter?: string,
  ): Promise<{
    counts: Record<string, number>;
    samples: Record<string, unknown[]>;
  }> {

    const config = getFalkorConfig();
    const client = await FalkorDB.connect({
      socket: { host: config.host, port: config.port },
    });

    const limit = full ? '' : ' LIMIT 12';
    const limitPerPrefix = full ? '' : ' LIMIT 4';
    const labels = [
      'File',
      'Component',
      'Function',
      'Model',
      'OpenApiOperation',
      'Route',
      'Hook',
      'Context',
      'DomainConcept',
      'Prop',
      'NestController',
      'NestService',
      'NestModule',
    ];
    const counts: Record<string, number> = {};
    const samples: Record<string, unknown[]> = {};

    const wn = repoIdFilter ? ' AND n.repoId = $repoIdFilter' : '';
    const wfn = repoIdFilter ? ' AND f.repoId = $repoIdFilter AND n.repoId = $repoIdFilter' : '';

    const shardContexts = await this.projects.getCypherShardContexts(projectId, {
      includeSiblingProjects: !repoIdFilter,
    });

    try {
      for (const shard of shardContexts.length > 0
        ? shardContexts
        : [{ graphName: graphNameForProject(isProjectShardingEnabled() ? projectId : undefined), cypherProjectId: projectId }]) {
        const graph = client.selectGraph(shard.graphName);
        const pid = shard.cypherProjectId;
        const params: Record<string, string> = { projectId: pid };
        if (repoIdFilter) params.repoIdFilter = repoIdFilter;

        for (const label of labels) {
          const countRes = await graph.query(
            `MATCH (n:${label}) WHERE n.projectId = $projectId${wn} RETURN count(n) as c`,
            { params },
          );
          const count = ((countRes as { data?: [{ c: number }] })?.data?.[0]?.c) ?? 0;
          if (count > 0) {
            counts[label] = (counts[label] ?? 0) + count;

            const pathLabels = ['File', 'Component', 'Function', 'Model', 'Route', 'NestController', 'NestService', 'NestModule'];
            const useStratified = !full && pathLabels.includes(label);

            let stratifiedMerged: Record<string, unknown>[] = [];
            if (useStratified) {
              const seen = new Set<string>();
              for (const prefix of ChatCypherService.MONOREPO_PREFIXES) {
                let q: string;
                if (label === 'File') {
                  q = `MATCH (n:File) WHERE n.projectId = $projectId${wn} AND n.path STARTS WITH $prefix RETURN n.path as path ORDER BY n.path${limitPerPrefix}`;
                } else if (label === 'Component') {
                  q = `MATCH (f:File)-[:CONTAINS]->(n:Component) WHERE n.projectId = $projectId AND f.projectId = $projectId${wfn} AND f.path STARTS WITH $prefix RETURN f.path as path, n.name as name ORDER BY f.path, n.name${limitPerPrefix}`;
                } else if (label === 'Function') {
                  q = `MATCH (n:Function) WHERE n.projectId = $projectId${wn} AND n.path STARTS WITH $prefix RETURN n.path as path, n.name as name ORDER BY n.path, n.name${limitPerPrefix}`;
                } else if (label === 'Model') {
                  q = `MATCH (n:Model) WHERE n.projectId = $projectId${wn} AND n.path STARTS WITH $prefix RETURN n.path as path, n.name as name ORDER BY n.path, n.name${limitPerPrefix}`;
                } else if (label === 'Route') {
                  q = `MATCH (n:Route) WHERE n.projectId = $projectId${wn} AND n.path STARTS WITH $prefix RETURN n.path as path, n.componentName as componentName ORDER BY n.path${limitPerPrefix}`;
                } else {
                  q = `MATCH (n:${label}) WHERE n.projectId = $projectId${wn} AND n.path STARTS WITH $prefix RETURN n.name as name, n.path as path ORDER BY n.path, n.name${limitPerPrefix}`;
                }
                try {
                  const res = await graph.query(q, { params: { ...params, prefix } });
                  const rows = (res as { data?: Record<string, unknown>[] })?.data ?? [];
                  for (const row of rows) {
                    const key = (row.path ?? row.name ?? JSON.stringify(row)) as string;
                    if (!seen.has(key)) {
                      seen.add(key);
                      stratifiedMerged.push(row);
                    }
                  }
                } catch {
                  /* prefix sin resultados, seguir */
                }
              }
              if (stratifiedMerged.length > 0) {
                samples[label] = [...(samples[label] ?? []), ...stratifiedMerged];
              }
            }

            const needDefaultSamples = !useStratified || stratifiedMerged.length === 0;
            if (needDefaultSamples) {
              let sampleQuery: string;
              if (label === 'File') sampleQuery = `MATCH (n:File) WHERE n.projectId = $projectId${wn} RETURN n.path as path ORDER BY n.path${limit}`;
              else if (label === 'Component') sampleQuery = `MATCH (f:File)-[:CONTAINS]->(n:Component) WHERE n.projectId = $projectId AND f.projectId = $projectId${wfn} RETURN f.path as path, n.name as name ORDER BY f.path, n.name${limit}`;
              else if (label === 'Function') sampleQuery = `MATCH (n:Function) WHERE n.projectId = $projectId${wn} RETURN n.path as path, n.name as name, n.endpointCalls as endpointCalls ORDER BY n.path, n.name${limit}`;
              else if (label === 'Model') sampleQuery = `MATCH (n:Model) WHERE n.projectId = $projectId${wn} RETURN n.path as path, n.name as name ORDER BY n.path, n.name${limit}`;
              else if (label === 'Route') sampleQuery = `MATCH (n:Route) WHERE n.projectId = $projectId${wn} RETURN n.path as path, n.componentName as componentName ORDER BY n.path${limit}`;
              else if (label === 'Hook') sampleQuery = `MATCH (n:Hook) WHERE n.projectId = $projectId${wn} RETURN n.name as name ORDER BY n.name${limit}`;
              else if (label === 'Context') sampleQuery = `MATCH (f:File)-[:CONTAINS]->(n:Context) WHERE n.projectId = $projectId AND f.projectId = $projectId${wfn} RETURN n.name as name, f.path as path ORDER BY n.name, f.path${limit}`;
              else if (label === 'DomainConcept') sampleQuery = `MATCH (n:DomainConcept) WHERE n.projectId = $projectId${wn} RETURN n.name as name, n.category as category, n.sourcePath as path ORDER BY n.category, n.name${limit}`;
              else sampleQuery = `MATCH (n:${label}) WHERE n.projectId = $projectId${wn} RETURN n.name as name, n.path as path ORDER BY n.path, n.name${limit}`;

              const sampleRes = await graph.query(sampleQuery, { params });
              const chunk = (sampleRes as { data?: Record<string, unknown>[] })?.data ?? [];
              const prevLen = (samples[label] ?? []).length;
              samples[label] = [...(samples[label] ?? []), ...chunk];

              if (
                label === 'Component' &&
                count > 0 &&
                (samples[label] ?? []).length === prevLen
              ) {
                const fb = await graph.query(
                  `MATCH (n:Component) WHERE n.projectId = $projectId${wn} RETURN n.name as name, '' as path ORDER BY n.name${limit}`,
                  { params },
                );
                samples[label] = [...(samples[label] ?? []), ...((fb as { data?: Record<string, unknown>[] })?.data ?? [])];
              }
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
      const contexts = await this.projects.getCypherShardContexts(projectId);
      const shards =
        contexts.length > 0
          ? contexts
          : [
              {
                graphName: graphNameForProject(isProjectShardingEnabled() ? projectId : undefined),
                cypherProjectId: projectId,
              },
            ];
      const merged: unknown[] = [];
      const seen = new Set<string>();
      for (const s of shards) {
        const graph = client.selectGraph(s.graphName);
        const params = { projectId: s.cypherProjectId, ...extraParams };
        const res = await graph.query(cypher, { params });
        const rows = (res as { data?: Record<string, unknown>[] })?.data ?? [];
        for (const row of rows) {
          const key = JSON.stringify(row);
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(row);
        }
      }
      return merged;
    } finally {
      await client.close();
    }
  }

  /** Ejecuta Cypher sin params (para vector query con vecf32 inline). */
  /** Cypher sin params (p. ej. vector). Con sharding, indica el projectId del shard. */
  async executeCypherRaw(cypher: string, shardProjectId?: string): Promise<unknown[]> {
    const config = getFalkorConfig();
    const client = await FalkorDB.connect({
      socket: { host: config.host, port: config.port },
    });
    try {
      const graph = client.selectGraph(
        graphNameForProject(
          isProjectShardingEnabled() && shardProjectId ? shardProjectId : undefined,
        ),
      );
      const res = await graph.query(cypher);
      return (res as { data?: Record<string, unknown>[] })?.data ?? [];
    } finally {
      await client.close();
    }
  }

  /** Formatea resultados para lectura humana (sin JSON crudo). Sin `max`: todas las filas (comportamiento por defecto en chat/MCP). */
  formatResultsHuman(rows: unknown[], max?: number): string {
    if (rows.length === 0) return '';
    const cap = max ?? rows.length;
    const arr = rows.slice(0, cap) as Record<string, unknown>[];
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
        const uniq = Array.from(new Set(names));
        lines.push(`**${cat}**: ${uniq.join(', ')}`);
      }
      const more = rows.length > cap ? `\n\n_… ${rows.length - cap} conceptos más (usa el chat para tipos de cotización)_` : '';
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
      const more = rows.length > cap ? `\n\n_… y ${rows.length - cap} más_` : '';
      return lines.join('\n\n') + more;
    }

    if (keys.length <= 3) {
      const lines = arr.map((r) => {
        const n = norm(r);
        return keys.map((k) => String(n[k] ?? '—')).join(' · ');
      });
      return lines.join('\n') + (rows.length > cap ? `\n\n_… y ${rows.length - cap} más_` : '');
    }

    return arr.map((r) => JSON.stringify(norm(r))).join('\n') + (rows.length > cap ? `\n\n_… y ${rows.length - cap} más_` : '');
  }

  /** Tabla markdown de Component (listados completos; una fila por componente indexado). */
  formatComponentsMarkdownTable(rows: Record<string, unknown>[]): string {
    if (rows.length === 0) return '_Sin filas._';
    const esc = (v: unknown, max = 220): string => {
      const s = v === null || v === undefined ? '—' : String(v);
      const t = s.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
      return t.length > max ? `${t.slice(0, Math.max(0, max - 1))}…` : t;
    };
    const legacy = (v: unknown): string => {
      if (v === null || v === undefined) return '—';
      if (typeof v === 'boolean') return v ? 'sí' : 'no';
      return esc(v, 32);
    };
    const hasType = rows.some((r) => {
      const x = r.type;
      return x != null && String(x).trim() !== '';
    });
    if (!hasType) {
      const lines = [
        '| Componente | repoId | Archivo | legacy |',
        '|------------|--------|---------|--------|',
        ...rows.map((r) => {
          const n = esc(r.name, 80);
          const rid = esc(r.repoId, 40);
          const p = esc(r.path, 220);
          const leg = legacy(r.isLegacy);
          return `| \`${n}\` | \`${rid}\` | \`${p}\` | ${leg} |`;
        }),
      ];
      return lines.join('\n');
    }
    const lines = [
      '| Componente | repoId | Archivo | tipo | legacy |',
      '|------------|--------|---------|------|--------|',
      ...rows.map((r) => {
        const n = esc(r.name, 80);
        const rid = esc(r.repoId, 40);
        const p = esc(r.path, 200);
        const ty = esc(r.type, 48);
        const leg = legacy(r.isLegacy);
        return `| \`${n}\` | \`${rid}\` | \`${p}\` | ${ty} | ${leg} |`;
      }),
    ];
    return lines.join('\n');
  }

  /** Tabla markdown: nombre + repo + path (Hooks u otros símbolos en archivo). */
  formatNameRepoPathMarkdownTable(rows: Record<string, unknown>[], nameHeader: string): string {
    if (rows.length === 0) return '_Sin filas._';
    const esc = (v: unknown, max = 220): string => {
      const s = v === null || v === undefined ? '—' : String(v);
      const t = s.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
      return t.length > max ? `${t.slice(0, Math.max(0, max - 1))}…` : t;
    };
    const lines = [
      `| ${nameHeader} | repoId | Archivo |`,
      '|--------------|--------|---------|',
      ...rows.map((r) => {
        const n = esc(r.name, 80);
        const rid = esc(r.repoId, 40);
        const p = esc(r.path, 220);
        return `| \`${n}\` | \`${rid}\` | \`${p}\` |`;
      }),
    ];
    return lines.join('\n');
  }

  /** Tabla markdown: Function (nombre, archivo, métricas opcionales). */
  formatFunctionsMarkdownTable(rows: Record<string, unknown>[]): string {
    if (rows.length === 0) return '_Sin filas._';
    const esc = (v: unknown, max = 200): string => {
      const s = v === null || v === undefined ? '—' : String(v);
      const t = s.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
      return t.length > max ? `${t.slice(0, Math.max(0, max - 1))}…` : t;
    };
    const hasCx = rows.some((r) => r.complexity != null && String(r.complexity).trim() !== '');
    const hasLoc = rows.some((r) => r.loc != null && String(r.loc).trim() !== '');
    if (!hasCx && !hasLoc) {
      return this.formatNameRepoPathMarkdownTable(rows, 'Función');
    }
    const lines = [
      '| Función | repoId | Archivo | complejidad | loc |',
      '|---------|--------|---------|-------------|-----|',
      ...rows.map((r) => {
        const n = esc(r.name, 64);
        const rid = esc(r.repoId, 36);
        const p = esc(r.path, 160);
        const cx = esc(r.complexity, 8);
        const loc = esc(r.loc, 8);
        return `| \`${n}\` | \`${rid}\` | \`${p}\` | ${cx} | ${loc} |`;
      }),
    ];
    return lines.join('\n');
  }

  /** DomainConcept indexados (concepto de dominio + categoría + archivo fuente). */
  formatDomainConceptsMarkdownTable(rows: Record<string, unknown>[]): string {
    if (rows.length === 0) return '_Sin filas._';
    const esc = (v: unknown, max = 200): string => {
      const s = v === null || v === undefined ? '—' : String(v);
      const t = s.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
      return t.length > max ? `${t.slice(0, Math.max(0, max - 1))}…` : t;
    };
    const lines = [
      '| Concepto | categoría | repoId | Archivo |',
      '|----------|-----------|--------|---------|',
      ...rows.map((r) => {
        const n = esc(r.name, 64);
        const cat = esc(r.category, 48);
        const rid = esc(r.repoId, 36);
        const p = esc(r.path, 160);
        return `| \`${n}\` | ${cat} | \`${rid}\` | \`${p}\` |`;
      }),
    ];
    return lines.join('\n');
  }
}
