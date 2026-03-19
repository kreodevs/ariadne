/**
 * @fileoverview Parsea tsconfig.json/jsconfig.json para resolver path aliases (@/, etc.).
 */

/** baseUrl y mappings paths de compilerOptions. */
export interface TsconfigPaths {
  baseUrl: string;
  paths: Record<string, string[]>;
}

/**
 * Parsea el objeto tsconfig/jsconfig y extrae baseUrl y paths de compilerOptions.
 * @param {unknown} config - Objeto JSON de tsconfig (compilerOptions.baseUrl, compilerOptions.paths).
 * @returns {TsconfigPaths | null} baseUrl y paths, o null si no hay compilerOptions válido.
 */
export function parseTsconfigPaths(config: unknown): TsconfigPaths | null {
  const obj = config && typeof config === 'object' ? (config as Record<string, unknown>) : null;
  if (!obj) return null;

  const compilerOptions = obj.compilerOptions as Record<string, unknown> | undefined;
  if (!compilerOptions || typeof compilerOptions !== 'object') return null;

  const baseUrl = compilerOptions.baseUrl;
  const base = typeof baseUrl === 'string' ? baseUrl.replace(/\/$/, '') || '.' : '.';

  const paths = compilerOptions.paths as Record<string, string[]> | undefined;
  if (!paths || typeof paths !== 'object') return { baseUrl: base, paths: {} };

  return { baseUrl: base, paths };
}

/**
 * Genera candidatos de path para un specifier de import según los mappings de tsconfig (paths con *).
 * @param {string} specifier - Especificador del import (ej. @/utils, lib/foo).
 * @param {TsconfigPaths} tsconfig - baseUrl y paths parseados.
 * @param {string} prefix - Prefijo a anteponer (ej. ruta raíz del repo).
 * @returns {string[]} Lista de rutas candidatas resueltas.
 */
export function resolveWithTsconfig(
  specifier: string,
  tsconfig: TsconfigPaths,
  prefix: string,
): string[] {
  const base = tsconfig.baseUrl.replace(/^\.[/\\]/, '').replace(/\/$/, '');
  const basePrefix = base ? prefix + base + '/' : prefix;
  const candidates: string[] = [];

  for (const [pattern, mappings] of Object.entries(tsconfig.paths)) {
    const wildcard = pattern.indexOf('*');
    if (wildcard < 0) {
      if (specifier === pattern) {
        for (const m of mappings) {
          const resolved = m.replace(/^\.[/\\]/, '');
          candidates.push(basePrefix + resolved);
        }
      }
      continue;
    }
    const prefixPat = pattern.slice(0, wildcard);
    const suffixPat = pattern.slice(wildcard + 1);
    if (
      specifier.startsWith(prefixPat) &&
      (suffixPat === '' || specifier.endsWith(suffixPat))
    ) {
      const segment = specifier.slice(prefixPat.length, specifier.length - suffixPat.length);
      for (const m of mappings) {
        const resolved = m.replace(/\*/g, segment).replace(/^\.[/\\]/, '');
        candidates.push(basePrefix + resolved);
      }
    }
  }
  return candidates;
}
