/**
 * Inferencia determinista de `repoId` para chat multi-repo a partir del mensaje
 * y del rol en `project_repositories.role` (sin LLM).
 */

export type RepoScopeBucket = 'frontend' | 'backend' | 'library';

export interface ProjectRepoRoleCandidate {
  repoId: string;
  role: string | null;
  /** Etiqueta humana (p. ej. `org/slug`). */
  label: string;
}

export type ResolveChatRepoScopeResult =
  | { kind: 'unique'; repoId: string }
  | { kind: 'none' }
  | {
      kind: 'ambiguous';
      reason: 'multi_bucket' | 'multi_repo_same_bucket' | 'substring_role';
      matchedRepoIds: string[];
    };

/** Normaliza para comparación insensible a mayúsculas / acentos. */
export function normalizeMatchText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Activo salvo `CHAT_INFER_SCOPE_FROM_ROLES=0|false|no|off`. */
export function isChatRoleScopeInferenceEnabled(): boolean {
  const v = process.env.CHAT_INFER_SCOPE_FROM_ROLES?.trim().toLowerCase();
  if (!v) return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return true;
}

function classifyRoleToBucket(role: string | null): RepoScopeBucket | null {
  const r = normalizeMatchText(role ?? '');
  if (!r) return null;
  if (
    /\b(librer|storybook|design system|ui kit|kit de componentes)\b/.test(r) ||
    (r.includes('librer') && r.includes('component')) ||
    (r.includes('librer') && r.includes('compon'))
  ) {
    return 'library';
  }
  if (
    /\b(strapi|nestjs|nest js|express|microservicio|servidor|server|backend|erp)\b/.test(r) ||
    (r.includes('back') && !r.includes('front')) ||
    /\bapi\b/.test(r)
  ) {
    return 'backend';
  }
  if (
    /\b(front|react|vite|angular|vue|nextjs|next js|spa|mobile|pwa)\b/.test(r) ||
    r.includes('front end') ||
    r.includes('frontend') ||
    (r.includes('web') && !r.includes('webpack')) ||
    r.includes('cliente') ||
    r.includes('interfaz')
  ) {
    return 'frontend';
  }
  return null;
}

function messageBuckets(rawMessage: string): Set<RepoScopeBucket> {
  const m = normalizeMatchText(rawMessage);
  const out = new Set<RepoScopeBucket>();

  const frontendHints =
    /\b(frontend|front end)\b/.test(m) ||
    /\b(en|del|al|la|el)\s+front\b/.test(m) ||
    m.includes('interfaz de usuario') ||
    m.includes('interfaz grafica') ||
    m.includes('lado del cliente') ||
    /\b(ui|ux)\b/.test(m) ||
    m.includes('aplicacion web') ||
    /\bcliente\b/.test(m);

  const backendHints =
    /\bbackend\b/.test(m) ||
    m.includes('lado del servidor') ||
    /\b(strapi|nestjs|nest js|express)\b/.test(m) ||
    m.includes('api rest') ||
    /\b(servidor|microservicio|erp)\b/.test(m);

  const libraryHints =
    m.includes('libreria') ||
    m.includes('storybook') ||
    m.includes('design system') ||
    m.includes('componentes compartidos') ||
    m.includes('componentes reutiliz');

  if (libraryHints) out.add('library');
  if (frontendHints) out.add('frontend');
  if (backendHints) out.add('backend');
  return out;
}

function substringRoleMatches(message: string, candidates: ProjectRepoRoleCandidate[]): string[] {
  const msg = normalizeMatchText(message);
  const hits: string[] = [];
  for (const c of candidates) {
    const role = (c.role ?? '').trim();
    if (role.length < 4) continue;
    const rn = normalizeMatchText(role);
    if (rn.length < 4) continue;
    if (msg.includes(rn)) hits.push(c.repoId);
  }
  return hits;
}

/**
 * Intenta elegir un único `repoId` cuando el mensaje y los roles del proyecto lo permiten.
 */
export function inferChatRepoScopeFromMessage(
  message: string,
  candidates: ProjectRepoRoleCandidate[],
): ResolveChatRepoScopeResult {
  if (!message?.trim() || candidates.length === 0) return { kind: 'none' };

  const buckets = messageBuckets(message);
  if (buckets.size > 1) {
    return {
      kind: 'ambiguous',
      reason: 'multi_bucket',
      matchedRepoIds: [],
    };
  }

  if (buckets.size === 1) {
    const b = [...buckets][0]!;
    const inBucket = candidates.filter((c) => classifyRoleToBucket(c.role) === b);
    if (inBucket.length === 1) return { kind: 'unique', repoId: inBucket[0]!.repoId };
    if (inBucket.length > 1) {
      return {
        kind: 'ambiguous',
        reason: 'multi_repo_same_bucket',
        matchedRepoIds: inBucket.map((c) => c.repoId),
      };
    }
    const sub = substringRoleMatches(message, candidates);
    if (sub.length === 1) return { kind: 'unique', repoId: sub[0]! };
    if (sub.length > 1) {
      return { kind: 'ambiguous', reason: 'substring_role', matchedRepoIds: sub };
    }
    return { kind: 'none' };
  }

  const subOnly = substringRoleMatches(message, candidates);
  if (subOnly.length === 1) return { kind: 'unique', repoId: subOnly[0]! };
  if (subOnly.length > 1) {
    return { kind: 'ambiguous', reason: 'substring_role', matchedRepoIds: subOnly };
  }

  return { kind: 'none' };
}
