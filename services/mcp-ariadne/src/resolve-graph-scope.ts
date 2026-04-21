/**
 * Convierte `projectId` MCP (a veces es `repositories.id` / roots[].id) al par
 * (cypherProjectId, repoId?) que usa Falkor en los nodos.
 *
 * En multi-root, `n.projectId` en Falkor es el **proyecto** Ariadne; `n.repoId` es el repo.
 * Si el caller pasa el id del repo, sin esto las consultas con `WHERE n.projectId = $id` dan 0 filas.
 */
export type GraphScope = {
  cypherProjectId: string;
  /** Si el id recibido era un repositorio enlazado a un proyecto, acotar a este repo. */
  repoId?: string;
};

export async function resolveGraphScopeFromProjectOrRepoId(
  ingestBase: string,
  projectOrRepoId: string,
): Promise<GraphScope> {
  const base = ingestBase.replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/repositories/${projectOrRepoId}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const j = (await res.json()) as { id: string; projectIds?: string[] };
      const pids = Array.isArray(j.projectIds) ? j.projectIds : [];
      if (pids.length > 0) {
        return { cypherProjectId: pids[0], repoId: j.id };
      }
      return { cypherProjectId: j.id };
    }
  } catch {
    /* no es un repo o ingest inaccesible */
  }
  return { cypherProjectId: projectOrRepoId };
}

/** Fragmento WHERE para `n` con projectId (+ repoId opcional). */
export function whereProjectRepo(alias: string, withRepo: boolean): string {
  const base = `${alias}.projectId = $projectId`;
  return withRepo ? `${base} AND ${alias}.repoId = $repoId` : base;
}
