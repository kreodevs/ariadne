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

// --- Resolución discriminada (empates → ambiguous) para modification-plan / MCP ---

/** Metadatos mínimos para heurística sobre ruta de workspace. */
export interface RepoPathMatchInput {
  readonly repositoryId: string;
  readonly projectKey: string;
  readonly repoSlug: string;
}

/** Resultado de {@link resolveRepositoryIdForWorkspacePath}. */
export type WorkspacePathRepoResolution =
  | { readonly kind: 'unique'; readonly repositoryId: string; readonly label: string }
  | { readonly kind: 'none' }
  | {
      readonly kind: 'ambiguous';
      readonly candidates: ReadonlyArray<{ readonly repositoryId: string; readonly label: string }>;
    };

export function normalizeWorkspacePath(p: string): string {
  const s = p.trim().replace(/\\/g, '/');
  if (s.length > 1 && s.endsWith('/')) return s.slice(0, -1);
  return s;
}

export function scoreRepoPathMatch(normalizedPath: string, repo: RepoPathMatchInput): number {
  const slug = repo.repoSlug.trim();
  const key = repo.projectKey.trim();
  if (!slug) return 0;

  const slugSeg = `/${slug}/`;
  const slugEnd = `/${slug}`;
  const composite = key ? `${key}/${slug}` : slug;
  const compositeSeg = `/${composite}/`;
  const compositeEnd = `/${composite}`;

  let best = 0;
  if (normalizedPath.includes(compositeSeg) || normalizedPath.endsWith(compositeEnd)) {
    best = Math.max(best, composite.length + 2);
  }
  if (normalizedPath.includes(slugSeg) || normalizedPath.endsWith(slugEnd)) {
    best = Math.max(best, slug.length + 2);
  }
  return best;
}

/**
 * Infiere un único repositoryId desde una ruta de IDE; si empatan varios repos, `ambiguous`.
 */
export function resolveRepositoryIdForWorkspacePath(
  absolutePath: string,
  repos: readonly RepoPathMatchInput[],
): WorkspacePathRepoResolution {
  if (!absolutePath?.trim() || repos.length === 0) {
    return { kind: 'none' };
  }
  const pathNorm = normalizeWorkspacePath(absolutePath);

  const scored = repos.map((r) => ({
    repo: r,
    score: scoreRepoPathMatch(pathNorm, r),
    label: `${r.projectKey}/${r.repoSlug}`,
  }));

  const matched = scored.filter((s) => s.score > 0);
  if (matched.length === 0) {
    return { kind: 'none' };
  }
  const maxScore = Math.max(...matched.map((m) => m.score));
  const top = matched.filter((m) => m.score === maxScore);
  if (top.length === 1) {
    const t = top[0]!;
    return {
      kind: 'unique',
      repositoryId: t.repo.repositoryId,
      label: t.label,
    };
  }
  return {
    kind: 'ambiguous',
    candidates: top.map((t) => ({ repositoryId: t.repo.repositoryId, label: t.label })),
  };
}
