/**
 * @fileoverview Escaneo heurístico de infra (docker-compose, k8s, workspaces) para C4 container.
 */

import type {
  C4CommunicationSpec,
  C4ContainerKind,
  C4ContainerSpec,
  C4InfrastructureSpec,
  C4StackRole,
} from 'ariadne-common';

export type { C4ContainerKind, C4ContainerSpec, C4CommunicationSpec, C4InfrastructureSpec };

export interface ScanC4InfrastructureResult {
  spec: C4InfrastructureSpec;
  composePath: string | null;
}

const COMPOSE_NAMES = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
];

const PNPM_WORKSPACE_NAMES = ['pnpm-workspace.yaml', 'pnpm-workspace.yml'];

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

function parseDependsOn(blockLines: string[]): string[] {
  const out: string[] = [];
  let inDependsOn = false;
  for (const line of blockLines) {
    const inline = /^\s*depends_on:\s*\[([^\]]+)\]/i.exec(line);
    if (inline) {
      for (const part of inline[1]!.split(',')) {
        const name = part.trim().replace(/['"]/g, '');
        if (name) out.push(name);
      }
      continue;
    }
    if (/^\s*depends_on:\s*$/i.test(line)) {
      inDependsOn = true;
      continue;
    }
    if (!inDependsOn) continue;
    const listItem = /^\s+-\s*([^\s#:]+)/.exec(line);
    if (listItem) {
      const name = listItem[1]!.replace(/['"]/g, '');
      if (name && name !== 'condition') out.push(name);
      continue;
    }
    const mapKey = /^\s+([a-zA-Z0-9_-]+):\s*$/.exec(line);
    if (mapKey && mapKey[1] !== 'condition') {
      out.push(mapKey[1]!);
    }
  }
  return out;
}

/**
 * Extrae bloques `services:` de compose (subset YAML).
 */
function parseDockerComposeServices(content: string): Array<{
  name: string;
  buildPrefix?: string;
  dockerfile?: string;
  image?: string;
  dependsOn: string[];
}> {
  const lines = content.split(/\r?\n/);
  let i = 0;
  const out: Array<{
    name: string;
    buildPrefix?: string;
    dockerfile?: string;
    image?: string;
    dependsOn: string[];
  }> = [];
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
    let dockerfile: string | undefined;
    let image: string | undefined;
    const blockLines: string[] = [];
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
      blockLines.push(L);
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
      const dockerfileLine = /^\s*dockerfile:\s*["']?([^"'\s#]+)/i.exec(L);
      if (dockerfileLine) dockerfile = dockerfileLine[1]!.trim();
      i++;
    }
    const dependsOn: string[] = [];
    const depIdx = blockLines.findIndex((l) => /^\s*depends_on:/i.test(l));
    if (depIdx >= 0) {
      dependsOn.push(...parseDependsOn(blockLines.slice(depIdx)));
    }
    out.push({ name: svcName, buildPrefix, dockerfile, image, dependsOn });
  }
  return out;
}

async function parseKubernetesDeployments(
  paths: string[],
  getContent: (p: string) => Promise<string | null>,
): Promise<Array<{ name: string; pathPrefixes: string[] }>> {
  const out: Array<{ name: string; pathPrefixes: string[] }> = [];
  const yamlFiles = paths.filter(
    (p) =>
      (/^(kubernetes|k8s|charts)\//i.test(p) || /\/(kubernetes|k8s)\//i.test(p)) &&
      /\.ya?ml$/i.test(p),
  );
  for (const p of yamlFiles.slice(0, 80)) {
    const c = await getContent(p);
    if (!c || !/kind:\s*Deployment/i.test(c)) continue;
    const nameM = /metadata:\s*\n\s*name:\s*([^\s#]+)/i.exec(c);
    const name = nameM?.[1]?.trim();
    if (!name) continue;
    const dir = p.split('/').slice(0, -1).join('/');
    out.push({ name, pathPrefixes: dir ? [normPrefix(dir)] : [] });
  }
  return out;
}

function hasPathPrefix(pathSet: Set<string>, prefix: string): boolean {
  const norm = normPrefix(prefix);
  return [...pathSet].some((p) => p === norm.slice(0, -1) || p.startsWith(norm));
}

function packageDependencyNames(pkg: Record<string, unknown>): string[] {
  const buckets = ['dependencies', 'devDependencies', 'peerDependencies'] as const;
  const names: string[] = [];
  for (const bucket of buckets) {
    const block = pkg[bucket];
    if (block && typeof block === 'object') {
      names.push(...Object.keys(block as Record<string, unknown>));
    }
  }
  return names;
}

/** Repo suelto front o back (sin compose/workspaces) desde package.json raíz. */
export async function inferRepoStackContainer(
  getContent: (p: string) => Promise<string | null>,
  pathSet: Set<string>,
  systemName: string,
): Promise<C4ContainerSpec | null> {
  const raw = await getContent('package.json');
  if (!raw) return null;

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  const deps = packageDependencyNames(pkg);
  const depSet = new Set(deps.map((d) => d.toLowerCase()));
  const has = (name: string) => depSet.has(name.toLowerCase());

  const frontendSignals =
    has('react') ||
    has('react-dom') ||
    has('vue') ||
    has('vite') ||
    deps.some((d) => d.startsWith('@vitejs/')) ||
    deps.some((d) => d.includes('@imj_media/ui')) ||
    has('react-router') ||
    has('react-router-dom') ||
    pathSet.has('vite.config.ts') ||
    pathSet.has('vite.config.mts') ||
    pathSet.has('vite.config.js');

  const backendSignals =
    deps.some((d) => d.startsWith('@nestjs/')) ||
    has('typeorm') ||
    has('@nestjs/typeorm') ||
    pathSet.has('nest-cli.json') ||
    pathSet.has('ormconfig.ts') ||
    pathSet.has('ormconfig.js');

  let role: C4StackRole | null = null;
  if (frontendSignals && !backendSignals) role = 'frontend';
  else if (backendSignals && !frontendSignals) role = 'backend';
  else if (frontendSignals && backendSignals) {
    role = backendSignals && deps.some((d) => d.startsWith('@nestjs/')) ? 'backend' : 'frontend';
  }
  if (!role) return null;

  const pathCandidates =
    role === 'frontend'
      ? ['src/', 'frontend/', 'apps/web/', 'web/', 'app/']
      : ['src/', 'api/', 'backend/', 'services/api/', 'erp_obp/'];
  const pathPrefixes = pathCandidates.filter((p) => hasPathPrefix(pathSet, p));
  if (pathPrefixes.length === 0 && hasPathPrefix(pathSet, 'src/')) {
    pathPrefixes.push('src/');
  }

  const pkgName = typeof pkg.name === 'string' ? pkg.name.trim() : '';
  const repoLabel = systemName.includes('/') ? systemName.split('/').pop()! : systemName;
  const displayName =
    role === 'frontend'
      ? pkgName && !pkgName.includes('erp')
        ? `Web UI (${pkgName})`
        : `Web UI (${repoLabel})`
      : pkgName
        ? `API (${pkgName})`
        : `API (${repoLabel})`;

  const technology =
    role === 'frontend'
      ? deps.some((d) => d.includes('vite'))
        ? 'React + Vite'
        : 'React'
      : deps.some((d) => d.startsWith('@nestjs/'))
        ? 'NestJS'
        : 'Node API';

  return {
    key: role === 'frontend' ? 'frontend' : 'backend',
    name: displayName,
    pathPrefixes,
    technology,
    c4Kind: 'software',
    stackRole: role,
  };
}

/** Extrae patrones `packages:` de pnpm-workspace.yaml (subset YAML). */
export function parsePnpmWorkspacePatterns(content: string): string[] {
  const patterns: string[] = [];
  const inline = /packages:\s*\[([^\]]+)\]/i.exec(content);
  if (inline) {
    for (const part of inline[1]!.split(',')) {
      const pat = part.trim().replace(/^['"]|['"]$/g, '');
      if (pat) patterns.push(pat);
    }
    return patterns;
  }
  let inPackages = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^packages:\s*$/i.test(line.trim())) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const item = /^\s*-\s*['"]?([^'"]+)['"]?\s*$/.exec(line);
      if (item) {
        patterns.push(item[1]!.trim());
        continue;
      }
      if (line.trim() && !/^\s/.test(line)) inPackages = false;
    }
  }
  return patterns;
}

async function collectWorkspacePatterns(
  getContent: (p: string) => Promise<string | null>,
): Promise<string[]> {
  const patterns: string[] = [];
  const rawPkg = await getContent('package.json');
  if (rawPkg) {
    try {
      const pkg = JSON.parse(rawPkg) as { workspaces?: unknown };
      const ws = pkg.workspaces;
      if (Array.isArray(ws)) {
        patterns.push(...(ws as string[]));
      } else if (
        typeof ws === 'object' &&
        ws !== null &&
        Array.isArray((ws as { packages?: string[] }).packages)
      ) {
        patterns.push(...(ws as { packages: string[] }).packages);
      }
    } catch {
      /* ignore malformed package.json */
    }
  }
  for (const name of PNPM_WORKSPACE_NAMES) {
    const raw = await getContent(name);
    if (raw) patterns.push(...parsePnpmWorkspacePatterns(raw));
  }
  return [...new Set(patterns.filter((p) => typeof p === 'string' && p.trim()))];
}

function workspacePatternsToContainers(
  patterns: string[],
  paths: Set<string>,
): C4ContainerSpec[] {
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
          technology: 'pnpm workspace',
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
      if (!first || seen.has(first)) continue;
      seen.add(first);
      out.push({
        key: slugKey(first),
        name: first,
        pathPrefixes: [normPrefix(`${base}/${first}`)],
        technology: 'pnpm workspace',
        c4Kind: 'software',
      });
    }
  }
  return out;
}

async function parseWorkspaceContainers(
  getContent: (p: string) => Promise<string | null>,
  paths: Set<string>,
): Promise<C4ContainerSpec[]> {
  const patterns = await collectWorkspacePatterns(getContent);
  return workspacePatternsToContainers(patterns, paths);
}

function inferComposeServicePathPrefixes(
  serviceName: string,
  buildPrefix: string | undefined,
  dockerfile: string | undefined,
  pathSet: Set<string>,
): string[] {
  const prefixes: string[] = [];
  const trimmedBuild = buildPrefix?.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '');
  if (trimmedBuild && trimmedBuild !== '.') {
    prefixes.push(normPrefix(trimmedBuild));
  }
  if (dockerfile) {
    const dir = dockerfile.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    if (dir && dir !== '.') prefixes.push(normPrefix(dir));
  }
  const candidates = [
    serviceName,
    `apps/${serviceName}`,
    `services/${serviceName}`,
    serviceName.replace(/-backend$/, ''),
    serviceName.replace(/-video$/, ''),
  ];
  for (const c of candidates) {
    const p = normPrefix(c);
    if (hasPathPrefix(pathSet, p)) prefixes.push(p);
  }
  return [...new Set(prefixes)];
}

async function resolveComposeFile(
  pathSet: Set<string>,
  getContent: (p: string) => Promise<string | null>,
): Promise<{ path: string; content: string } | null> {
  for (const n of COMPOSE_NAMES) {
    if (!pathSet.has(n)) continue;
    const content = await getContent(n);
    if (content && /services:\s*/i.test(content)) return { path: n, content };
  }
  for (const n of COMPOSE_NAMES) {
    if (pathSet.has(n)) continue;
    const content = await getContent(n);
    if (content && /services:\s*/i.test(content)) return { path: n, content };
  }
  return null;
}

export async function scanC4Infrastructure(
  pathSet: Set<string>,
  getContent: (p: string) => Promise<string | null>,
  systemName: string,
): Promise<ScanC4InfrastructureResult> {
  const paths = [...pathSet];
  const containers: C4ContainerSpec[] = [];
  const communications: C4CommunicationSpec[] = [];
  const seenKeys = new Set<string>();
  let composePath: string | null = null;

  const add = (c: C4ContainerSpec) => {
    let k = c.key;
    let n = 2;
    while (seenKeys.has(k)) {
      k = `${c.key}_${n++}`;
    }
    seenKeys.add(k);
    containers.push({ ...c, key: k });
  };

  let composeServicesAdded = 0;
  const resolvedCompose = await resolveComposeFile(pathSet, getContent);
  if (resolvedCompose) {
    composePath = resolvedCompose.path;
    const services = parseDockerComposeServices(resolvedCompose.content);
    const nameToKey = new Map<string, string>();
    for (const s of services) {
      const key = slugKey(s.name);
      nameToKey.set(s.name, key);
      const prefixes = inferComposeServicePathPrefixes(
        s.name,
        s.buildPrefix,
        s.dockerfile,
        pathSet,
      );
      const kind = s.image ? inferKindFromImage(s.image) : 'software';
      add({
        key,
        name: s.name,
        pathPrefixes: prefixes,
        technology: s.image ?? (kind === 'database' ? 'database' : 'docker-compose'),
        c4Kind: kind,
      });
      composeServicesAdded++;
    }
    for (const s of services) {
      const fromKey = nameToKey.get(s.name);
      if (!fromKey) continue;
      for (const dep of s.dependsOn) {
        const toKey = nameToKey.get(dep);
        if (!toKey || fromKey === toKey) continue;
        communications.push({ fromKey, toKey, label: 'depends_on' });
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

  if (composeServicesAdded === 0) {
    for (const w of await parseWorkspaceContainers(getContent, pathSet)) {
      add(w);
    }
  }

  if (containers.length === 0) {
    const stackContainer = await inferRepoStackContainer(getContent, pathSet, systemName);
    if (stackContainer) {
      add(stackContainer);
    }
  }

  if (containers.length === 0) {
    const topDirs = new Set<string>();
    for (const p of paths) {
      const seg = p.split('/')[0];
      if (seg && seg !== 'package.json' && !seg.startsWith('.')) topDirs.add(seg);
    }
    for (const d of ['services', 'apps', 'packages', 'frontend', 'backend', 'api', 'web']) {
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

  return {
    spec: { systemName, containers, communications },
    composePath,
  };
}
