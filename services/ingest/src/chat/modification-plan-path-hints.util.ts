/**
 * Heurística: rutas tipo repo-relative en la descripción para priorizar entradas en filesToModify.
 */
import { normalizePathKey } from './chat-scope.util';

const PATH_IN_TEXT_RE =
  /(?:^|[\s"'(])((?:[\w.-]+\/)+[\w.-]+\.(?:tsx?|jsx?|mjs|cjs|vue|svelte))\b/gi;

export function extractLikelyRepoRelativePaths(description: string, max = 8): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  PATH_IN_TEXT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while (out.length < max && (m = PATH_IN_TEXT_RE.exec(description)) !== null) {
    const p = normalizePathKey(m[1]!);
    if (p.length >= 4 && !seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

export function prioritizeModificationPlanFiles(
  files: Array<{ path: string; repoId: string }>,
  priorityPaths: string[],
): Array<{ path: string; repoId: string }> {
  if (priorityPaths.length === 0 || files.length <= 1) return files;
  const prioSet = new Set(priorityPaths.map((x) => normalizePathKey(x)));
  const hit: Array<{ path: string; repoId: string }> = [];
  const rest: Array<{ path: string; repoId: string }> = [];
  const hitKey = new Set<string>();
  for (const f of files) {
    if (prioSet.has(normalizePathKey(f.path))) {
      const k = `${f.path}\t${f.repoId}`;
      if (!hitKey.has(k)) {
        hitKey.add(k);
        hit.push(f);
      }
    } else {
      rest.push(f);
    }
  }
  return hit.length > 0 ? [...hit, ...rest] : files;
}
