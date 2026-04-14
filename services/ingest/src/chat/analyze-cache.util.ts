/**
 * Caché de resultados de `analyze`: clave por repo, modo, scope, commit e huella de `indexed_files`
 * (incl. `content_hash` cuando existe). Con scope activo, huella partida foco interior / exterior.
 */

import { createHash } from 'node:crypto';
import { normalizePathKey, type ChatScope } from './chat-scope.util';
import { isAnalyzeScopeActive, pathInAnalyzeFocus, type FanInStats } from './analyze-focus.util';

/** Máximo de filas `indexed_files` para huella completa. Override: `ANALYZE_CACHE_FULL_FINGERPRINT_MAX_ROWS`. */
export function analyzeCacheFullFingerprintMaxRows(): number {
  const raw = process.env.ANALYZE_CACHE_FULL_FINGERPRINT_MAX_ROWS?.trim();
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 1000 ? Math.min(n, 500_000) : 30_000;
}

export type IndexRowForFingerprint = {
  path: string;
  revision: string | null;
  indexedAt: Date;
  contentHash?: string | null;
};

/** Serialización estable del scope para la clave de caché. */
export function stableScopeKeyForCache(scope?: ChatScope): string {
  if (!scope) return '';
  return JSON.stringify({
    repoIds: scope.repoIds?.length ? [...scope.repoIds].sort() : [],
    includePathPrefixes: scope.includePathPrefixes?.length
      ? [...scope.includePathPrefixes].map((p) => normalizePathKey(p)).sort()
      : [],
    excludePathGlobs: scope.excludePathGlobs?.length ? [...scope.excludePathGlobs].sort() : [],
  });
}

/** Huella SHA-256 (prefijo 32 hex) del estado indexado. Incluye `content_hash` si existe (sync reciente). */
export function hashFullIndexState(rows: IndexRowForFingerprint[]): string {
  const sorted = [...rows].sort((a, b) => a.path.localeCompare(b.path));
  const payload = sorted
    .map((r) => `${r.path}\0${r.revision ?? ''}\0${r.indexedAt.getTime()}\0${r.contentHash ?? ''}`)
    .join('\n');
  return createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 32);
}

/** Huella degradada cuando hay demasiadas filas. */
export function hashDegradedIndexState(params: {
  rowCount: number;
  lastCommitSha: string | null;
  maxIndexedAt: Date | null;
  minIndexedAt: Date | null;
}): string {
  const s = `d:${params.rowCount}|${params.lastCommitSha ?? ''}|${params.maxIndexedAt?.getTime() ?? 0}|${params.minIndexedAt?.getTime() ?? 0}`;
  return createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 32);
}

/** Parte filas en dentro/fuera del foco (huella partida con scope activo). */
export function partitionIndexRowsByScope(
  rows: IndexRowForFingerprint[],
  scope: ChatScope | undefined,
  repositoryId: string,
): { inside: IndexRowForFingerprint[]; outside: IndexRowForFingerprint[] } {
  if (!isAnalyzeScopeActive(scope)) {
    return { inside: rows, outside: [] };
  }
  const inside: IndexRowForFingerprint[] = [];
  const outside: IndexRowForFingerprint[] = [];
  for (const r of rows) {
    if (pathInAnalyzeFocus(r.path, scope, repositoryId)) inside.push(r);
    else outside.push(r);
  }
  return { inside, outside };
}

/** Sin scope = hash de todo; con scope = `hash(dentro)|hash(fuera)`. */
export function buildPartitionedIndexFingerprint(
  rows: IndexRowForFingerprint[],
  scope: ChatScope | undefined,
  repositoryId: string,
): { fingerprint: string; scopePartitioned: boolean } {
  if (!isAnalyzeScopeActive(scope)) {
    return { fingerprint: hashFullIndexState(rows), scopePartitioned: false };
  }
  const { inside, outside } = partitionIndexRowsByScope(rows, scope, repositoryId);
  return {
    fingerprint: `${hashFullIndexState(inside)}|${hashFullIndexState(outside)}`,
    scopePartitioned: true,
  };
}

export function buildAnalyzeCacheKey(parts: {
  repositoryId: string;
  mode: string;
  scopeKey: string;
  crossPackageDuplicates: boolean;
  lastCommitSha: string | null;
  indexFingerprint: string;
}): string {
  return [
    'v2',
    parts.repositoryId,
    parts.mode,
    parts.scopeKey,
    parts.crossPackageDuplicates ? 'x1' : 'x0',
    parts.lastCommitSha ?? 'null',
    parts.indexFingerprint,
  ].join('|');
}

export function analyzeCacheDisabledFromEnv(): boolean {
  const v = process.env.ANALYZE_CACHE_DISABLED?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function analyzeCacheTtlMs(): number {
  const raw = process.env.ANALYZE_CACHE_TTL_MS?.trim();
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 5 * 60 * 1000;
}

export function analyzeCacheMaxEntries(): number {
  const raw = process.env.ANALYZE_CACHE_MAX_ENTRIES?.trim();
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 500) : 80;
}

export function analyzeCacheRedisTtlSec(): number {
  return Math.max(60, Math.ceil(analyzeCacheTtlMs() / 1000));
}

/** Clave LRU + Redis para capa extrínseca CALL en diagnóstico con scope. */
export function buildDiagnosticoExtrinsicLayerCacheKey(parts: {
  repositoryId: string;
  scopeKey: string;
  indexFingerprint: string;
  edgeLimit: number;
}): string {
  return [
    'diag-ext-calls',
    parts.repositoryId,
    parts.scopeKey,
    parts.indexFingerprint,
    String(parts.edgeLimit),
  ].join('|');
}

export function extrinsicLayerCacheDisabledFromEnv(): boolean {
  const v = process.env.ANALYZE_EXTRINSIC_LAYER_CACHE_DISABLED?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function extrinsicLayerCacheTtlMs(): number {
  const raw = process.env.ANALYZE_EXTRINSIC_LAYER_CACHE_TTL_MS?.trim();
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : analyzeCacheTtlMs();
}

export function extrinsicLayerCacheMaxEntries(): number {
  const raw = process.env.ANALYZE_EXTRINSIC_LAYER_CACHE_MAX_ENTRIES?.trim();
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 40;
}

export function extrinsicLayerCacheRedisTtlSec(): number {
  return Math.max(60, Math.ceil(extrinsicLayerCacheTtlMs() / 1000));
}

export function extrinsicLayerRedisDisabledFromEnv(): boolean {
  const v = process.env.ANALYZE_EXTRINSIC_LAYER_REDIS_DISABLED?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Payload serializable de la capa extrínseca CALL (antes de fusionar en `riskRanked`). */
export type DiagnosticoExtrinsicLayerPayload = {
  fanInEntries: [string, FanInStats][];
  outCallsOutsideEntries: [string, number][];
  callEdgesTruncated: boolean;
};
