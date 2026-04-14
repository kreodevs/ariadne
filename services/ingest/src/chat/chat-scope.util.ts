/**
 * Filtros de alcance multi-root (plan_mcp_grounding_y_retrieval §2).
 */

export interface ChatScope {
  /** Si se define y no está vacío, solo estos repoId (grafo). */
  repoIds?: string[];
  /** path debe empezar por al menos uno de estos prefijos (normalizados con /). */
  includePathPrefixes?: string[];
  /** Si path coincide con algún patrón glob simple, se excluye. */
  excludePathGlobs?: string[];
}

/** true si el cliente acotó explícitamente el alcance (repoIds, prefijos o globs no vacíos). */
export function hasExplicitChatScopeNarrowing(scope?: ChatScope): boolean {
  if (!scope) return false;
  if (Array.isArray(scope.repoIds) && scope.repoIds.length > 0) return true;
  if (Array.isArray(scope.includePathPrefixes) && scope.includePathPrefixes.length > 0) return true;
  if (Array.isArray(scope.excludePathGlobs) && scope.excludePathGlobs.length > 0) return true;
  return false;
}

/** Normaliza path para comparación (slashes, sin leading ./). */
export function normalizePathKey(path: string): string {
  return path.replace(/^\.\//, '').replace(/\\/g, '/');
}

function globPatternToRegExp(pattern: string): RegExp {
  const norm = normalizePathKey(pattern.trim());
  let s = norm.replace(/\*\*/g, '\0GS\0');
  s = s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  s = s.replace(/\0GS\0/g, '.*');
  s = s.replace(/\*/g, '[^/]*');
  return new RegExp(`^${s}$`, 'i');
}

function pathMatchesGlob(path: string, glob: string): boolean {
  try {
    return globPatternToRegExp(glob).test(normalizePathKey(path));
  } catch {
    return path.includes(glob.replace(/\*\*/g, ''));
  }
}

/**
 * @returns true si el par (path, repoId) pasa los filtros del scope.
 */
export function matchesChatScope(path: string | undefined | null, repoId: string | undefined | null, scope?: ChatScope): boolean {
  if (!scope || (!scope.repoIds?.length && !scope.includePathPrefixes?.length && !scope.excludePathGlobs?.length)) {
    return true;
  }
  const p = path ? normalizePathKey(path) : '';
  const r = repoId ?? '';

  if (scope.repoIds && scope.repoIds.length > 0 && r && !scope.repoIds.includes(r)) {
    return false;
  }
  if (scope.includePathPrefixes && scope.includePathPrefixes.length > 0) {
    const ok = scope.includePathPrefixes.some((pref) => p.startsWith(normalizePathKey(pref)));
    if (!ok) return false;
  }
  if (scope.excludePathGlobs && scope.excludePathGlobs.length > 0 && p) {
    for (const g of scope.excludePathGlobs) {
      if (pathMatchesGlob(p, g)) return false;
    }
  }
  return true;
}

/** Filtra filas típicas de Cypher con path y opcional repoId. */
export function filterCypherRowsByScope(rows: Record<string, unknown>[], scope?: ChatScope): Record<string, unknown>[] {
  if (!scope || (!scope.repoIds?.length && !scope.includePathPrefixes?.length && !scope.excludePathGlobs?.length)) {
    return rows;
  }
  return rows.filter((row) => {
    const path = (row.path ?? row.fnPath ?? row.file) as string | undefined;
    const repoId = (row.repoId ?? row.repo_id) as string | undefined;
    return matchesChatScope(path, repoId, scope);
  });
}
