/**
 * Capa intrínseca del diagnóstico: Cypher acotado por repo + fusión con métricas CALL (capa extrínseca).
 */

import { computeRiskScore, findImportCycles } from './chat-analysis.utils';
import type { AntipatternsResult } from './chat-antipatterns.service';
import type { ChatCypherService } from './chat-cypher.service';
import {
  pathInAnalyzeFocus,
  isAnalyzeScopeActive,
  filterImportCyclesTouchingFocus,
  type FanInStats,
} from './analyze-focus.util';
import type { ChatScope } from './chat-scope.util';

export type DiagnosticoRiskRowCore = {
  path: string;
  name: string;
  outCalls: number;
  complexity: string | number;
  loc: string | number;
  noDesc: string;
  riskScore: number;
};

export type DiagnosticoRiskRow = DiagnosticoRiskRowCore & {
  inCalls?: number;
  inCallsInsideFocus?: number;
  inCallsOutsideFocus?: number;
  sampleCallersOutsideFocus?: string[];
  outCallsOutsideFocus?: number;
};

export interface DiagnosticoIntrinsicBase {
  allIndexedFilePaths: string[];
  graphSummary: Awaited<ReturnType<ChatCypherService['getGraphSummary']>>;
  riskRankedCore: DiagnosticoRiskRowCore[];
  highCouplingScoped: Array<{ path: string; name: string; outCalls: number }>;
  noDescriptionScoped: Array<{ path: string; name: string }>;
  componentPropsScoped: Array<{ path: string; component: string; propCount: number }>;
  antipatternsRaw: AntipatternsResult;
}

type CypherPort = Pick<ChatCypherService, 'executeCypher' | 'getGraphSummary'>;

export async function fetchDiagnosticoIntrinsicBase(params: {
  projectId: string;
  repositoryId: string;
  scope: ChatScope | undefined;
  cypher: CypherPort;
  detectAntipatterns: (repositoryId: string) => Promise<AntipatternsResult>;
}): Promise<DiagnosticoIntrinsicBase> {
  const { projectId, repositoryId, scope, cypher, detectAntipatterns } = params;
  const inF = (p: string) => pathInAnalyzeFocus(p, scope, repositoryId);
  const scopeActive = isAnalyzeScopeActive(scope);
  const rp = { repoId: repositoryId };

  const graphSummary = await cypher.getGraphSummary(repositoryId, true, true);

  const allFilesRows = (await cypher.executeCypher(
    projectId,
    `MATCH (f:File) WHERE f.projectId = $projectId AND f.repoId = $repoId RETURN f.path as path ORDER BY f.path`,
    rp,
  )) as Array<{ path: string }>;
  const allIndexedFilePaths = allFilesRows.map((r) => r.path);

  const riskCandidates = (await cypher.executeCypher(
    projectId,
    `MATCH (a:Function) WHERE a.projectId = $projectId AND a.repoId = $repoId
     OPTIONAL MATCH (a)-[:CALLS]->(b:Function)
     WITH a, collect(b) as outs
     WITH a, size([x IN outs WHERE x IS NOT NULL AND x.repoId = $repoId]) as outCalls
     RETURN a.path as path, a.name as name, outCalls, a.complexity as complexity, a.loc as loc, a.description as description`,
    rp,
  )) as Array<{
    path: string;
    name: string;
    outCalls: number;
    complexity?: number;
    loc?: number;
    description?: string | null;
  }>;

  let riskRankedCore = riskCandidates
    .map((r) => ({
      ...r,
      noDesc: !r.description || String(r.description).trim() === '',
      riskScore: computeRiskScore({
        outCalls: r.outCalls,
        complexity: r.complexity,
        loc: r.loc,
        noDesc: !r.description || String(r.description).trim() === '',
      }),
    }))
    .sort((a, b) => b.riskScore - a.riskScore)
    .map(({ path, name, outCalls, complexity, loc, noDesc, riskScore }) => ({
      path,
      name,
      outCalls,
      complexity: complexity ?? '—',
      loc: loc ?? '—',
      noDesc: noDesc ? 'Sí' : 'No',
      riskScore,
    }));

  if (scopeActive) {
    riskRankedCore = riskRankedCore.filter((r) => inF(r.path));
  }

  const highCoupling = (await cypher.executeCypher(
    projectId,
    `MATCH (a:Function)-[:CALLS]->(b:Function) WHERE a.projectId = $projectId AND b.projectId = $projectId
     AND a.repoId = $repoId AND b.repoId = $repoId
     WITH a, count(b) as outCalls
     WHERE outCalls > 5
     RETURN a.path as path, a.name as name, outCalls ORDER BY outCalls DESC`,
    rp,
  )) as Array<{ path: string; name: string; outCalls: number }>;
  const highCouplingScoped = scopeActive ? highCoupling.filter((r) => inF(r.path)) : highCoupling;

  const noDescription = (await cypher.executeCypher(
    projectId,
    `MATCH (n:Function) WHERE n.projectId = $projectId AND n.repoId = $repoId
     AND (n.description IS NULL OR n.description = '')
     RETURN n.path as path, n.name as name`,
    rp,
  )) as Array<{ path: string; name: string }>;
  const noDescriptionScoped = scopeActive ? noDescription.filter((r) => inF(r.path)) : noDescription;

  const componentProps = (await cypher.executeCypher(
    projectId,
    `MATCH (f:File)-[:CONTAINS]->(c:Component)-[:HAS_PROP]->(p:Prop)
     WHERE c.projectId = $projectId AND f.projectId = $projectId AND c.repoId = $repoId AND f.repoId = $repoId AND p.repoId = $repoId
     WITH f.path as path, c.name as component, count(p) as propCount
     WHERE propCount > 5
     RETURN path, component, propCount ORDER BY propCount DESC`,
    rp,
  )) as Array<{ path: string; component: string; propCount: number }>;
  const componentPropsScoped = scopeActive ? componentProps.filter((r) => inF(r.path)) : componentProps;

  const antipatternsRaw = await detectAntipatterns(repositoryId);

  return {
    allIndexedFilePaths,
    graphSummary,
    riskRankedCore,
    highCouplingScoped,
    noDescriptionScoped,
    componentPropsScoped,
    antipatternsRaw,
  };
}

export function attachExtrinsicMetricsToRiskRows(
  core: DiagnosticoRiskRowCore[],
  scopeActive: boolean,
  fanInByCalleeKey: Map<string, FanInStats>,
  outCallsOutsideFocusByCallerKey: Map<string, number>,
): DiagnosticoRiskRow[] {
  if (!scopeActive) {
    return core.map((r) => ({ ...r }));
  }
  return core.map((r) => {
    const k = `${r.path}::${r.name}`;
    const fi = fanInByCalleeKey.get(k);
    const outX = outCallsOutsideFocusByCallerKey.get(k) ?? 0;
    return {
      ...r,
      inCalls: fi?.inCalls ?? 0,
      inCallsInsideFocus: fi?.inCallsInsideFocus ?? 0,
      inCallsOutsideFocus: fi?.inCallsOutsideFocus ?? 0,
      sampleCallersOutsideFocus: fi?.sampleCallersOutsideFocus ?? [],
      outCallsOutsideFocus: outX,
    };
  });
}

export async function buildDiagnosticoAntipatternsScoped(params: {
  projectId: string;
  repositoryId: string;
  scope: ChatScope | undefined;
  scopeActive: boolean;
  antipatternsRaw: AntipatternsResult;
  fanInByCalleeKey: Map<string, FanInStats>;
  executeCypher: ChatCypherService['executeCypher'];
}): Promise<AntipatternsResult> {
  const { projectId, repositoryId, scope, scopeActive, antipatternsRaw, fanInByCalleeKey, executeCypher } =
    params;
  const inF = (p: string) => pathInAnalyzeFocus(p, scope, repositoryId);

  if (!scopeActive) {
    return antipatternsRaw;
  }

  const highFanInFromEdges: Array<{
    path: string;
    name: string;
    inCalls: number;
    inCallsInsideFocus: number;
    inCallsOutsideFocus: number;
    sampleCallersOutsideFocus: string[];
  }> = [];
  for (const [key, st] of fanInByCalleeKey) {
    if (st.inCalls <= 5) continue;
    const sep = key.indexOf('::');
    if (sep < 0) continue;
    const path = key.slice(0, sep);
    const name = key.slice(sep + 2);
    if (!inF(path)) continue;
    highFanInFromEdges.push({
      path,
      name,
      inCalls: st.inCalls,
      inCallsInsideFocus: st.inCallsInsideFocus,
      inCallsOutsideFocus: st.inCallsOutsideFocus,
      sampleCallersOutsideFocus: st.sampleCallersOutsideFocus,
    });
  }
  highFanInFromEdges.sort((a, b) => b.inCalls - a.inCalls);

  const imports = (await executeCypher(
    projectId,
    `MATCH (a:File)-[:IMPORTS]->(b:File) WHERE a.projectId = $projectId AND b.projectId = $projectId
     AND a.repoId = $repoId AND b.repoId = $repoId
     RETURN a.path as fromPath, b.path as toPath`,
    { repoId: repositoryId },
  )) as Array<{ fromPath: string; toPath: string }>;
  const circularScoped = filterImportCyclesTouchingFocus(findImportCycles(imports), scope, repositoryId);

  return {
    spaghetti: antipatternsRaw.spaghetti.filter((x) => inF(x.path)),
    godFunctions: antipatternsRaw.godFunctions.filter((x) => inF(x.path)),
    highFanIn: highFanInFromEdges,
    circularImports: circularScoped,
    overloadedComponents: antipatternsRaw.overloadedComponents,
  };
}
