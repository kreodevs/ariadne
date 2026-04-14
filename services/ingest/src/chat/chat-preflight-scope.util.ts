/**
 * Preflight multi-root: si el retrieval mezcla `repoId` pero el mensaje incluye
 * una ruta que resuelve a un único repositorio del proyecto, se recortan filas y trozos de
 * contexto antes del sintetizador (`CHAT_PREFLIGHT_PATH_REPO`, default activo salvo `0|false|off`).
 */

/** UUID v4 en texto (case-insensitive). */
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

/**
 * Extrae rutas candidatas para `resolveRepositoryForWorkspacePath` desde el texto del usuario
 * (absolutas Unix/Windows y relativas estilo `src/foo/bar.ts`).
 * @param fullText - Mensaje + historial relevante.
 */
export function extractPathCandidatesForRepoResolve(fullText: string): string[] {
  const out = new Set<string>();
  const text = fullText ?? '';
  const absUnix = text.match(/(\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+\.(?:tsx?|jsx?|mjs|cjs))\b/g) ?? [];
  for (const m of absUnix) out.add(m.trim());
  const absWin = text.match(/\b([A-Za-z]:\\(?:[^\\/:]+\\)+[^\\/:]+\.(?:tsx?|jsx?|mjs|cjs))\b/gi) ?? [];
  for (const m of absWin) out.add(m.replace(/\\/g, '/'));
  const rel = text.match(/\b([\w.-]+(?:\/[\w./-]+)+\.(?:tsx?|jsx?|mjs|cjs))\b/g) ?? [];
  for (const m of rel) out.add(m.trim());
  return [...out];
}

/**
 * `repoId` distintos presentes en filas estructuradas del retrieval (Cypher / semántica).
 */
export function repoIdsInCollectedResults(results: unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const r of results) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const rid = o.repoId ?? o.repo_id;
    if (typeof rid === 'string' && rid.length > 0) ids.add(rid);
  }
  return ids;
}

/**
 * Conserva filas sin `repoId` o con el repo objetivo (multi-root).
 * @param targetRepoId - UUID del repositorio inferido por path.
 */
export function filterCollectedResultsByTargetRepo(results: unknown[], targetRepoId: string): unknown[] {
  const t = targetRepoId.toLowerCase();
  return results.filter((r) => {
    if (!r || typeof r !== 'object') return true;
    const o = r as Record<string, unknown>;
    const rid = o.repoId ?? o.repo_id;
    if (typeof rid !== 'string' || !rid.length) return true;
    return rid.toLowerCase() === t;
  });
}

/**
 * Elimina bloques de contexto que solo mencionan UUIDs de otros repos del proyecto (tablas Cypher/semantic).
 * Bloques sin UUID de proyecto o que incluyen el repo objetivo se conservan.
 * @param context - `gatheredContext` unido por `\n\n---\n\n`.
 * @param targetRepoId - Repo acordado por heurística de path.
 * @param projectRepoIdSet - Todos los `repositories.id` del proyecto.
 */
export function filterGatheredContextByTargetRepo(
  context: string,
  targetRepoId: string,
  projectRepoIdSet: Set<string>,
): string {
  const target = targetRepoId.toLowerCase();
  const idSet = new Set([...projectRepoIdSet].map((x) => x.toLowerCase()));
  const chunks = context.split('\n\n---\n\n');
  const kept = chunks.filter((chunk) => {
    const matches = chunk.match(UUID_RE) ?? [];
    const inProject = [
      ...new Set(
        matches
          .map((u) => u.toLowerCase())
          .filter((u) => idSet.has(u)),
      ),
    ];
    if (inProject.length === 0) return true;
    if (inProject.includes(target)) return true;
    return false;
  });
  return kept.join('\n\n---\n\n');
}
