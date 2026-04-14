/**
 * Construye `ChatScope` desde textareas del formulario de analyze (una entrada por línea).
 */
import type { ChatScope } from '../types';

function linesField(text: string): string[] | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length ? lines : undefined;
}

/** Si no hay prefijos, globs ni repoIds, devuelve undefined (todo el repo según backend). */
export function scopeFromAnalyzeForm(
  includePrefixesText: string,
  excludeGlobsText: string,
  repoIds?: string[],
): ChatScope | undefined {
  const includePathPrefixes = linesField(includePrefixesText);
  const excludePathGlobs = linesField(excludeGlobsText);
  const hasRepos = !!(repoIds && repoIds.length);
  if (!includePathPrefixes && !excludePathGlobs && !hasRepos) return undefined;
  const scope: ChatScope = {};
  if (includePathPrefixes) scope.includePathPrefixes = includePathPrefixes;
  if (excludePathGlobs) scope.excludePathGlobs = excludePathGlobs;
  if (hasRepos) scope.repoIds = repoIds;
  return scope;
}
