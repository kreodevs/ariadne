/**
 * @fileoverview Indexado post-sync de flujos en Falkor (fase 2): enums, CALLS chains, journeys.
 */
import { cypherSafe } from 'ariadne-common';
import type { GraphClient } from 'ariadne-common';
import {
  buildEnumStatusWorkflowSpec,
  buildJourneyWorkflowSpec,
  buildServiceChainWorkflowSpec,
  type IndexedFlowPayload,
} from 'ariadne-common';

export interface FlowGraphRow {
  flowId: string;
  kind: string;
  label: string;
  description: string;
  sourcePath?: string;
  payload: IndexedFlowPayload;
}

function flowMergeCypher(
  projectId: string,
  repoId: string,
  row: FlowGraphRow,
): string {
  const pid = cypherSafe(projectId);
  const rid = cypherSafe(repoId);
  const payloadJson = cypherSafe(JSON.stringify(row.payload));
  return (
    `MERGE (fl:Flow {flowId: ${cypherSafe(row.flowId)}, projectId: ${pid}, repoId: ${rid}}) ` +
    `ON CREATE SET fl.kind = ${cypherSafe(row.kind)}, fl.label = ${cypherSafe(row.label)}, ` +
    `fl.description = ${cypherSafe(row.description)}, fl.sourcePath = ${cypherSafe(row.sourcePath ?? '')}, ` +
    `fl.payloadJson = ${payloadJson} ` +
    `ON MATCH SET fl.kind = ${cypherSafe(row.kind)}, fl.label = ${cypherSafe(row.label)}, ` +
    `fl.description = ${cypherSafe(row.description)}, fl.sourcePath = ${cypherSafe(row.sourcePath ?? '')}, ` +
    `fl.payloadJson = ${payloadJson}`
  );
}

export async function queryEnumFlowRows(
  graph: GraphClient,
  projectId: string,
): Promise<FlowGraphRow[]> {
  const q = `
    MATCH (mod:Model)-[ue:USES_ENUM]->(en:Enum)
    WHERE mod.projectId = $projectId AND en.valuesJson IS NOT NULL
    RETURN en.name AS enumName, en.valuesJson AS valuesJson, mod.name AS modelName, ue.field AS fieldName
    LIMIT 40
  `;
  const res = (await graph.query(q, { params: { projectId } })) as {
    data?: Array<Record<string, unknown>>;
  };
  const rows: FlowGraphRow[] = [];
  for (const row of res.data ?? []) {
    const enumName = String(row.enumName ?? '');
    const modelName = String(row.modelName ?? '');
    const fieldName = String(row.fieldName ?? 'status');
    let values: string[] = [];
    try {
      values = JSON.parse(String(row.valuesJson ?? '[]')) as string[];
    } catch {
      values = [];
    }
    if (!enumName || values.length === 0) continue;
    const flowId = `enum:${enumName}`;
    const spec = buildEnumStatusWorkflowSpec(enumName, modelName, fieldName, values);
    rows.push({
      flowId,
      kind: 'enum-status',
      label: `${modelName}.${fieldName}`,
      description: `Enum ${enumName} (${values.length} valores)`,
      payload: {
        kind: 'enum-status',
        title: spec.title,
        subtitle: spec.subtitle,
        lanes: spec.lanes,
        mainPath: spec.mainPath,
        nodes: spec.nodes,
        edges: spec.edges,
      },
    });
  }
  return rows;
}

export async function queryServiceChainRows(
  graph: GraphClient,
  projectId: string,
): Promise<FlowGraphRow[]> {
  const q = `
    MATCH (nc:NestController)-[:DECLARES_ROUTE]->(nr:NestRoute)
    WHERE nr.projectId = $projectId AND nr.handlerName IS NOT NULL
    MATCH (cf:File)-[:CONTAINS]->(nc)
    OPTIONAL MATCH (cf)-[:CONTAINS]->(handlerFn:Function {name: nr.handlerName, projectId: $projectId})
    OPTIONAL MATCH (handlerFn)-[:CALLS*1..4]->(callee:Function {projectId: $projectId})
    WITH nr, handlerFn, collect(DISTINCT callee.name) AS callees
    WHERE handlerFn IS NOT NULL AND size(callees) >= 1
    RETURN coalesce(nr.fullPath, nr.path) AS routePath,
           nr.handlerName AS handlerName,
           callees
    ORDER BY size(callees) DESC
    LIMIT 30
  `;
  const res = (await graph.query(q, { params: { projectId } })) as {
    data?: Array<Record<string, unknown>>;
  };
  const rows: FlowGraphRow[] = [];
  const seen = new Set<string>();
  for (const row of res.data ?? []) {
    const handler = String(row.handlerName ?? '');
    const routePath = String(row.routePath ?? '/');
    const callees = Array.isArray(row.callees) ? row.callees.map(String) : [];
    if (!handler) continue;
    const flowId = `chain:${routePath}:${handler}`;
    if (seen.has(flowId)) continue;
    seen.add(flowId);
    const spec = buildServiceChainWorkflowSpec(routePath, handler, callees);
    rows.push({
      flowId,
      kind: 'service-chain',
      label: `${handler} · ${routePath}`,
      description: `${callees.length + 1} pasos CALLS`,
      payload: {
        kind: 'service-chain',
        title: spec.title,
        subtitle: spec.subtitle,
        lanes: spec.lanes,
        mainPath: spec.mainPath,
        nodes: spec.nodes,
        edges: spec.edges,
      },
    });
  }
  return rows;
}

export async function queryJourneyRows(
  graph: GraphClient,
  projectId: string,
): Promise<FlowGraphRow[]> {
  const q = `
    MATCH (rt:Route)
    WHERE rt.projectId = $projectId AND rt.path CONTAINS '/'
    WITH split(rt.path, '/')[1] AS segment, collect(DISTINCT rt.path) AS paths
    WHERE segment IS NOT NULL AND segment <> '' AND size(paths) >= 2
    RETURN segment, paths
    ORDER BY size(paths) DESC
    LIMIT 20
  `;
  const res = (await graph.query(q, { params: { projectId } })) as {
    data?: Array<Record<string, unknown>>;
  };
  const rows: FlowGraphRow[] = [];
  for (const row of res.data ?? []) {
    const segment = String(row.segment ?? '');
    const paths = Array.isArray(row.paths) ? row.paths.map(String).sort() : [];
    if (!segment || paths.length < 2) continue;
    const flowId = `journey:/${segment}`;
    const spec = buildJourneyWorkflowSpec(`/${segment}`, paths);
    rows.push({
      flowId,
      kind: 'journey',
      label: `Journey /${segment}`,
      description: `${paths.length} rutas`,
      payload: {
        kind: 'journey',
        title: spec.title,
        subtitle: spec.subtitle,
        lanes: spec.lanes,
        mainPath: spec.mainPath,
        nodes: spec.nodes,
        edges: spec.edges,
      },
    });
  }
  return rows;
}

export function flowRowsToCypher(projectId: string, repoId: string, rows: FlowGraphRow[]): string[] {
  return rows.map((row) => flowMergeCypher(projectId, repoId, row));
}

export async function buildPostSyncFlowIndexCypher(
  graph: GraphClient,
  projectId: string,
  repoId: string,
): Promise<string[]> {
  const enumRows = await queryEnumFlowRows(graph, projectId);
  const chainRows = await queryServiceChainRows(graph, projectId);
  const journeyRows = await queryJourneyRows(graph, projectId);
  const merged = [...enumRows, ...chainRows, ...journeyRows];
  const seen = new Set<string>();
  const unique = merged.filter((r) => {
    if (seen.has(r.flowId)) return false;
    seen.add(r.flowId);
    return true;
  });
  return flowRowsToCypher(projectId, repoId, unique);
}
