/**
 * @fileoverview Resolución del repositorio ancla para `get_modification_plan` en proyectos multi-root.
 */
import type { ChatScope } from './chat-scope.util';
import type { WorkspacePathRepoResolution } from '../projects/path-repo-resolution.util';

/** Diagnóstico cuando no se puede anclar o no hay archivos candidatos. */
export interface ModificationPlanDiagnostic {
  code: string;
  message: string;
  candidates?: Array<{ repositoryId: string; label?: string }>;
}

export type ResolveModificationPlanRepoResult =
  | { ok: true; repositoryId: string }
  | { ok: false; diagnostic: ModificationPlanDiagnostic };

export type ModificationPlanRepoInput = {
  id: string;
  projectKey: string;
  repoSlug: string;
  role?: string | null;
};

function repoLabel(r: ModificationPlanRepoInput): string {
  const base = `${r.projectKey}/${r.repoSlug}`;
  return r.role?.trim() ? `${r.role.trim()} (${base})` : base;
}

/**
 * Elige el `repositoryId` sobre el que corre el plan cuando el segmento de URL es un proyecto (multi-root).
 */
export async function resolveRepositoryIdForModificationPlan(
  projectId: string,
  repos: ModificationPlanRepoInput[],
  options: {
    scope?: ChatScope;
    currentFilePath?: string | null;
    resolveWorkspacePath?: (projectId: string, path: string) => Promise<WorkspacePathRepoResolution>;
  },
): Promise<ResolveModificationPlanRepoResult> {
  const idSet = new Set(repos.map((r) => r.id));
  const candidates = repos.map((r) => ({ repositoryId: r.id, label: repoLabel(r) }));

  if (repos.length === 0) {
    return {
      ok: false,
      diagnostic: {
        code: 'NO_REPOSITORIES',
        message: 'El proyecto no tiene repositorios vinculados.',
        candidates: [],
      },
    };
  }

  if (repos.length === 1) {
    const only = repos[0]!;
    const ids = options.scope?.repoIds?.filter(Boolean) ?? [];
    if (ids.length > 0 && !ids.includes(only.id)) {
      return {
        ok: false,
        diagnostic: {
          code: 'SCOPE_REPO_MISMATCH',
          message: 'scope.repoIds no coincide con el único repositorio del proyecto.',
          candidates,
        },
      };
    }
    return { ok: true, repositoryId: only.id };
  }

  const repoIds = options.scope?.repoIds?.filter(Boolean) ?? [];
  if (repoIds.length > 1) {
    return {
      ok: false,
      diagnostic: {
        code: 'AMBIGUOUS_REPO_SCOPE',
        message:
          'Varios ids en scope.repoIds: pasa exactamente un uuid en scope.repoIds, o currentFilePath resoluble.',
        candidates: candidates.filter((c) => repoIds.includes(c.repositoryId)),
      },
    };
  }

  if (repoIds.length === 1) {
    const id = repoIds[0]!;
    if (!idSet.has(id)) {
      return {
        ok: false,
        diagnostic: {
          code: 'INVALID_REPO_SCOPE',
          message: 'scope.repoIds no pertenece a este proyecto.',
          candidates,
        },
      };
    }
    return { ok: true, repositoryId: id };
  }

  const p = options.currentFilePath?.trim();
  if (p && options.resolveWorkspacePath) {
    const res = await options.resolveWorkspacePath(projectId, p);
    if (res.kind === 'unique' && idSet.has(res.repositoryId)) {
      return { ok: true, repositoryId: res.repositoryId };
    }
    if (res.kind === 'ambiguous') {
      return {
        ok: false,
        diagnostic: {
          code: 'AMBIGUOUS_PATH',
          message:
            'currentFilePath coincide con varios repositorios; acota con un solo scope.repoIds (roots[].id).',
          candidates: res.candidates.map((c) => ({ repositoryId: c.repositoryId, label: c.label })),
        },
      };
    }
  }

  const legacy = process.env.MODIFICATION_PLAN_LEGACY_FIRST_REPO?.trim().toLowerCase();
  if (legacy === '1' || legacy === 'true' || legacy === 'yes') {
    return { ok: true, repositoryId: repos[0]!.id };
  }

  return {
    ok: false,
    diagnostic: {
      code: 'AMBIGUOUS_SCOPE',
      message:
        'Varios repositorios: pasa projectId = roots[].id del repo objetivo, o scope.repoIds con un uuid, o currentFilePath absoluto bajo el clone. Opcional: MODIFICATION_PLAN_LEGACY_FIRST_REPO=true para el comportamiento anterior (primer repo por createdAt DESC).',
      candidates,
    },
  };
}
