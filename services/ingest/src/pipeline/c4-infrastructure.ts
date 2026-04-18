/**
 * @fileoverview Escaneo heurístico de infra (docker-compose, k8s, workspaces) para nodos C4 (:System, :Container).
 * Sin dependencia YAML: parser ligero suficiente para servicios y contextos de build habituales.
 */

export type C4ContainerKind = 'software' | 'database' | 'external';

export interface C4ContainerSpec {
  /** Clave estable (slug) para MERGE en Falkor */
  key: string;
  /** Etiqueta humana */
  name: string;
  /** Prefijos de ruta relativa al repo (p. ej. `services/api/`); el más largo gana al asignar archivos */
  pathPrefixes: string[];
  technology?: string;
  c4Kind: C4ContainerKind;
}

export interface C4InfrastructureSpec {
  /** Nombre del sistema software (p. ej. org/repo) */
  systemName: string;
  containers: C4ContainerSpec[];
}

const COMPOSE_NAMES = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
];

function slugKey(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s.length ? s.slice(0, 64) : 'svc';
}

function normPrefix(p: string): string {
  const t = p.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '');
  return t ? `${t}/` : '';
}

function inferKindFromImage(image: string): C4ContainerKind {
  const i = image.toLowerCase();
  if (
    /postgres|mysql|mariadb|mongo|redis|cassandra|elasticsearch|clickhouse|timescale|falkor/i.test(
      i,
    )
  ) {
    return 'database';
  }
  return 'software';
}

/**
 * Extrae bloques `services:` de compose (subset YAML) — indentación con espacios.
 */
function parseDockerComposeServices(content: string): Array<{
  name: string;
  buildPrefix?: string;
  image?: string;
}> {
  const lines = content.split(/\r?\n/);
  let i = 0;
  const out: Array<{ name: string; buildPrefix?: string; image?: string }> = [];
  while (i < lines.length) {
    const line = lines[i]!;
    if (/^services:\s*$/i.test(line.trim())) {
      i++;
      break;
    }
    i++;
  }
  const baseIndent = 2;
  while (i < lines.length) {
    const raw = lines[i]!;
    const m = /^(\s*)([^\s#][^:]*):\s*$/.exec(raw);
    if (!m) {
      if (raw.trim() && !raw.startsWith(' ') && !raw.startsWith('\t')) break;
      i++;
      continue;
    }
    const indent = m[1]!.length;
    if (indent < baseIndent) break;
    const svcName = m[2]!.trim();
    if (!svcName || svcName === 'build' || svcName === 'image') {
      i++;
      continue;
    }
    let buildPrefix: string | undefined;
    let image: string | undefined;
    i++;
    const svcIndent = indent;
    while (i < lines.length) {
      const L = lines[i]!;
      const ind = L.match(/^(\s*)/)?.[1]?.length ?? 0;
      if (L.trim() === '' || L.trim().startsWith('#')) {
        i++;
        continue;
      }
      if (ind <= svcIndent && L.trim()) break;
      const buildLine = /^\s*build:\s*(.+)\s*$/.exec(L);
      if (buildLine) {
        const rest = buildLine[1]!.trim();
        if (rest.startsWith('{')) {
          const ctx = /context:\s*["']?([^"'\s}]+)/i.exec(rest);
          if (ctx) buildPrefix = normPrefix(ctx[1]!);
        } else if (rest !== '') {
          buildPrefix = normPrefix(rest.replace(/["']/g, ''));
        }
      }
      const ctxLine = /^\s*context:\s*["']?([^"'\s#]+)/i.exec(L);
      if (ctxLine && !buildPrefix) buildPrefix = normPrefix(ctxLine[1]!);
      const imgLine = /^\s*image:\s*["']?([^\s#]+)/i.exec(L);
      if (imgLine) image = imgLine[1]!.trim();
      i++;
    }
    out.push({ name: svcName, buildPrefix, image });
  }
  return out;
}

async function parseKubernetesDeployments(
  paths: string[],
  getContent: (p: string) => Promise<string | null>,
): Promise<Array<{ name: string; pathPrefixes: string[] }>> {
  const out: Array<{ name: string; pathPrefixes: string[] }> = [];
  const k8sPaths = paths.filter(
    (p) =>
      /^(kubernetes|k8s|charts)\//i.test(p) || /\/(kubernetes|k8s)\//i.test(p),
  );
  const yamlFiles = k8sPaths.filter((p) => /\.ya?ml$/i.test(p));
  for (const p of yamlFiles.slice(0, 80)) {
    const c = await getContent(p);
    if (!c) continue;
    if (!/kind:\s*Deployment/i.test(c)) continue;
    const nameM = /metadata:\s*\n\s*name:\s*([^\s#]+)/i.exec(c);
    const name = nameM?.[1]?.trim();
    if (!name) continue;
    const dir = p.split('/').slice(0, -1).join('/');
    const prefix = dir ? normPrefix(dir) : '';
    out.push({ name, pathPrefixes: prefix ? [prefix] : [] });
  }
  return out;
}

async function parsePackageJsonWorkspaces(
  getContent: (p: string) => Promise<string | null>,
  paths: Set<string>,
): Promise<C4ContainerSpec[]> {
  const raw = await getContent('package.json');
  if (!raw) return [];
  let pkg: { workspaces?: unknown };
  try {
    pkg = JSON.parse(raw) as { workspaces?: unknown };
  } catch {
    return [];
  }
  const ws = pkg.workspaces;
  if (!ws) return [];
  const patterns: string[] = Array.isArray(ws)
    ? (ws as string[])
    : typeof ws === 'object' && ws !== null && Array.isArray((ws as { packages?: string[] }).packages)
      ? (ws as { packages: string[] }).packages
      : [];
  const out: C4ContainerSpec[] = [];
  for (const pat of patterns) {
    if (typeof pat !== 'string') continue;
    const star = pat.indexOf('*');
    if (star === -1) {
      if (paths.has(pat) || paths.has(`${pat}/package.json`)) {
        const key = slugKey(pat.split('/').filter(Boolean).pop() ?? pat);
        out.push({
          key,
          name: pat,
          pathPrefixes: [normPrefix(pat)],
          technology: 'node',
          c4Kind: 'software',
        });
      }
      continue;
    }
    const base = pat.slice(0, star).replace(/\/+$/, '');
    if (!base) continue;
    const seen = new Set<string>();
    for (const p of paths) {
      if (!p.startsWith(`${base}/`) || !p.includes('/')) continue;
      const rest = p.slice(base.length + 1);
      const first = rest.split('/')[0];
      if (!first) continue;
      const root = `${base}/${first}`;
      if (seen.has(root)) continue;
      seen.add(root);
      out.push({
        key: slugKey(first),
        name: first,
        pathPrefixes: [normPrefix(root)],
        technology: 'node',
        c4Kind: 'software',
      });
    }
  }
  return out;
}

/**
 * Escanea la raíz del repo vía `pathSet` + `getContent` y devuelve especificación C4.
 */
export async function scanC4Infrastructure(
  pathSet: Set<string>,
  getContent: (p: string) => Promise<string | null>,
  systemName: string,
): Promise<C4InfrastructureSpec> {
  const paths = [...pathSet];
  const containers: C4ContainerSpec[] = [];
  const seenKeys = new Set<string>();

  const add = (c: C4ContainerSpec) => {
    let k = c.key;
    let n = 2;
    while (seenKeys.has(k)) {
      k = `${c.key}_${n++}`;
    }
    seenKeys.add(k);
    containers.push({ ...c, key: k });
  };

  let composePath: string | null = null;
  for (const n of COMPOSE_NAMES) {
    if (pathSet.has(n)) {
      composePath = n;
      break;
    }
  }
  if (composePath) {
    const content = await getContent(composePath);
    if (content) {
      const services = parseDockerComposeServices(content);
      for (const s of services) {
        const key = slugKey(s.name);
        const prefixes: string[] = [];
        if (s.buildPrefix) prefixes.push(s.buildPrefix);
        const kind = s.image ? inferKindFromImage(s.image) : 'software';
        add({
          key,
          name: s.name,
          pathPrefixes: prefixes,
          technology: s.image ?? (kind === 'database' ? 'database' : 'docker-compose'),
          c4Kind: kind,
        });
      }
    }
  }

  const k8sList = await parseKubernetesDeployments(paths, getContent);
  for (const k of k8sList) {
    add({
      key: slugKey(k.name),
      name: k.name,
      pathPrefixes: k.pathPrefixes.length ? k.pathPrefixes : [],
      technology: 'kubernetes',
      c4Kind: 'software',
    });
  }

  const wsContainers = await parsePackageJsonWorkspaces(getContent, pathSet);
  for (const w of wsContainers) {
    add(w);
  }

  if (containers.length === 0) {
    const topDirs = new Set<string>();
    for (const p of paths) {
      const seg = p.split('/')[0];
      if (seg && seg !== 'package.json' && !seg.startsWith('.')) topDirs.add(seg);
    }
    const common = ['services', 'apps', 'packages', 'frontend', 'backend', 'api', 'web'];
    for (const d of common) {
      if (topDirs.has(d)) {
        add({
          key: slugKey(d),
          name: d,
          pathPrefixes: [normPrefix(d)],
          technology: 'monorepo',
          c4Kind: 'software',
        });
      }
    }
  }

  if (containers.length === 0) {
    add({
      key: 'application',
      name: 'Application',
      pathPrefixes: [],
      technology: 'unknown',
      c4Kind: 'software',
    });
  } else {
    add({
      key: '_unassigned',
      name: 'Unassigned',
      pathPrefixes: [],
      technology: 'residual',
      c4Kind: 'software',
    });
  }

  return { systemName, containers };
}
