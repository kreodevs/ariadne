/**
 * @fileoverview Resolución de paths de imports: tsconfig/jsconfig con merge de `extends` vía TypeScript API.
 */

import * as ts from 'typescript';
import * as path from 'path';

/** baseUrl (directorio base repo-relative, posix) y mappings paths de compilerOptions ya mergeados. */
export interface TsconfigPaths {
  baseUrl: string;
  paths: Record<string, string[]>;
}

const VIRTUAL = '/__ariadne_repo__';

function normalizeRepoKey(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/+/, '');
}

function posixDirname(p: string): string {
  const n = normalizeRepoKey(p);
  const i = n.lastIndexOf('/');
  if (i <= 0) return '';
  return n.slice(0, i);
}

/** Resuelve `extends` relativo al directorio del tsconfig o bajo node_modules. */
export function resolveExtendsTarget(configFileRel: string, extendsValue: string): string {
  const dir = posixDirname(configFileRel);
  const ext = extendsValue.trim();
  if (!ext) return '';
  if (ext.startsWith('.') || ext.startsWith('/')) {
    const joined = dir ? `${dir}/${ext}` : ext;
    return normalizeRepoKey(path.posix.normalize(joined));
  }
  const joined = dir ? `${dir}/node_modules/${ext}` : `node_modules/${ext}`;
  return normalizeRepoKey(path.posix.normalize(joined));
}

/**
 * Recorre la cadena de `extends` y lee cada tsconfig/jsconfig presente en el repo.
 */
export async function collectTsconfigChainFiles(
  readRepo: (rel: string) => Promise<string | null>,
  entryRel: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const queue: string[] = [normalizeRepoKey(entryRel)];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const p = queue.shift()!;
    if (seen.has(p)) continue;
    seen.add(p);
    const text = await readRepo(p);
    if (text == null) continue;
    map.set(p, text);

    let root: { extends?: string | string[] };
    try {
      root = JSON.parse(text) as { extends?: string | string[] };
    } catch {
      continue;
    }
    const raw = root.extends;
    const list = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
    for (const ext of list) {
      if (typeof ext !== 'string') continue;
      const next = resolveExtendsTarget(p, ext);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return map;
}

function virtualConfigPath(configRel: string): string {
  return `${VIRTUAL}/${normalizeRepoKey(configRel)}`;
}

function virtualToRel(absPath: string): string {
  const n = absPath.replace(/\\/g, '/');
  const prefix = `${VIRTUAL}/`;
  if (n.startsWith(prefix)) return n.slice(prefix.length);
  return normalizeRepoKey(n);
}

/**
 * Usa typescript.parseJsonConfigFileContent para aplicar `extends` y paths con baseUrl absoluto interno coherente.
 */
export function parseTsconfigPathsWithCompiler(
  configRelPath: string,
  files: Map<string, string>,
): TsconfigPaths | null {
  const rel = normalizeRepoKey(configRelPath);
  const text = files.get(rel);
  if (!text) return null;

  const configAbs = virtualConfigPath(rel);
  const containingDir = path.posix.dirname(configAbs);

  const host: ts.ParseConfigHost = {
    useCaseSensitiveFileNames: true,
    fileExists(name): boolean {
      const r = virtualToRel(name);
      return files.has(r);
    },
    readFile(name): string | undefined {
      const r = virtualToRel(name);
      return files.get(r);
    },
    readDirectory(): string[] {
      return [];
    },
  };

  const parsedRaw = ts.parseJsonText(configAbs, text);
  const parsed = ts.parseJsonConfigFileContent(
    parsedRaw,
    host,
    containingDir,
    undefined,
    configAbs,
  );

  const co = parsed.options;
  const pathsMap = (co.paths as Record<string, string[]> | undefined) ?? {};

  let baseRel = '';
  if (co.baseUrl != null && co.baseUrl !== '') {
    baseRel = virtualToRel(String(co.baseUrl).replace(/\\/g, '/'));
  } else {
    baseRel = posixDirname(rel);
  }
  if (baseRel === '.' || baseRel === './') baseRel = '';

  if (parsed.errors.length > 0 && Object.keys(pathsMap).length === 0 && !co.baseUrl) {
    return parseTsconfigPaths(JSON.parse(text) as unknown);
  }

  return { baseUrl: baseRel, paths: pathsMap };
}

/**
 * Parsea el objeto tsconfig/jsconfig sin `extends` (legacy).
 */
export function parseTsconfigPaths(config: unknown): TsconfigPaths | null {
  const obj = config && typeof config === 'object' ? (config as Record<string, unknown>) : null;
  if (!obj) return null;

  const compilerOptions = obj.compilerOptions as Record<string, unknown> | undefined;
  if (!compilerOptions || typeof compilerOptions !== 'object') return null;

  const baseUrl = compilerOptions.baseUrl;
  let base =
    typeof baseUrl === 'string' ? baseUrl.replace(/\/$/, '').replace(/^\.\//, '') : '';
  if (base === '.') base = '';

  const paths = compilerOptions.paths as Record<string, string[]> | undefined;
  if (!paths || typeof paths !== 'object') return { baseUrl: base, paths: {} };

  return { baseUrl: base, paths };
}

/**
 * Carga tsconfig/jsconfig del repo con resolución de extends (Bitbucket/GitHub/clone).
 */
export async function loadRepoTsconfigPaths(
  readRepo: (rel: string) => Promise<string | null>,
): Promise<TsconfigPaths | null> {
  for (const entry of ['tsconfig.json', 'jsconfig.json']) {
    const ok = await readRepo(entry);
    if (!ok) continue;
    const chain = await collectTsconfigChainFiles(readRepo, entry);
    if (chain.size === 0) continue;
    const merged = parseTsconfigPathsWithCompiler(entry, chain);
    if (merged) return merged;
  }
  return null;
}

/**
 * Mapa virtual desde lista de archivos (p. ej. shadow); paths posix relativos al root lógico.
 */
export function loadTsconfigPathsFromShadowFiles(
  files: Array<{ path: string; content: string }>,
): TsconfigPaths | null {
  const map = new Map<string, string>();
  for (const f of files) {
    map.set(normalizeRepoKey(f.path), f.content);
  }
  for (const entry of ['tsconfig.json', 'jsconfig.json']) {
    if (!map.has(entry)) continue;
    const chain = new Map<string, string>();
    const queue: string[] = [entry];
    const seen = new Set<string>();
    while (queue.length) {
      const p = queue.shift()!;
      if (seen.has(p)) continue;
      seen.add(p);
      const t = map.get(p);
      if (t == null) continue;
      chain.set(p, t);
      let root: { extends?: string | string[] };
      try {
        root = JSON.parse(t) as { extends?: string | string[] };
      } catch {
        continue;
      }
      const raw = root.extends;
      const list = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
      for (const ext of list) {
        if (typeof ext !== 'string') continue;
        const next = resolveExtendsTarget(p, ext);
        if (next && map.has(next) && !seen.has(next)) queue.push(next);
      }
    }
    if (chain.size === 0) continue;
    const merged = parseTsconfigPathsWithCompiler(entry, chain);
    if (merged) return merged;
  }
  return null;
}

/**
 * Genera candidatos de path para un specifier de import según los mappings de tsconfig (paths con *).
 * @param prefix - Prefijo del repo (ej. "repo-slug/") para paths resueltos; vacío en sync si paths son root-relative.
 */
export function resolveWithTsconfig(
  specifier: string,
  tsconfig: TsconfigPaths,
  prefix: string,
): string[] {
  const baseRaw = tsconfig.baseUrl.replace(/^\.[/\\]/, '').replace(/\/$/, '');
  const basePrefix = baseRaw ? prefix + baseRaw + '/' : prefix;
  const candidates: string[] = [];

  for (const [pattern, mappings] of Object.entries(tsconfig.paths)) {
    const wildcard = pattern.indexOf('*');
    if (wildcard < 0) {
      if (specifier === pattern) {
        for (const m of mappings) {
          const resolved = m.replace(/^\.[/\\]/, '').replace(/^\//, '');
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
        const resolved = m.replace(/\*/g, segment).replace(/^\.[/\\]/, '').replace(/^\//, '');
        candidates.push(basePrefix + resolved);
      }
    }
  }
  return candidates;
}
