/**
 * Fragmentos Cypher y params para acotar retrieval del plan por scope (repoIds, prefijos).
 */
import { type ChatScope, normalizePathKey } from './chat-scope.util';

export interface ModificationPlanScopeCypher {
  fileClause: string;
  fnClause: string;
  params: Record<string, unknown>;
}

export function modificationPlanScopeCypher(scope?: ChatScope): ModificationPlanScopeCypher {
  let fileClause = '';
  let fnClause = '';
  const params: Record<string, unknown> = {};
  if (!scope) {
    return { fileClause, fnClause, params };
  }
  if (scope.repoIds?.length) {
    params.scopeRepoIds = scope.repoIds;
    fileClause += ` AND coalesce(f.repoId, f.projectId) IN $scopeRepoIds`;
    fnClause += ` AND coalesce(fn.repoId, fn.projectId) IN $scopeRepoIds`;
  }
  const prefs = (scope.includePathPrefixes ?? [])
    .map((x) => normalizePathKey(String(x).trim()))
    .filter((x) => x.length > 0);
  if (prefs.length > 0) {
    const partsF = prefs.map((_, i) => `f.path STARTS WITH $scopePref${i}`);
    const partsFn = prefs.map((_, i) => `fn.path STARTS WITH $scopePref${i}`);
    prefs.forEach((pref, i) => {
      params[`scopePref${i}`] = pref;
    });
    fileClause += ` AND (${partsF.join(' OR ')})`;
    fnClause += ` AND (${partsFn.join(' OR ')})`;
  }
  return { fileClause, fnClause, params };
}
