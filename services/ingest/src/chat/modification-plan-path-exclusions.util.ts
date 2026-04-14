/**
 * Exclusiones de rutas para `get_modification_plan` (ruido .cursor/, node_modules, etc.).
 */

import { normalizePathKey } from './chat-scope.util';

function defaultExcludesDisabled(): boolean {
  const v = process.env.MODIFICATION_PLAN_DEFAULT_EXCLUDE_DISABLED?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function extraExcludeSubstrings(): string[] {
  const raw = process.env.MODIFICATION_PLAN_EXTRA_EXCLUDE_SUBSTRINGS?.trim();
  if (!raw) return [];
  return raw
    .split(/[,;\n]+/)
    .map((s) => normalizePathKey(s.trim()))
    .filter((s) => s.length > 0);
}

/** true si el path no debe entrar en candidatos del plan. */
export function modificationPlanPathExcludedByDefaults(path: string): boolean {
  if (!path?.trim()) return true;
  if (defaultExcludesDisabled()) {
    return extraExcludeSubstrings().some((sub) => path.includes(sub));
  }
  const p = normalizePathKey(path);
  if (p.includes('/.cursor/') || p.startsWith('.cursor/')) return true;
  if (p.includes('/node_modules/') || p.startsWith('node_modules/')) return true;
  if (p.includes('/.git/') || p.endsWith('/.git') || p === '.git') return true;
  if (extraExcludeSubstrings().some((sub) => p.includes(sub) || path.includes(sub))) return true;
  return false;
}
