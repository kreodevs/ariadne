/**
 * @fileoverview Servicio de consultas al grafo FalkorDB: impacto, componente, contrato, compare (API).
 */
import { Injectable } from '@nestjs/common';
import { FalkorService } from '../falkor.service';
import { CacheService } from '../cache.service';

interface FalkorResult {
  headers?: string[];
  data?: unknown[][];
}

/**
 * Servicio que expone consultas al grafo (impacto de un nodo, dependencias de componente, contrato de props, compare shadow).
 * Usa caché para reducir carga en FalkorDB.
 */
@Injectable()
export class GraphService {
  constructor(
    private readonly falkor: FalkorService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Obtiene los dependientes de un nodo (qué se rompe si se modifica). Resultado cacheado.
   * @param {string} nodeId - Nombre del nodo (componente o función).
   * @returns {Promise<{ nodeId: string; dependents: Array<{ name: unknown; labels: unknown }> }>}
   */
  async getImpact(nodeId: string) {
    const cached = await this.cache.get<{ nodeId: string; dependents: unknown[] }>(
      this.cache.impactKey(nodeId),
    );
    if (cached) return cached;
    const graph = await this.falkor.getGraph();
    const result = (await graph.query(
      `MATCH (n {name: $nodeName})<-[:CALLS|RENDERS*]-(dependent) RETURN dependent.name AS name, labels(dependent) AS labels`,
      { params: { nodeName: nodeId } },
    )) as FalkorResult;
    const data = result.data ?? [];
    const headers = result.headers ?? ['name', 'labels'];
    const nameIdx = headers.indexOf('name');
    const labelsIdx = headers.indexOf('labels');
    const dependents = data.map((row: unknown) => {
      const arr = Array.isArray(row) ? row : [row];
      return {
        name: nameIdx >= 0 ? arr[nameIdx] : arr[0],
        labels: labelsIdx >= 0 ? arr[labelsIdx] : arr[1],
      };
    });
    const payload = { nodeId, dependents };
    await this.cache.set(this.cache.impactKey(nodeId), payload, this.cache.TTL.impact);
    return payload;
  }

  /**
   * Obtiene el grafo de dependencias de un componente hasta una profundidad. Resultado cacheado.
   * @param {string} name - Nombre del componente.
   * @param {number} depth - Profundidad máxima de relaciones (1..depth).
   * @returns {Promise<{ componentName: string; depth: number; dependencies: Array<{ name?: string; path?: string }> }>}
   */
  async getComponent(name: string, depth: number) {
    const cached = await this.cache.get<{
      componentName: string;
      depth: number;
      dependencies: unknown[];
    }>(this.cache.componentKey(name, depth));
    if (cached) return cached;
    const graph = await this.falkor.getGraph();
    const result = (await graph.query(
      `MATCH (c:Component {name: $componentName})-[*1..${depth}]->(dependency) RETURN c, dependency`,
      { params: { componentName: name } },
    )) as FalkorResult;
    const data = result.data ?? [];
    const headers = result.headers ?? ['c', 'dependency'];
    const depIdx = headers.indexOf('dependency');
    const seen = new Set<string>();
    const dependencies: { name?: string; path?: string }[] = [];
    for (const row of data as unknown[]) {
      const arr = Array.isArray(row) ? row : [row];
      const dep = depIdx >= 0 && arr[depIdx] != null ? arr[depIdx] : arr[1];
      const obj =
        dep && typeof dep === 'object' ? (dep as Record<string, unknown>) : { name: String(dep) };
      const key = String(obj.name ?? obj.path ?? JSON.stringify(obj));
      if (seen.has(key)) continue;
      seen.add(key);
      dependencies.push({ name: obj.name as string, path: obj.path as string });
    }
    const payload = { componentName: name, depth, dependencies };
    await this.cache.set(
      this.cache.componentKey(name, depth),
      payload,
      this.cache.TTL.component,
    );
    return payload;
  }

  /**
   * Obtiene el contrato (props) de un componente desde el grafo. Resultado cacheado.
   * @param {string} componentName - Nombre del componente.
   * @returns {Promise<{ componentName: string; props: Array<{ name: string; required: boolean }> }>}
   */
  async getContract(componentName: string) {
    const cached = await this.cache.get<{
      componentName: string;
      props: { name: string; required: boolean }[];
    }>(this.cache.contractKey(componentName));
    if (cached) return cached;
    const graph = await this.falkor.getGraph();
    const props = await this.getPropsForComponent(graph, componentName);
    const payload = { componentName, props };
    await this.cache.set(
      this.cache.contractKey(componentName),
      payload,
      this.cache.TTL.contract,
    );
    return payload;
  }

  private async getPropsForComponent(
    graph: Awaited<ReturnType<FalkorService['getGraph']>>,
    componentName: string,
    projectId?: string,
  ): Promise<{ name: string; required: boolean }[]> {
    const matchProj = projectId ? ', projectId: $projectId' : '';
    const params: Record<string, string> = { componentName };
    if (projectId) params.projectId = projectId;
    const result = (await graph.query(
      `MATCH (c:Component {name: $componentName${matchProj}})-[:HAS_PROP]->(p:Prop) RETURN p.name AS name, p.required AS required`,
      { params },
    )) as FalkorResult;
    const data = result.data ?? [];
    const headers = result.headers ?? ['name', 'required'];
    const nameIdx = headers.indexOf('name');
    const requiredIdx = headers.indexOf('required');
    return data.map((row: unknown) => {
      const arr = Array.isArray(row) ? row : [row];
      return {
        name: (nameIdx >= 0 ? arr[nameIdx] : arr[0]) as string,
        required:
          requiredIdx >= 0 ? arr[requiredIdx] === true || arr[requiredIdx] === 'true' : false,
      };
    });
  }

  async compare(componentName: string) {
    const [mainGraph, shadowGraph] = await Promise.all([
      this.falkor.getGraph(),
      this.falkor.getShadowGraph(),
    ]);
    const [mainProps, shadowProps] = await Promise.all([
      this.getPropsForComponent(mainGraph, componentName),
      this.getPropsForComponent(shadowGraph, componentName),
    ]);
    const mainSet = new Set(mainProps.map((p) => p.name));
    const shadowSet = new Set(shadowProps.map((p) => p.name));
    const missingInShadow = mainProps.filter((p) => !shadowSet.has(p.name)).map((p) => p.name);
    const extraInShadow = shadowProps.filter((p) => !mainSet.has(p.name)).map((p) => p.name);
    const match = missingInShadow.length === 0 && extraInShadow.length === 0;
    return {
      componentName,
      match,
      mainProps,
      shadowProps,
      missingInShadow,
      extraInShadow,
    };
  }

  /** Genera un manual en markdown a partir del grafo (proyectos, componentes con descripciones y props). */
  async getManual(projectId?: string): Promise<string> {
    const graph = await this.falkor.getGraph();
    const projFilter = projectId ? ' WHERE p.projectId = $projectId' : '';
    const projParams = projectId ? { params: { projectId } } : {};
    const projectsRes = (await graph.query(
      `MATCH (p:Project)${projFilter} RETURN p.projectId AS id, p.projectName AS name, p.rootPath AS rootPath, p.branch AS branch`,
      projParams,
    )) as FalkorResult;
    const projects = (projectsRes.data ?? []) as [string, string, string, string | null][];
    const lines: string[] = ['# Manual de componentes (generado desde grafo)', ''];

    for (const [id, name, rootPath, branch] of projects) {
      lines.push(`## ${name}${branch ? ` (rama: ${branch})` : ''}`, '');
      const routesRes = (await graph.query(
        `MATCH (rt:Route {projectId: $projectId}) RETURN rt.path AS path, rt.componentName AS componentName ORDER BY rt.path`,
        { params: { projectId: id } },
      )) as FalkorResult;
      const routes = (routesRes.data ?? []) as [string, string][];
      if (routes.length > 0) {
        lines.push('### Flujo de rutas', '');
        for (const [path, componentName] of routes) {
          lines.push(`- \`${path}\` → **${componentName}**`);
        }
        lines.push('');
      }
      const compRes = (await graph.query(
        `MATCH (c:Component {projectId: $projectId}) RETURN c.name AS name, c.description AS description`,
        { params: { projectId: id } },
      )) as FalkorResult;
      const comps = (compRes.data ?? []) as [string, string | null][];
      if (comps.length === 0) {
        lines.push('_Sin componentes indexados._', '');
        continue;
      }
      for (const [compName, description] of comps) {
        lines.push(`### ${compName}`, '');
        if (description && String(description).trim()) {
          lines.push(String(description).trim(), '');
        }
        const props = await this.getPropsForComponent(graph, compName, id);
        if (props.length > 0) {
          lines.push('**Props:**', '');
          for (const p of props) {
            lines.push(`- \`${p.name}\` (${p.required ? 'requerido' : 'opcional'})`);
          }
          lines.push('');
        }
      }
    }
    return lines.join('\n');
  }

  async shadowProxy(files: { path: string; content: string }[]) {
    const url = process.env.INGEST_URL ?? process.env.CARTOGRAPHER_URL ?? 'http://cartographer:4000';
    const r = await fetch(`${url}/shadow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error('Cartographer shadow failed'), { status: r.status, data });
    return data;
  }
}
