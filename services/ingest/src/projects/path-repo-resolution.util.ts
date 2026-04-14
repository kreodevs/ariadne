/**
 * @fileoverview Heurística multi-root: infiere qué repositorio del proyecto corresponde a una ruta absoluta del IDE comparando segmentos con projectKey y repoSlug.
 */

export type RepoResolutionInput = {
  id: string;
  projectKey: string;
  repoSlug: string;
};

export type PathRepoResolution = {
  repoId: string | null;
  /** Puntuación interna; mayor = mejor coincidencia. */
  score: number;
  match?: string;
};

function normalizeFsPath(p: string): string {
  return p.replace(/\\/g, '/').trim().replace(/\/+$/, '');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Puntuación de coincidencia entre una ruta local y los metadatos del repo remoto.
 * Evita coincidencias débiles (p. ej. slug muy corto) con umbral mínimo vía score.
 */
export function scorePathAgainstRepo(absPath: string, repo: RepoResolutionInput): number {
  const norm = normalizeFsPath(absPath).toLowerCase();
  const slug = repo.repoSlug.toLowerCase();
  const key = repo.projectKey.toLowerCase();
  if (!slug || !norm) return 0;

  let score = 0;

  const slugSeg = new RegExp(`/${escapeRegExp(slug)}(/|$)`, 'i');
  if (slugSeg.test(norm)) {
    score += 100 + slug.length;
  }

  const compound = `${key}/${slug}`;
  if (norm.includes(`/${compound}/`) || norm.endsWith(`/${compound}`)) {
    score += 200 + compound.length;
  }

  if (key && key !== slug) {
    const keySeg = new RegExp(`/${escapeRegExp(key)}(/|$)`, 'i');
    if (keySeg.test(norm)) {
      score += 40 + key.length;
    }
  }

  return score;
}

/**
 * Elige el repo cuya ruta encaja mejor con `absolutePath`. Proyecto mono-repo: devuelve el único id sin mirar la ruta.
 */
export function resolveRepoIdForAbsolutePath(
  absolutePath: string,
  repos: RepoResolutionInput[],
): PathRepoResolution {
  const trimmed = absolutePath?.trim() ?? '';
  if (!trimmed || repos.length === 0) {
    return { repoId: null, score: 0 };
  }

  if (repos.length === 1) {
    return {
      repoId: repos[0].id,
      score: 1000,
      match: 'single-root',
    };
  }

  let best: { repo: RepoResolutionInput; score: number } | null = null;
  for (const repo of repos) {
    const s = scorePathAgainstRepo(trimmed, repo);
    if (s <= 0) continue;
    if (!best || s > best.score || (s === best.score && repo.repoSlug.length > best.repo.repoSlug.length)) {
      best = { repo, score: s };
    }
  }

  if (!best || best.score < 50) {
    return { repoId: null, score: best?.score ?? 0 };
  }

  return {
    repoId: best.repo.id,
    score: best.score,
    match: `${best.repo.projectKey}/${best.repo.repoSlug}`,
  };
}
