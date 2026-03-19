/**
 * Utilidades puras para análisis (riesgo, duplicados, ciclos, búsqueda).
 */

import { SEARCH_SYNONYMS } from './chat.constants';

/** Riesgo = acoplamiento + complejidad ciclomática + LOC + sin doc (métricas estándar). */
export function computeRiskScore(row: {
  outCalls: number;
  complexity?: number | null;
  loc?: number | null;
  noDesc?: boolean;
}): number {
  const outCalls = row.outCalls ?? 0;
  const cx = row.complexity ?? 1;
  const loc = row.loc ?? 50;
  const noDesc = row.noDesc === true ? 5 : 0;
  const locPenalty = loc > 100 ? 3 : loc > 50 ? 1 : 0;
  return outCalls * 3 + cx * 2 + noDesc + locPenalty;
}

/**
 * Agrupa pares de duplicados: por nombre (mismo nombre en varios archivos) y por cluster (similitud semántica).
 */
export function groupDuplicates(pairs: Array<{ a: string; b: string; score: number }>): {
  byName: Array<{ name: string; type: string; paths: string[] }>;
  byCluster: Array<{ members: Array<{ path: string; name: string }>; score: number }>;
} {
  const sameName = pairs.filter((p) => p.score >= 0.99);
  const semantic = pairs.filter((p) => p.score < 0.99);

  const byNameMap = new Map<string, Set<string>>();
  for (const p of sameName) {
    const [pathA, nameA] = p.a.includes('::') ? p.a.split('::') : [p.a, ''];
    const [pathB, nameB] = p.b.includes('::') ? p.b.split('::') : [p.b, ''];
    const name = nameA || nameB;
    if (!name) continue;
    if (!byNameMap.has(name)) byNameMap.set(name, new Set());
    byNameMap.get(name)!.add(pathA).add(pathB);
  }
  const byName: Array<{ name: string; type: string; paths: string[] }> = [];
  for (const [name, paths] of byNameMap) {
    byName.push({ name, type: 'función', paths: [...paths].sort() });
  }

  const nodeToId = new Map<string, number>();
  let id = 0;
  const parent: number[] = [];
  const getOrCreate = (pathName: string): number => {
    if (!nodeToId.has(pathName)) {
      nodeToId.set(pathName, id);
      parent.push(id);
      id++;
    }
    return nodeToId.get(pathName)!;
  };
  const find = (x: number): number => {
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  };
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  for (const p of semantic) {
    union(getOrCreate(p.a), getOrCreate(p.b));
  }
  const clusters = new Map<number, { members: Array<{ path: string; name: string }>; maxScore: number }>();
  for (const p of semantic) {
    const root = find(nodeToId.get(p.a)!);
    if (!clusters.has(root)) clusters.set(root, { members: [], maxScore: 0 });
    const [pathA, nameA] = p.a.includes('::') ? p.a.split('::') : [p.a, ''];
    const [pathB, nameB] = p.b.includes('::') ? p.b.split('::') : [p.b, ''];
    const c = clusters.get(root)!;
    c.maxScore = Math.max(c.maxScore, p.score);
    if (!c.members.some((m) => m.path === pathA && m.name === nameA)) c.members.push({ path: pathA, name: nameA });
    if (!c.members.some((m) => m.path === pathB && m.name === nameB)) c.members.push({ path: pathB, name: nameB });
  }
  const byCluster: Array<{ members: Array<{ path: string; name: string }>; score: number }> = [];
  for (const { members, maxScore } of clusters.values()) {
    if (members.length >= 2) {
      byCluster.push({ members, score: maxScore });
    }
  }

  return { byName, byCluster };
}

/** Formatea el resumen de duplicados agrupado. */
export function formatDuplicatesSummary(
  totalPairs: number,
  byName: Array<{ name: string; type: string; paths: string[] }>,
  byCluster: Array<{ members: Array<{ path: string; name: string }>; score: number }>,
): string {
  const lines: string[] = ['## Código duplicado', ''];
  lines.push(`Se encontraron **${totalPairs}** par(es) potencialmente duplicados, agrupados por nombre/cluster.`, '');
  if (byName.length > 0) {
    lines.push('### Mismo nombre (varios archivos)', '');
    lines.push('| Función / Componente | Tipo | Archivos donde aparece |');
    lines.push('|-----------------------|------|------------------------|');
    for (const g of byName.sort((a, b) => b.paths.length - a.paths.length)) {
      const pathsStr = g.paths.map((p) => `\`${p}\``).join(', ');
      lines.push(`| **${g.name}** | ${g.type} | ${pathsStr} |`);
    }
    lines.push('');
  }
  if (byCluster.length > 0) {
    lines.push('### Similitud semántica (nombres distintos)', '');
    for (const c of byCluster.slice(0, 50).sort((a, b) => b.members.length - a.members.length)) {
      const membersStr = c.members.map((m) => `\`${m.path}\`::${m.name}`).join(', ');
      lines.push(`- ${membersStr} — similitud ~${(c.score * 100).toFixed(0)}%`);
    }
    if (byCluster.length > 50) lines.push(`\n_… y ${byCluster.length - 50} clusters más._`);
  }
  return lines.join('\n');
}

/** Encuentra imports circulares directos (A→B y B→A). */
export function findImportCycles(imports: Array<{ fromPath: string; toPath: string }>): Array<[string, string]> {
  const edges = new Set(imports.map((i) => `${i.fromPath}|${i.toPath}`));
  const cycles: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const { fromPath, toPath } of imports) {
    const key = `${toPath}|${fromPath}`;
    if (edges.has(key) && fromPath < toPath && !seen.has(key)) {
      seen.add(key);
      cycles.push([fromPath, toPath]);
    }
  }
  return cycles;
}

/** FalkorDB puede devolver options como string JSON; normaliza a string[]. */
export function normalizeOptions(options: unknown): string[] {
  if (Array.isArray(options)) return options.filter((x): x is string => typeof x === 'string');
  if (typeof options === 'string') {
    try {
      const parsed = JSON.parse(options) as unknown;
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [options];
    } catch {
      return [options];
    }
  }
  return [];
}

/** Extrae términos de búsqueda (palabras 4+ chars) del mensaje. Normaliza acentos (á→a) para no romper términos. */
export function extractSearchTerms(message: string): string[] {
  const stop = new Set([
    'para', 'con', 'que', 'los', 'las', 'una', 'del', 'como', 'esta', 'este', 'todos', 'todo',
    'archivos', 'archivo', 'componentes', 'componente', 'funciones', 'funcion', 'rutas', 'ruta',
    'usan', 'usa', 'tiene', 'tienen', 'contienen', 'relacionados', 'relacionadas', 'programado', 'programada',
    'existen', 'existe', 'aplicacion', 'aplicaciones',
  ]);
  const normalized = message
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
  return normalized
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !stop.has(w));
}

/** Términos a probar (principal + sinónimos) para búsqueda en el grafo. */
export function getSearchTermsWithSynonyms(term: string): string[] {
  const lower = term.toLowerCase();
  const syns = SEARCH_SYNONYMS[lower] ?? [];
  return [lower, ...syns];
}
