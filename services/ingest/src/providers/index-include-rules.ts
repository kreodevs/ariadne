/**
 * Alcance de indexado por repositorio: prefijos de carpeta y/o archivos explícitos.
 * Con reglas activas siempre entran `package.json` en raíz y el resto de `*.json`, `*.js`, `*.ts`,
 * `*.jsx`, `*.tsx` en la raíz del repo (sin dotfiles salvo que coincidan el patrón no-dot).
 * `null` en BD = indexar como hasta ahora (todo el repo que pase `shouldSyncIndexPath`).
 */

import * as fs from 'fs';
import * as path from 'path';
import { shouldSyncIndexPath, pathHasGlobalSkipSegment } from './sync-path-filter';

export type IndexIncludeEntry =
  | { kind: 'path_prefix'; path: string }
  | { kind: 'file'; path: string };

export type IndexIncludeRules = { entries: IndexIncludeEntry[] };

const MAX_ENTRIES = 80;

export function normalizeIndexPath(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '')
    .trim();
}

function isValidPathToken(p: string): boolean {
  if (!p || p.startsWith('/') || p.includes('..')) return false;
  return true;
}

/**
 * Normaliza reglas desde API/JSON. `null` = sin reglas (indexado global).
 * Entradas inválidas se omiten.
 */
export function parseIndexIncludeRulesFromDto(raw: unknown): IndexIncludeRules | null {
  if (raw === undefined) return null;
  if (raw === null) return null;
  if (typeof raw !== 'object' || raw === null) return null;
  const entriesRaw = (raw as { entries?: unknown }).entries;
  if (!Array.isArray(entriesRaw)) return null;
  const entries: IndexIncludeEntry[] = [];
  for (const item of entriesRaw) {
    if (entries.length >= MAX_ENTRIES) break;
    if (!item || typeof item !== 'object') continue;
    const kind = (item as { kind?: unknown }).kind;
    const pathRaw = normalizeIndexPath(String((item as { path?: unknown }).path ?? ''));
    if (!pathRaw || !isValidPathToken(pathRaw)) continue;
    if (kind === 'file') entries.push({ kind: 'file', path: pathRaw });
    else if (kind === 'path_prefix') entries.push({ kind: 'path_prefix', path: pathRaw });
  }
  return { entries };
}

/** Raíz del repo: un solo segmento, sin dotfile inicial, extensiones de manifiesto/código en raíz. */
export function isMandatoryDefaultRootIndexPath(relPath: string): boolean {
  const norm = normalizeIndexPath(relPath);
  if (norm.includes('/')) return false;
  if (norm.startsWith('.')) return false;
  const lower = norm.toLowerCase();
  if (lower === 'package.json') return true;
  return /\.(json|js|ts|jsx|tsx)$/i.test(norm);
}

function matchesPathPrefix(normPath: string, prefixRaw: string): boolean {
  const prefix = normalizeIndexPath(prefixRaw);
  if (!prefix) return false;
  return normPath === prefix || normPath.startsWith(`${prefix}/`);
}

/**
 * Con reglas activas: mandatory root, archivos `file` (salvo segmentos prohibidos), o bajo `path_prefix`
 * pasando el filtro global `shouldSyncIndexPath`.
 * `entries.length === 0` → solo mandatory root.
 */
export function shouldIndexPathWithRepoRules(
  relPath: string,
  rules: IndexIncludeRules | null | undefined,
): boolean {
  const norm = normalizeIndexPath(relPath);
  if (rules == null) return shouldSyncIndexPath(relPath);
  if (pathHasGlobalSkipSegment(norm)) return false;
  if (isMandatoryDefaultRootIndexPath(norm)) return true;
  if (rules.entries.length === 0) return false;
  for (const e of rules.entries) {
    if (e.kind === 'file' && normalizeIndexPath(e.path) === norm) return true;
  }
  if (!shouldSyncIndexPath(relPath)) return false;
  for (const e of rules.entries) {
    if (e.kind === 'path_prefix' && matchesPathPrefix(norm, e.path)) return true;
  }
  return false;
}

export function filterPathsByRepoIndexRules(
  paths: string[],
  rules: IndexIncludeRules | null | undefined,
): string[] {
  if (rules == null) return paths;
  return paths.filter((p) => shouldIndexPathWithRepoRules(p, rules));
}

/** Tras walk del clone: añade mandatory root y archivos `file` que existan en disco, y filtra por reglas. */
export function augmentClonePathsForIndexRules(
  workDir: string,
  paths: string[],
  rules: IndexIncludeRules,
): string[] {
  const set = new Set(paths.map((p) => normalizeIndexPath(p)));
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(workDir, { withFileTypes: true });
  } catch {
    return filterPathsByRepoIndexRules([...set], rules);
  }
  for (const d of dirents) {
    if (!d.isFile()) continue;
    const name = d.name.replace(/\\/g, '/');
    if (isMandatoryDefaultRootIndexPath(name)) set.add(name);
  }
  for (const e of rules.entries) {
    if (e.kind !== 'file') continue;
    const rel = normalizeIndexPath(e.path);
    if (!rel || pathHasGlobalSkipSegment(rel)) continue;
    const full = path.join(workDir, rel);
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) set.add(rel);
    } catch {
      /* ignore */
    }
  }
  return filterPathsByRepoIndexRules([...set], rules);
}
