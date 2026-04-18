/**
 * @fileoverview Servicio de consultas al grafo FalkorDB: impacto, componente, contrato, compare (API).
 */
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { isProjectShardingEnabled } from 'ariadne-common';
import { FalkorService } from '../falkor.service';
import { CacheService } from '../cache.service';

/** Contenedor C4 (nivel 2). */
export interface C4ContainerNodeDto {
  key: string;
  name: string;
  repoId: string;
  technology?: string;
  c4Kind: string;
}

/** Sistema software (nivel 1) con hijos y aristas abstractas. */
export interface C4SystemNodeDto {
  repoId: string;
  name: string;
  containers: C4ContainerNodeDto[];
  communicates: Array<{
    sourceKey: string;
    targetKey: string;
    reason?: string;
  }>;
}

/** Respuesta jerárquica GET /graph/c4-model. */
export interface C4ModelResponseDto {
  projectId: string;
  systems: C4SystemNodeDto[];
}

interface FalkorResult {
  headers?: string[];
  data?: unknown[][];
}

/** Instancia de grafo Falkor (misma forma para getGraph y selectGraphByLogicalName). */
type FalkorGraph = Awaited<ReturnType<FalkorService['getGraph']>>;

/** Acumulador al fusionar cortes de varios subgrafos (sharding por dominio). */
interface ComponentShardAccum {
  seenDepKeys: Set<string>;
  dependencies: { name?: string; path?: string }[];
  nodes: Map<string, GraphNodeDto>;
  edgeKey: Set<string>;
  edges: GraphEdgeDto[];
  centerId: string | null;
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

/** Pistas cuando el corte Falkor no muestra depends salientes (p. ej. desincronización con el chat). */
export interface GraphComponentHintsDto {
  suggestResync?: boolean;
  messageEs?: string;
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

  /**
   * Con sharding por dominio sin scopePath, elige el subgrafo donde exista el nodo buscado.
   */
  private async pickShardGraph(
    projectId: string | undefined,
    scopePath: string | undefined,
    probe: (g: Awaited<ReturnType<FalkorService['getGraph']>>) => Promise<boolean>,
  ): Promise<Awaited<ReturnType<FalkorService['getGraph']>>> {
    if (!projectId) {
      return this.falkor.getGraph(undefined);
    }
    if (scopePath) {
      return this.falkor.getGraph(projectId, { repoRelativePath: scopePath });
    }
    const names = await this.falkor.getProjectGraphNames(projectId);
    if (names.length <= 1) {
      return this.falkor.getGraph(projectId);
    }
    for (const nm of names) {
      const g = await this.falkor.selectGraphByLogicalName(nm);
      try {
        if (await probe(g)) return g;
      } catch {
        /* grafo vacío o error de query */
      }
    }
    return this.falkor.getGraph(projectId);
  }

  private mapImpactQueryRows(result: FalkorResult): { name: unknown; labels: unknown }[] {
    const data = result.data ?? [];
    const headers = result.headers ?? ['name', 'labels'];
    const nameIdx = headers.indexOf('name');
    const labelsIdx = headers.indexOf('labels');
    return data.map((row: unknown) => {
      const arr = Array.isArray(row) ? row : [row];
      return {
        name: nameIdx >= 0 ? arr[nameIdx] : arr[0],
        labels: labelsIdx >= 0 ? arr[labelsIdx] : arr[1],
      };
    });
  }

  /**
   * Añade al acumulador las aristas/nodos de un shard para un componente (RENDERS + caminos + padres).
   * Usado en bucle multi-shard: el primer shard sin datos no impide que otros aporten el vecindario.
   */
  private async appendComponentShardData(
    graph: FalkorGraph,
    name: string,
    depth: number,
    pid: string | undefined,
    accum: ComponentShardAccum,
  ): Promise<void> {
    const params: Record<string, string> = { componentName: name };
    if (pid) params.projectId = pid;

    const dRel = Math.min(Math.max(depth, 1), 10);
    const importHop = Math.min(dRel, 5);
    const rendersRows = (await graph.query(
      pid
        ? `MATCH (c:Component {name: $componentName, projectId: $projectId})-[:RENDERS*1..${dRel}]->(dependency:Component) WHERE c.projectId = $projectId AND dependency.projectId = $projectId RETURN c, dependency`
        : `MATCH (c:Component {name: $componentName})-[:RENDERS*1..${dRel}]->(dependency:Component) RETURN c, dependency`,
      { params },
    )) as FalkorResult;
    const hookRows = (await graph.query(
      pid
        ? `MATCH (c:Component {name: $componentName, projectId: $projectId})-[:USES_HOOK]->(dependency:Hook) WHERE c.projectId = $projectId AND dependency.projectId = $projectId RETURN c, dependency`
        : `MATCH (c:Component {name: $componentName})-[:USES_HOOK]->(dependency:Hook) RETURN c, dependency`,
      { params },
    )) as FalkorResult;
    const importsRows = pid
      ? ((await graph.query(
          `MATCH (c:Component {name: $componentName, projectId: $projectId})<-[:CONTAINS]-(f:File {projectId: $projectId}) ` +
            `MATCH (f)-[:IMPORTS*1..${importHop}]->(f2:File {projectId: $projectId}) ` +
            `MATCH (f2)-[:CONTAINS]->(dependency:Component {projectId: $projectId}) ` +
            `WHERE c.projectId = $projectId AND dependency.projectId = $projectId RETURN c, dependency`,
          { params },
        )) as FalkorResult)
      : ({ data: [] as unknown[][] } as FalkorResult);
    const data = [
      ...(rendersRows.data ?? []),
      ...(hookRows.data ?? []),
      ...(importsRows.data ?? []),
    ];
    const headers = rendersRows.headers ?? ['c', 'dependency'];
    const cIdx = headers.indexOf('c');
    const depIdx = headers.indexOf('dependency');

    for (const row of data as unknown[]) {
      const arr = Array.isArray(row) ? row : [row];
      const centerCell = cIdx >= 0 && arr[cIdx] != null ? arr[cIdx] : arr[0];
      const dep = depIdx >= 0 && arr[depIdx] != null ? arr[depIdx] : arr[1];
      const centerNode = parseGraphNodeCell(centerCell);
      if (centerNode) {
        accum.nodes.set(centerNode.id, centerNode);
        if (!accum.centerId) accum.centerId = centerNode.id;
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
      if (accum.seenDepKeys.has(key)) continue;
      accum.seenDepKeys.add(key);
      accum.dependencies.push({
        name: falkorScalarToString(obj.name),
        path: falkorScalarToString(obj.path),
      });
      if (depParsed && centerNode) {
        accum.nodes.set(depParsed.id, depParsed);
        addGraphEdge(accum.edges, accum.edgeKey, centerNode.id, depParsed.id, 'depends');
      }
    }

    const parentParams: Record<string, string> = { componentName: name };
    if (pid) parentParams.projectId = pid;
    const parentQ = pid
      ? `MATCH (parent:Component {projectId: $projectId})-[:RENDERS]->(c:Component {name: $componentName, projectId: $projectId}) WHERE parent.projectId = $projectId AND c.projectId = $projectId RETURN parent, c`
      : `MATCH (parent:Component)-[:RENDERS]->(c:Component {name: $componentName}) RETURN parent, c`;
    const parentRes = (await graph.query(parentQ, { params: parentParams })) as FalkorResult;
    const ph = parentRes.headers ?? ['parent', 'c'];
    const pIdx = ph.indexOf('parent');
    const cIdxParent = ph.indexOf('c');
    for (const row of parentRes.data ?? []) {
      const arr = Array.isArray(row) ? row : [row];
      const parentCell = pIdx >= 0 && arr[pIdx] != null ? arr[pIdx] : arr[0];
      const focalCell = cIdxParent >= 0 && arr[cIdxParent] != null ? arr[cIdxParent] : arr[1];
      const pr = parseGraphNodeCell(parentCell);
      const focal = parseGraphNodeCell(focalCell);
      if (!pr || !focal) continue;
      accum.nodes.set(pr.id, pr);
      accum.nodes.set(focal.id, focal);
      if (!accum.centerId) accum.centerId = focal.id;
      addGraphEdge(accum.edges, accum.edgeKey, pr.id, focal.id, 'depends');
    }
  }

  async getImpact(nodeId: string, projectId?: string, scopePath?: string) {
    const cached = await this.cache.get<{ nodeId: string; dependents: unknown[] }>(
      this.cache.impactKey(nodeId, projectId, scopePath),
    );
    if (cached) return cached;
    const matchProj = projectId ? ', projectId: $projectId' : '';
    const params: Record<string, string> = { nodeName: nodeId };
    if (projectId) params.projectId = projectId;

    const runImpact = async (graph: FalkorGraph) => {
      const result = (await graph.query(
        `MATCH (n {name: $nodeName${matchProj}})<-[:CALLS|RENDERS*]-(dependent) RETURN dependent.name AS name, labels(dependent) AS labels`,
        { params },
      )) as FalkorResult;
      const rows = this.mapImpactQueryRows(result);
      if (!projectId) return rows;
      /** Consumidores vía IMPORTS entre archivos (módulos API / utils sin aristas RENDERS hacia otros Component). */
      const importCons = (await graph.query(
        `MATCH (c:Component {name: $nodeName, projectId: $projectId})<-[:CONTAINS]-(f:File {projectId: $projectId}) ` +
          `MATCH (f2:File {projectId: $projectId})-[:IMPORTS]->(f) ` +
          `MATCH (f2)-[:CONTAINS]->(consumer:Component {projectId: $projectId}) ` +
          `RETURN consumer.name AS name, labels(consumer) AS labels`,
        { params },
      )) as FalkorResult;
      const extra = this.mapImpactQueryRows(importCons);
      const seen = new Set(rows.map((r) => `${String(r.name)}\0${JSON.stringify(r.labels)}`));
      for (const r of extra) {
        const k = `${String(r.name)}\0${JSON.stringify(r.labels)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        rows.push(r);
      }
      return rows;
    };

    let dependents: { name: unknown; labels: unknown }[];

    if (!projectId || scopePath) {
      const graph = await this.pickShardGraph(projectId, scopePath, async (g) => {
        const r = (await g.query(
          `MATCH (n {name: $nodeName${matchProj}}) RETURN count(n) AS c`,
          { params },
        )) as FalkorResult;
        const row = r.data?.[0] as unknown;
        let c = 0;
        if (row != null && typeof row === 'object' && 'c' in row) {
          c = Number((row as { c: unknown }).c);
        } else if (Array.isArray(row)) {
          c = Number(row[0]);
        }
        return Number.isFinite(c) && c > 0;
      });
      dependents = await runImpact(graph);
    } else {
      const names = await this.falkor.getProjectGraphNames(projectId);
      const merged: { name: unknown; labels: unknown }[] = [];
      const seen = new Set<string>();
      const pushDeduped = (rows: { name: unknown; labels: unknown }[]) => {
        for (const r of rows) {
          const k = `${String(r.name)}\0${JSON.stringify(r.labels)}`;
          if (seen.has(k)) continue;
          seen.add(k);
          merged.push(r);
        }
      };
      if (names.length <= 1) {
        const g = await this.falkor.getGraph(projectId);
        pushDeduped(await runImpact(g));
      } else {
        for (const nm of names) {
          try {
            const g = await this.falkor.selectGraphByLogicalName(nm);
            pushDeduped(await runImpact(g));
          } catch {
            /* shard vacío */
          }
        }
      }
      dependents = merged;
    }

    const payload = { nodeId, dependents };
    await this.cache.set(this.cache.impactKey(nodeId, projectId, scopePath), payload, this.cache.TTL.impact);
    return payload;
  }

  async getComponent(name: string, depth: number, projectId?: string, scopePath?: string) {
    const pid = projectId?.trim() || undefined;
    const cached = await this.cache.get<{
      componentName: string;
      depth: number;
      projectId?: string;
      dependencies: unknown[];
      nodes: GraphNodeDto[];
      edges: GraphEdgeDto[];
      graphHints?: GraphComponentHintsDto;
    }>(this.cache.componentKey(name, depth, pid, scopePath));
    if (cached) return cached;

    const compMatch = pid ? ', projectId: $projectId' : '';
    const params: Record<string, string> = { componentName: name };
    if (pid) params.projectId = pid;

    const accum: ComponentShardAccum = {
      seenDepKeys: new Set<string>(),
      dependencies: [],
      nodes: new Map<string, GraphNodeDto>(),
      edgeKey: new Set<string>(),
      edges: [],
      centerId: null,
    };

    /**
     * Sin projectId o con scopePath: un solo grafo (comportamiento anterior).
     * Con projectId y varios subgrafos por dominio: fusionar todos — el primer shard donde exista
     * un stub de «App» ya no oculta las aristas RENDERS del shard correcto.
     */
    if (!pid || scopePath) {
      const graph = await this.pickShardGraph(pid, scopePath, async (g) => {
        const r = (await g.query(
          `MATCH (c:Component {name: $componentName${compMatch}}) RETURN count(c) AS c`,
          { params },
        )) as FalkorResult;
        const row = r.data?.[0] as unknown;
        let c = 0;
        if (row != null && typeof row === 'object' && 'c' in row) {
          c = Number((row as { c: unknown }).c);
        } else if (Array.isArray(row)) {
          c = Number(row[0]);
        }
        return Number.isFinite(c) && c > 0;
      });
      await this.appendComponentShardData(graph, name, depth, pid, accum);
    } else {
      const shardNames = await this.falkor.getProjectGraphNames(pid);
      if (shardNames.length <= 1) {
        const graph = await this.falkor.getGraph(pid);
        await this.appendComponentShardData(graph, name, depth, pid, accum);
      } else {
        for (const gName of shardNames) {
          try {
            const graph = await this.falkor.selectGraphByLogicalName(gName);
            await this.appendComponentShardData(graph, name, depth, pid, accum);
          } catch {
            /* shard vacío o no legible */
          }
        }
      }
    }

    const { dependencies, nodes, edgeKey, edges } = accum;
    let centerId = accum.centerId;

    if (!centerId) {
      centerId = graphNodeKey({ kind: 'Component', projectId: pid ?? '', name });
      nodes.set(centerId, { id: centerId, kind: 'Component', name, ...(pid ? { projectId: pid } : {}) });
    }

    const impact = await this.getImpact(name, pid, scopePath);

    for (const d of impact.dependents as { name?: unknown; labels?: unknown }[]) {
      const gn = impactNode(d.name, d.labels, pid);
      nodes.set(gn.id, gn);
      addGraphEdge(edges, edgeKey, gn.id, centerId!, 'legacy_impact');
    }

    normalizeComponentGraphFocal(nodes, edges, name, centerId);

    /** Priorizar el nodo centro del corte Falkor (evita colisión si hay varios nodos con el mismo nombre). */
    let focalIdForHints: string | null =
      centerId && nodes.has(centerId) ? centerId : null;
    if (!focalIdForHints) {
      for (const [id, n] of nodes) {
        if (n.name === name && (n.kind === 'Component' || n.kind === 'Node')) {
          focalIdForHints = id;
          break;
        }
      }
    }
    if (!focalIdForHints) focalIdForHints = centerId;
    const dependsOut = focalIdForHints
      ? edges.filter((e) => e.kind === 'depends' && e.source === focalIdForHints).length
      : 0;
    const legacyInForHints = focalIdForHints
      ? edges.filter((e) => e.kind === 'legacy_impact' && e.target === focalIdForHints).length
      : 0;
    const graphHints: GraphComponentHintsDto | undefined =
      dependsOut === 0 && legacyInForHints === 0 && pid
        ? {
            suggestResync: true,
            messageEs:
              'Sin aristas depends salientes ni consumidores vía CALLS/RENDERS/IMPORTS en Falkor para este foco. Si es módulo API sin JSX, puede ser normal; si esperas uso desde otros archivos, resync y comprueba projectId. Rutas React: revisa aristas RENDERS tras indexar.',
          }
        : undefined;

    const payload = {
      componentName: name,
      depth,
      ...(pid ? { projectId: pid } : {}),
      dependencies,
      nodes: [...nodes.values()],
      edges,
      ...(graphHints ? { graphHints } : {}),
    };
    await this.cache.set(
      this.cache.componentKey(name, depth, pid, scopePath),
      payload,
      this.cache.TTL.component,
    );
    return payload;
  }

  async getContract(componentName: string, projectId?: string, scopePath?: string) {
    const cached = await this.cache.get<{
      componentName: string;
      props: { name: string; required: boolean }[];
    }>(this.cache.contractKey(componentName, projectId, scopePath));
    if (cached) return cached;
    const compMatch = projectId ? ', projectId: $projectId' : '';
    const params: Record<string, string> = { componentName };
    if (projectId) params.projectId = projectId;
    const graph = await this.pickShardGraph(projectId, scopePath, async (g) => {
      const r = (await g.query(
        `MATCH (c:Component {name: $componentName${compMatch}}) RETURN count(c) AS c`,
        { params },
      )) as FalkorResult;
      const row = r.data?.[0] as unknown;
      let c = 0;
      if (row != null && typeof row === 'object' && 'c' in row) {
        c = Number((row as { c: unknown }).c);
      } else if (Array.isArray(row)) {
        c = Number(row[0]);
      }
      return Number.isFinite(c) && c > 0;
    });
    const props = await this.getPropsForComponent(graph, componentName, projectId);
    const payload = { componentName, props };
    await this.cache.set(
      this.cache.contractKey(componentName, projectId, scopePath),
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

  async compare(
    componentName: string,
    projectId?: string,
    shadowSessionId?: string,
    scopePath?: string,
  ) {
    const mainGraph = await this.pickShardGraph(projectId, scopePath, async (g) => {
      const matchProj = projectId ? ', projectId: $projectId' : '';
      const params: Record<string, string> = { componentName };
      if (projectId) params.projectId = projectId;
      const r = (await g.query(
        `MATCH (c:Component {name: $componentName${matchProj}}) RETURN count(c) AS c`,
        { params },
      )) as FalkorResult;
      const row = r.data?.[0] as unknown;
      let c = 0;
      if (row != null && typeof row === 'object' && 'c' in row) {
        c = Number((row as { c: unknown }).c);
      } else if (Array.isArray(row)) {
        c = Number(row[0]);
      }
      return Number.isFinite(c) && c > 0;
    });
    const shadowGraph = await this.falkor.getShadowGraph(shadowSessionId ?? undefined);
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

  async getC4Model(projectId: string): Promise<C4ModelResponseDto> {
    const pid = String(projectId ?? '').trim();
    if (!pid) {
      throw new Error('projectId required');
    }
    const cached = await this.cache.get<C4ModelResponseDto>(this.cache.c4ModelKey(pid));
    if (cached) return cached;

    const shardContexts = await this.falkor.getCypherShardContexts(pid);
    type SysAgg = { repoId: string; name: string; containers: Map<string, C4ContainerNodeDto> };
    const byRepo = new Map<string, SysAgg>();
    const commByRepo = new Map<string, C4SystemNodeDto['communicates']>();

    const mergeComm = (repoId: string, row: { sourceKey: string; targetKey: string; reason?: string }) => {
      const list = commByRepo.get(repoId) ?? [];
      const ek = `${row.sourceKey}|${row.targetKey}|${row.reason ?? ''}`;
      const exists = list.some(
        (x) => `${x.sourceKey}|${x.targetKey}|${x.reason ?? ''}` === ek,
      );
      if (!exists) list.push(row);
      commByRepo.set(repoId, list);
    };

    for (const { graphName: nm, cypherProjectId } of shardContexts) {
      const g = await this.falkor.selectGraphByLogicalName(nm);
      const r1 = (await g.query(
        `MATCH (s:System {projectId: $projectId}) OPTIONAL MATCH (s)-[:HAS_CONTAINER]->(c:Container)
         RETURN s.repoId AS repoId, s.name AS sysName, c.key AS ck, c.name AS cname, c.technology AS tech, c.c4Kind AS kind, c.repoId AS cRepo`,
        { params: { projectId: cypherProjectId } },
      )) as FalkorResult;
      const d1 = r1.data ?? [];
      const h1 = r1.headers ?? [];
      const idx = (name: string) => h1.indexOf(name);
      const iRepo = idx('repoId');
      const iName = idx('sysName');
      const iCk = idx('ck');
      const iCn = idx('cname');
      const iTech = idx('tech');
      const iKind = idx('kind');
      const iCrepo = idx('cRepo');
      for (const row of d1 as unknown[]) {
        const arr = Array.isArray(row) ? row : [row];
        const repoId = falkorScalarToString(arr[iRepo >= 0 ? iRepo : 0] as unknown);
        const sysName = falkorScalarToString(arr[iName >= 0 ? iName : 1] as unknown);
        if (!repoId) continue;
        let agg = byRepo.get(repoId);
        if (!agg) {
          agg = { repoId, name: sysName || repoId, containers: new Map() };
          byRepo.set(repoId, agg);
        } else if (sysName) {
          agg.name = sysName;
        }
        const ck = iCk >= 0 ? falkorScalarToString(arr[iCk] as unknown) : undefined;
        if (!ck) continue;
        const cname = falkorScalarToString(arr[iCn >= 0 ? iCn : 0] as unknown) ?? ck;
        const tech = falkorScalarToString(arr[iTech >= 0 ? iTech : 0] as unknown);
        const kind = falkorScalarToString(arr[iKind >= 0 ? iKind : 0] as unknown) ?? 'software';
        const cRepo = falkorScalarToString(arr[iCrepo >= 0 ? iCrepo : 0] as unknown) ?? repoId;
        agg.containers.set(ck, {
          key: ck,
          name: cname,
          repoId: cRepo,
          ...(tech ? { technology: tech } : {}),
          c4Kind: kind,
        });
      }

      const r2 = (await g.query(
        `MATCH (a:Container {projectId: $projectId})-[r:COMMUNICATES_WITH]->(b:Container {projectId: $projectId})
         WHERE a.repoId = b.repoId
         RETURN a.repoId AS repoId, a.key AS src, b.key AS tgt, r.reason AS reason`,
        { params: { projectId: cypherProjectId } },
      )) as FalkorResult;
      const d2 = r2.data ?? [];
      const h2 = r2.headers ?? [];
      const j = (name: string) => h2.indexOf(name);
      const jr = j('repoId');
      const js = j('src');
      const jt = j('tgt');
      const jrns = j('reason');
      for (const row of d2 as unknown[]) {
        const arr = Array.isArray(row) ? row : [row];
        const repoId = falkorScalarToString(arr[jr >= 0 ? jr : 0] as unknown);
        const src = falkorScalarToString(arr[js >= 0 ? js : 1] as unknown);
        const tgt = falkorScalarToString(arr[jt >= 0 ? jt : 2] as unknown);
        const reason = falkorScalarToString(arr[jrns >= 0 ? jrns : 3] as unknown);
        if (!repoId || !src || !tgt) continue;
        mergeComm(repoId, { sourceKey: src, targetKey: tgt, ...(reason ? { reason } : {}) });
      }
    }

    const systems: C4SystemNodeDto[] = [...byRepo.values()].map((agg) => ({
      repoId: agg.repoId,
      name: agg.name,
      containers: [...agg.containers.values()].sort((a, b) => a.key.localeCompare(b.key)),
      communicates: commByRepo.get(agg.repoId) ?? [],
    }));
    systems.sort((a, b) => a.repoId.localeCompare(b.repoId));

    const payload: C4ModelResponseDto = { projectId: pid, systems };
    await this.cache.set(this.cache.c4ModelKey(pid), payload, this.cache.TTL.component);
    return payload;
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

  /**
   * Ejecuta Cypher contra Falkor con la misma selección de grafo que el resto de la API.
   * Requiere `FALKOR_DEBUG_CYPHER=1` en el proceso API (evita abrir escritura arbitraria en prod).
   * Solo lectura: rechaza CREATE/MERGE/DELETE/SET/REMOVE/DROP/LOAD CSV (heurística, no sandbox formal).
   */
  async executeDebugCypher(body: {
    query: string;
    params?: Record<string, unknown>;
    projectId?: string;
    scopePath?: string;
    graphName?: string;
  }): Promise<{ headers: string[]; data: unknown[][]; graphLabel: string }> {
    const enabled =
      process.env.FALKOR_DEBUG_CYPHER === '1' || process.env.FALKOR_DEBUG_CYPHER === 'true';
    if (!enabled) {
      throw new HttpException(
        'Cypher debug desactivado. Define FALKOR_DEBUG_CYPHER=1 en el servicio API (misma conexión Falkor que Nest).',
        HttpStatus.FORBIDDEN,
      );
    }
    const q = String(body.query ?? '').trim();
    if (!q.length) {
      throw new HttpException('query vacía', HttpStatus.BAD_REQUEST);
    }
    if (q.length > 12000) {
      throw new HttpException('query demasiado larga (máx. 12000 caracteres)', HttpStatus.BAD_REQUEST);
    }
    this.assertReadOnlyCypher(q);
    const params =
      body.params != null && typeof body.params === 'object' && !Array.isArray(body.params)
        ? (body.params as Record<string, unknown>)
        : undefined;

    const { graph, graphLabel } = await this.graphForDebugQuery({
      projectId: body.projectId,
      scopePath: body.scopePath,
      graphName: body.graphName,
    });

    const result = (await graph.query(
      q,
      params
        ? { params: params as Record<string, string | number | boolean | null> }
        : undefined,
    )) as FalkorResult;
    const headers = result.headers ?? [];
    const rawData = result.data ?? [];
    const data = rawData.map((row) => {
      const arr = Array.isArray(row) ? row : [row];
      return arr.map((cell) => this.serializeFalkorDebugCell(cell));
    });

    return { headers, data, graphLabel };
  }

  private assertReadOnlyCypher(q: string): void {
    const deny = [
      /\bCREATE\b/i,
      /\bMERGE\b/i,
      /\bDELETE\b/i,
      /\bDETACH\b/i,
      /\bDROP\b/i,
      /\bREMOVE\b/i,
      /\bSET\b/i,
      /\bLOAD\s+CSV\b/i,
    ];
    for (const re of deny) {
      if (re.test(q)) {
        throw new HttpException(
          'Solo consultas de lectura (CREATE/MERGE/DELETE/DETACH/SET/REMOVE/DROP/LOAD CSV no permitidos)',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
  }

  private async graphForDebugQuery(opts: {
    projectId?: string;
    scopePath?: string;
    graphName?: string;
  }): Promise<{ graph: FalkorGraph; graphLabel: string }> {
    const gn = opts.graphName?.trim();
    if (gn) {
      const graph = await this.falkor.selectGraphByLogicalName(gn);
      return { graph, graphLabel: gn };
    }
    const pid = opts.projectId?.trim() || undefined;
    const sp = opts.scopePath?.trim() || undefined;
    if (pid) {
      const graph = await this.falkor.getGraph(pid, sp ? { repoRelativePath: sp } : undefined);
      return { graph, graphLabel: sp ? `${pid}|scope:${sp}` : pid };
    }
    const graph = await this.falkor.getGraph(undefined);
    return { graph, graphLabel: 'default' };
  }

  private serializeFalkorDebugCell(cell: unknown): unknown {
    if (cell == null) return cell;
    const t = typeof cell;
    if (t !== 'object') return cell;
    if (Array.isArray(cell)) return cell.map((c) => this.serializeFalkorDebugCell(c));
    const o = cell as Record<string, unknown>;
    if (Array.isArray(o.labels)) {
      return {
        labels: o.labels,
        properties:
          o.properties != null && typeof o.properties === 'object'
            ? o.properties
            : { ...o, labels: undefined },
      };
    }
    try {
      return JSON.parse(JSON.stringify(cell)) as unknown;
    } catch {
      return String(cell);
    }
  }

  async shadowProxy(
    files: { path: string; content: string }[],
    shadowSessionId?: string,
  ) {
    const url = process.env.INGEST_URL ?? 'http://ingest:3002';
    const r = await fetch(`${url}/shadow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files,
        ...(shadowSessionId != null && String(shadowSessionId).trim()
          ? { shadowSessionId: String(shadowSessionId).trim() }
          : {}),
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok)
      throw Object.assign(new Error('Ingest shadow index failed'), { status: r.status, data });
    return data;
  }
}
