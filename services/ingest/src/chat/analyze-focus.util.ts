/**
 * Alcance (scope) para `get_project_analysis`: conjunto foco F y validación MCP.
 */

import { BadRequestException } from '@nestjs/common';
import { ChatScope, matchesChatScope, normalizePathKey } from './chat-scope.util';

/** Valida scope antes de análisis; rechaza `includePathPrefixes: []` explícito. */
export function validateAnalyzeScope(scope: ChatScope | undefined, repositoryId: string): void {
  if (scope?.includePathPrefixes !== undefined && scope.includePathPrefixes.length === 0) {
    throw new BadRequestException(
      'scope.includePathPrefixes no puede ser un array vacío. Omite scope para analizar todo el repositorio o indica al menos un prefijo de ruta.',
    );
  }
  if (scope?.repoIds && scope.repoIds.length > 0 && !scope.repoIds.includes(repositoryId)) {
    throw new BadRequestException(
      `scope.repoIds debe incluir el repositorio bajo análisis (${repositoryId}).`,
    );
  }
}

/** Extrae la ruta de un label `path::name` usado en pares de duplicados. */
export function pathFromPairLabel(label: string): string {
  const i = label.indexOf('::');
  return i >= 0 ? label.slice(0, i) : label;
}

/** true si la ruta pertenece al conjunto foco F (misma semántica que chat/plan). */
export function pathInAnalyzeFocus(
  path: string | undefined | null,
  scope: ChatScope | undefined,
  repositoryId: string,
): boolean {
  if (!path) return false;
  return matchesChatScope(path, repositoryId, scope);
}

/** true si hay acotación distinta de “todo el repo indexado”. */
export function isAnalyzeScopeActive(scope: ChatScope | undefined): boolean {
  if (!scope) return false;
  return !!(
    (scope.repoIds && scope.repoIds.length > 0) ||
    (scope.includePathPrefixes && scope.includePathPrefixes.length > 0) ||
    (scope.excludePathGlobs && scope.excludePathGlobs.length > 0)
  );
}

export interface AnalyzeReportMeta {
  scopeApplied: boolean;
  focusPrefixes: string[];
  filesAnalyzedInFocus: number;
  filesTotalInFocus: number;
  graphCoverageNote?: string;
  /** Respuesta servida desde caché de análisis. */
  fromCache?: boolean;
  cacheFingerprintMode?: 'full' | 'degraded';
  cacheScopePartitioned?: boolean;
  extrinsicCallsLayerCacheHit?: boolean;
  extrinsicCallsLayerRedisHit?: boolean;
}

export function buildAnalyzeReportMeta(params: {
  scope: ChatScope | undefined;
  repositoryId: string;
  allIndexedFilePaths: string[];
  truncatedFiles?: boolean;
  analyzedFileCount?: number;
}): AnalyzeReportMeta {
  const { scope, repositoryId, allIndexedFilePaths, truncatedFiles, analyzedFileCount } = params;
  const active = isAnalyzeScopeActive(scope);
  const inFocusPaths = allIndexedFilePaths.filter((p) => pathInAnalyzeFocus(p, scope, repositoryId));
  const filesTotalInFocus = inFocusPaths.length;
  const filesAnalyzedInFocus =
    analyzedFileCount !== undefined ? analyzedFileCount : filesTotalInFocus;
  const notes: string[] = [];
  if (active) {
    notes.push(
      'Métricas extrínsecas (fan-in, consumidores fuera del foco, alcanzabilidad) usan aristas del grafo completo del repositorio; el foco acota candidatos y rankings intrínsecos.',
    );
  }
  if (truncatedFiles) {
    notes.push('Muestra parcial: no todos los archivos del foco entraron en esta pasada (límite de rendimiento).');
  }
  return {
    scopeApplied: active,
    focusPrefixes: (scope?.includePathPrefixes ?? []).map((p) => normalizePathKey(p)),
    filesAnalyzedInFocus,
    filesTotalInFocus,
    graphCoverageNote: notes.length ? notes.join(' ') : undefined,
  };
}

/** Imports circulares donde al menos un extremo está en F. */
export function filterImportCyclesTouchingFocus(
  cycles: Array<[string, string]>,
  scope: ChatScope | undefined,
  repositoryId: string,
): Array<[string, string]> {
  if (!isAnalyzeScopeActive(scope)) return cycles;
  return cycles.filter(
    ([a, b]) =>
      pathInAnalyzeFocus(a, scope, repositoryId) || pathInAnalyzeFocus(b, scope, repositoryId),
  );
}

export type CallEdgeRow = { fromPath: string; fromName: string; toPath: string; toName: string };

export type FanInStats = {
  inCalls: number;
  inCallsInsideFocus: number;
  inCallsOutsideFocus: number;
  sampleCallersOutsideFocus: string[];
};

/** Por función (path::name): fan-in; fan-out hacia fuera del foco. */
export function aggregateCallEdgesForScope(
  edges: CallEdgeRow[],
  scope: ChatScope | undefined,
  repositoryId: string,
  sampleLimit = 8,
): {
  fanInByCalleeKey: Map<string, FanInStats>;
  outCallsOutsideFocusByCallerKey: Map<string, number>;
  truncated: boolean;
} {
  const inF = (p: string) => pathInAnalyzeFocus(p, scope, repositoryId);
  const fanInByCalleeKey = new Map<string, FanInStats>();
  const outCallsOutsideFocusByCallerKey = new Map<string, number>();

  const calleeKey = (path: string, name: string) => `${path}::${name}`;
  const mergeFanIn = (path: string, name: string, callerPath: string, callerInF: boolean) => {
    const key = calleeKey(path, name);
    let s = fanInByCalleeKey.get(key);
    if (!s) {
      s = {
        inCalls: 0,
        inCallsInsideFocus: 0,
        inCallsOutsideFocus: 0,
        sampleCallersOutsideFocus: [],
      };
      fanInByCalleeKey.set(key, s);
    }
    s.inCalls += 1;
    if (callerInF) s.inCallsInsideFocus += 1;
    else {
      s.inCallsOutsideFocus += 1;
      if (s.sampleCallersOutsideFocus.length < sampleLimit) {
        s.sampleCallersOutsideFocus.push(callerPath);
      }
    }
  };

  const seenPair = new Set<string>();
  for (const e of edges) {
    const pairKey = `${e.fromPath}|${e.fromName}|${e.toPath}|${e.toName}`;
    if (seenPair.has(pairKey)) continue;
    seenPair.add(pairKey);

    const callerInF = inF(e.fromPath);
    if (inF(e.toPath)) {
      mergeFanIn(e.toPath, e.toName, e.fromPath, callerInF);
    }

    if (inF(e.fromPath) && !inF(e.toPath)) {
      const ck = calleeKey(e.fromPath, e.fromName);
      outCallsOutsideFocusByCallerKey.set(ck, (outCallsOutsideFocusByCallerKey.get(ck) ?? 0) + 1);
    }
  }

  return { fanInByCalleeKey, outCallsOutsideFocusByCallerKey, truncated: false };
}
