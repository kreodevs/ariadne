/**
 * @fileoverview Enriquecimiento de contexto multi-root: lectura local de `.ariadne-project` + heurística en ingest (`resolve-repo-for-path`) antes de chat / modification-plan.
 */
import path from "node:path";
import { loadAriadneProjectConfigNearFile } from "./utils.js";

export function getIngestBase(): string {
  return (process.env.INGEST_URL ?? process.env.ARIADNESPEC_INGEST_URL ?? "").replace(/\/$/, "");
}

/** True si `id` es un proyecto Ariadne (existe `GET /projects/:id`). */
export async function ingestProjectExists(projectId: string): Promise<boolean> {
  const base = getIngestBase();
  if (!base || !projectId.trim()) return false;
  try {
    const res = await fetch(`${base}/projects/${encodeURIComponent(projectId.trim())}`, {
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function toAbsoluteIdePath(filePath: string): string {
  const t = filePath.trim();
  if (!t) return t;
  const norm = t.replace(/\\/g, "/");
  if (norm.startsWith("/") || /^[A-Za-z]:/.test(t)) {
    return path.normalize(t);
  }
  return path.normalize(path.resolve(process.cwd(), t));
}

export async function fetchResolveRepoForPath(
  projectId: string,
  absolutePath: string,
): Promise<{ repoId: string | null; score: number; match?: string; projectId?: string } | null> {
  const base = getIngestBase();
  if (!base || !absolutePath.trim()) return null;
  const url = `${base}/projects/${encodeURIComponent(projectId)}/resolve-repo-for-path?path=${encodeURIComponent(absolutePath)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return (await res.json()) as { repoId: string | null; score: number; match?: string; projectId?: string };
  } catch {
    return null;
  }
}

/** Sin `projectId` local: prueba cada proyecto Ariadne hasta encontrar un repo que encaje con la ruta. */
export async function findBestProjectRepoForPathFromIngest(
  absolutePath: string,
): Promise<{ projectId: string; repoId: string; score: number } | null> {
  const base = getIngestBase();
  if (!base || !absolutePath.trim()) return null;
  try {
    const projectsRes = await fetch(`${base}/projects`, { signal: AbortSignal.timeout(8000) });
    if (!projectsRes.ok) return null;
    const projects = (await projectsRes.json()) as Array<{ id: string }>;
    let best: { projectId: string; repoId: string; score: number } | null = null;
    for (const p of projects) {
      const r = await fetchResolveRepoForPath(p.id, absolutePath);
      if (!r?.repoId) continue;
      const sc = r.score ?? 0;
      if (!best || sc > best.score) {
        best = { projectId: p.id, repoId: r.repoId, score: sc };
      }
    }
    return best;
  } catch {
    return null;
  }
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Inyecta `scope.repoIds` cuando el IDE apunta a un root concreto del monorepo. */
export async function augmentScopeWithInferredRepo(
  projectId: string,
  currentFilePath: string | undefined,
  scope: Record<string, unknown> | undefined,
): Promise<Record<string, unknown> | undefined> {
  if (!currentFilePath?.trim()) return scope;
  const cfg = loadAriadneProjectConfigNearFile(currentFilePath);
  let repoId = cfg?.defaultRepoId?.trim() || undefined;
  if (!repoId) {
    const abs = toAbsoluteIdePath(currentFilePath);
    const resolved = await fetchResolveRepoForPath(projectId, abs);
    if (resolved?.repoId) repoId = resolved.repoId;
  }
  if (!repoId) return scope;
  const existing = new Set(asStringArray(scope?.repoIds));
  if (existing.has(repoId)) return scope;
  return {
    ...(scope ?? {}),
    repoIds: [...existing, repoId],
  };
}
