/**
 * @fileoverview Servicio de consultas al grafo FalkorDB: impacto, componente, contrato, compare (API).
 */
import { Injectable } from '@nestjs/common';
import { isProjectShardingEnabled } from 'ariadne-common';
import { FalkorService } from '../falkor.service';
import { CacheService } from '../cache.service';

interface FalkorResult {
  headers?: string[];
  data?: unknown[][];
}

export interface GraphNodeDto {
  id: string;
  kind: string;
  name?: string;
  path?: string;
  /** Copiados del grafo Falkor (ingest) — forman parte del id para evitar colisiones multi-repo. */
  projectId?: string;
  repoId?: string;
}

export interface GraphEdgeDto {
  source: string;
  target: string;
  kind: string;
}

/**
 * FalkorDB / drivers a veces devuelven `name` u otros campos como objetos anidados;
 * `String(obj)` produce "[object Object]" y rompe ids + aristas en el cliente.
 */
function falkorScalarToString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') {
    const t = value.trim();
    return t.length ? t : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value.map((v) => falkorScalarToString(v)).filter((s): s is string => Boolean(s));
    return parts.length ? parts.join(', ') : undefined;
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    for (const k of ['name', 'path', 'id', 'title', 'label', 'value']) {
      const s = falkorScalarToString(o[k]);
      if (s) return s;
    }
    try {
      const j = JSON.stringify(value);
      return j.length > 200 ? j.slice(0, 197) + '…' : j;
    } catch {
      return undefined;
    }
  }
  return String(value);
}

/** Id estable por nodo: multi-repo puede repetir `name`; sin projectId/repoId colisionan en React Flow. */
function graphNodeKey(parts: {
  kind: string;
  projectId?: string;
  repoId?: string;
  path?: string;
  name?: string;
}): string {
  const kind = parts.kind;
  const projectId = parts.projectId ?? '';
  const repoId = parts.repoId ?? '';
  const path = parts.path ?? '';
  const name = parts.name ?? '';
  return `${kind}|${projectId}|${repoId}|${path}|${name}`;
}

function parseGraphNodeCell(cell: unknown): GraphNodeDto | null {
  if (cell == null) return null;
  let labels: string[] = ['Node'];
  let props: Record<string, unknown> = {};
  if (Array.isArray(cell) && cell.length >= 2 && typeof cell[1] === 'object' && cell[1] !== null) {
    const lbl = cell[0];
    labels = Array.isArray(lbl) ? lbl.map(String) : typeof lbl === 'string' ? [lbl] : ['Node'];
    props = cell[1] as Record<string, unknown>;
  } else if (typeof cell === 'object' && !Array.isArray(cell)) {
    const o = cell as Record<string, unknown>;
    const lr = o.labels ?? o.label;
    labels = Array.isArray(lr) ? lr.map(String) : lr != null ? [String(lr)] : ['Node'];
    props = { ...o };
    delete props.labels;
    delete props.label;
  } else {
    return null;
  }
  const kind = labels[0] ?? 'Node';
  const name =
    falkorScalarToString(props.name) ??
    falkorScalarToString(props.componentName) ??
    falkorScalarToString(props.component) ??
    falkorScalarToString((props as { displayName?: unknown }).displayName);
  const path = falkorScalarToString(props.path);
  const projectId = falkorScalarToString((props as { projectId?: unknown }).projectId);
  const repoId = falkorScalarToString((props as { repoId?: unknown }).repoId);
  const id = graphNodeKey({ kind, projectId, repoId, path, name });
  return { id, kind, name, path, projectId, repoId };
}

/** Corrige nodo foco mal parseado (label Node, sin name) y alinea con el nombre pedido al API. */
function normalizeComponentGraphFocal(
  nodes: Map<string, GraphNodeDto>,
  edges: GraphEdgeDto[],
  componentName: string,
  centerIdHint: string | null,
): void {
  const legacyTargets = [
    ...new Set(edges.filter((e) => e.kind === 'legacy_impact').map((e) => e.target)),
  ];
  let focalId: string | null = null;
  if (legacyTargets.length === 1) focalId = legacyTargets[0]!;
  else if (centerIdHint && nodes.has(centerIdHint)) focalId = centerIdHint;
  if (!focalId) {
    for (const [id, n] of nodes) {
      if (n.name === componentName) {
        focalId = id;
        break;
      }
    }
  }
  if (!focalId || !nodes.has(focalId)) return;
  const n = nodes.get(focalId)!;
  const replaceName =
    !n.name || n.name === 'unknown' || n.name === 'Node' || n.kind === 'Node';
  nodes.set(focalId, {
    ...n,
    name: replaceName ? componentName : n.name,
    kind: n.kind === 'Node' ? 'Component' : n.kind,
  });
}

function impactNode(name: unknown, labels: unknown, projectId?: string): GraphNodeDto {
  const labelArr = Array.isArray(labels) ? labels : labels != null ? [labels] : [];
  const kindRaw = labelArr.length ? labelArr[0] : 'Node';
  const kind = falkorScalarToString(kindRaw) ?? 'Node';
  const n = falkorScalarToString(name) ?? 'unknown';
  const pid = projectId ?? '';
  const id = graphNodeKey({ kind, projectId: pid, name: n });
  return { id, kind, name: n, ...(projectId ? { projectId } : {}) };
}

function addGraphEdge(
  edges: GraphEdgeDto[],
  edgeKey: Set<string>,
  source: string,
  target: string,
  kind: GraphEdgeDto['kind'],
): void {
  if (source === target) return;
  const ek = `${source}|${target}|${kind}`;
  if (edgeKey.has(ek)) return;
  edgeKey.add(ek);
  edges.push({ source, target, kind });
}

@Injectable()
export class GraphService {
  constructor(
    private readonly falkor: FalkorService,
    private readonly cache: CacheService,
  ) {}

  async getImpact(nodeId: string, projectId?: string) {
    const cached = await this.cache.get<{ nodeId: string; dependents: unknown[] }>(
      this.cache.impactKey(nodeId, projectId),
    );
    if (cached) return cached;
    const graph = await this.falkor.getGraph(projectId);
    const matchProj = projectId ? ', projectId: $projectId' : '';
    const params: Record<string, string> = { nodeName: nodeId };
    if (projectId) params.projectId = projectId;
    const result = (await graph.query(
      `MATCH (n {name: $nodeName${matchProj}})<-[:CALLS|RENDERS*]-(dependent) RETURN dependent.name AS name, labels(dependent) AS labels`,
      { params },
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
    await this.cache.set(this.cache.impactKey(nodeId, projectId), payload, this.cache.TTL.impact);
    return payload;
  }

  async getComponent(name: string, depth: number, projectId?: string) {
    const cached = await this.cache.get<{
      componentName: string;
      depth: number;
      projectId?: string;
      dependencies: unknown[];
      nodes: GraphNodeDto[];
      edges: GraphEdgeDto[];
    }>(this.cache.componentKey(name, depth, projectId));
    if (cached) return cached;

    const graph = await this.falkor.getGraph(projectId);
    const compMatch = projectId ? ', projectId: $projectId' : '';
    const params: Record<string, string> = { componentName: name };
    if (projectId) params.projectId = projectId;
    const whereFilter = projectId
      ? ` WHERE (dependency.projectId = $projectId OR dependency.projectId IS NULL)`
      : '';
    const result = (await graph.query(
      `MATCH (c:Component {name: $componentName${compMatch}})-[*1..${depth}]->(dependency)${whereFilter} RETURN c, dependency`,
      { params },
    )) as FalkorResult;
    const data = result.data ?? [];
    const headers = result.headers ?? ['c', 'dependency'];
    const cIdx = headers.indexOf('c');
    const depIdx = headers.indexOf('dependency');
    const seen = new Set<string>();
    const dependencies: { name?: string; path?: string }[] = [];
    const nodes = new Map<string, GraphNodeDto>();
    const edgeKey = new Set<string>();
    const edges: GraphEdgeDto[] = [];

    let centerId: string | null = null;

    for (const row of data as unknown[]) {
      const arr = Array.isArray(row) ? row : [row];
      const centerCell = cIdx >= 0 && arr[cIdx] != null ? arr[cIdx] : arr[0];
      const dep = depIdx >= 0 && arr[depIdx] != null ? arr[depIdx] : arr[1];
      const centerNode = parseGraphNodeCell(centerCell);
      if (centerNode && !centerId) {
        centerId = centerNode.id;
        nodes.set(centerNode.id, centerNode);
      }
      const depParsed = parseGraphNodeCell(dep);
      const obj =
        dep && typeof dep === 'object' && !Array.isArray(dep)
          ? (dep as Record<string, unknown>)
          : { name: dep != null ? falkorScalarToString(dep) ?? String(dep) : undefined };
      const key =
        [
          falkorScalarToString((obj as { repoId?: unknown }).repoId),
          falkorScalarToString((obj as { projectId?: unknown }).projectId),
          falkorScalarToString(obj.name),
          falkorScalarToString(obj.path),
        ]
          .filter(Boolean)
          .join('\0') ||
        (typeof dep === 'object' && dep != null ? JSON.stringify(dep) : String(dep));
      if (seen.has(key)) continue;
      seen.add(key);
      dependencies.push({
        name: falkorScalarToString(obj.name),
        path: falkorScalarToString(obj.path),
      });
      if (depParsed) {
        nodes.set(depParsed.id, depParsed);
        if (centerId) addGraphEdge(edges, edgeKey, centerId, depParsed.id, 'depends');
      }
    }

    const impact = await this.getImpact(name, projectId);
    if (!centerId) {
      centerId = graphNodeKey({ kind: 'Component', projectId: projectId ?? '', name });
      nodes.set(centerId, { id: centerId, kind: 'Component', name, projectId });
    }

    /** Hijos directos RENDERS tras fijar centerId (incl. fallback si el path variable devolvió 0 filas). */
    {
      const rendersParams: Record<string, string> = { componentName: name };
      if (projectId) rendersParams.projectId = projectId;
      const childWhere = projectId
        ? ` WHERE (child.projectId = $projectId OR child.projectId IS NULL)`
        : '';
      const rendersQ = projectId
        ? `MATCH (c:Component {name: $componentName, projectId: $projectId})-[:RENDERS]->(child:Component)${childWhere} RETURN child`
        : `MATCH (c:Component {name: $componentName})-[:RENDERS]->(child:Component) RETURN child`;
      try {
        const childRes = (await graph.query(rendersQ, { params: rendersParams })) as FalkorResult;
        for (const row of childRes.data ?? []) {
          const arr = Array.isArray(row) ? row : [row];
          const cell = arr[0];
          const ch = parseGraphNodeCell(cell);
          if (!ch) continue;
          nodes.set(ch.id, ch);
          addGraphEdge(edges, edgeKey, centerId!, ch.id, 'depends');
        }
      } catch {
        /* RENDERS opcional si el esquema difiere */
      }
    }

    /** Padres que RENDERS al foco (arista parent → center; el foco tiene dep in ≥ 1). */
    {
      const parentParams: Record<string, string> = { componentName: name };
      if (projectId) parentParams.projectId = projectId;
      const parentWhere = projectId
        ? ` WHERE (parent.projectId = $projectId OR parent.projectId IS NULL)`
        : '';
      const parentQ = projectId
        ? `MATCH (parent:Component)-[:RENDERS]->(c:Component {name: $componentName, projectId: $projectId})${parentWhere} RETURN parent`
        : `MATCH (parent:Component)-[:RENDERS]->(c:Component {name: $componentName}) RETURN parent`;
      try {
        const parentRes = (await graph.query(parentQ, { params: parentParams })) as FalkorResult;
        for (const row of parentRes.data ?? []) {
          const arr = Array.isArray(row) ? row : [row];
          const cell = arr[0];
          const pr = parseGraphNodeCell(cell);
          if (!pr) continue;
          nodes.set(pr.id, pr);
          addGraphEdge(edges, edgeKey, pr.id, centerId!, 'depends');
        }
      } catch {
        /* Padres opcional */
      }
    }

    for (const d of impact.dependents as { name?: unknown; labels?: unknown }[]) {
      const gn = impactNode(d.name, d.labels, projectId);
      nodes.set(gn.id, gn);
      addGraphEdge(edges, edgeKey, gn.id, centerId!, 'legacy_impact');
    }

    normalizeComponentGraphFocal(nodes, edges, name, centerId);

    const payload = {
      componentName: name,
      depth,
      ...(projectId ? { projectId } : {}),
      dependencies,
      nodes: [...nodes.values()],
      edges,
    };
    await this.cache.set(
      this.cache.componentKey(name, depth, projectId),
      payload,
      this.cache.TTL.component,
    );
    return payload;
  }

  async getContract(componentName: string, projectId?: string) {
    const cached = await this.cache.get<{
      componentName: string;
      props: { name: string; required: boolean }[];
    }>(this.cache.contractKey(componentName, projectId));
    if (cached) return cached;
    const graph = await this.falkor.getGraph(projectId);
    const props = await this.getPropsForComponent(graph, componentName, projectId);
    const payload = { componentName, props };
    await this.cache.set(
      this.cache.contractKey(componentName, projectId),
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

  async compare(componentName: string, projectId?: string) {
    const [mainGraph, shadowGraph] = await Promise.all([
      this.falkor.getGraph(projectId),
      this.falkor.getShadowGraph(),
    ]);
    const [mainProps, shadowProps] = await Promise.all([
      this.getPropsForComponent(mainGraph, componentName, projectId),
      this.getPropsForComponent(shadowGraph, componentName, undefined),
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

  async getManual(projectId?: string): Promise<string> {
    if (isProjectShardingEnabled() && !projectId) {
      return [
        '# Manual de componentes',
        '',
        '_Con `FALKOR_SHARD_BY_PROJECT` activo indica `?projectId=` en GET /graph/manual._',
      ].join('\n');
    }
    const graph = await this.falkor.getGraph(projectId);
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
    const url = process.env.INGEST_URL ?? 'http://ingest:3002';
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
