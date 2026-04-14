/**
 * Extracción de términos para Cypher CONTAINS en `get_modification_plan`.
 */

export function normalizeModificationPlanToken(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const BASE_MODIFICATION_PLAN_STOPWORDS = new Set(
  [
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'en', 'y', 'o', 'pero', 'si', 'no',
    'que', 'para', 'por', 'con', 'al', 'lo', 'como', 'mas', 'menos', 'este', 'esta', 'eso', 'se',
    'the', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'with', 'is', 'are', 'be', 'this', 'that', 'and', 'or',
    'quiero', 'quiuero', 'haz', 'hacer', 'hagas', 'crea', 'crear', 'usa', 'usar', 'mcp', 'cursor', 'solo',
    'plan', 'planes', 'accion', 'acciones', 'comparar', 'compara', 'compare', 'comparacion', 'list', 'lista',
    'listas', 'path', 'paths', 'file', 'files', 'archivo', 'archivos', 'code', 'codigo', 'tipo', 'tipos',
    'data', 'datos', 'case', 'class', 'name', 'names', 'user', 'body', 'json', 'api', 'src', 'app', 'web',
    'new', 'get', 'set', 'use', 'out', 'all', 'any', 'hay', 'sea', 'ser', 'son', 'fue', 'vez', 'cada',
    'mismo', 'misma', 'otro', 'otra', 'otros', 'sola', 'poco', 'muy', 'bien', 'mal', 'asi', 'donde', 'cual',
    'cuales', 'cuando', 'porque', 'tambien', 'aqui', 'alla', 'etc', 'ej', 'puede', 'pueden', 'debe', 'deben',
    'debo', 'hago', 'hace', 'hacen', 'haciendo', 'hecho', 'hechos', 'tuyo', 'tuya', 'tuyos', 'tuyas', 'mio',
    'mios', 'suyo', 'suya', 'modo', 'forma', 'manera', 'parte', 'partes', 'todo', 'toda', 'todos', 'todas',
    'nada', 'nadie', 'algo', 'alguien', 'gran',
  ].map((w) => normalizeModificationPlanToken(w)),
);

const DEFAULT_SHORT_TERM_ALLOWLIST = new Set(
  ['primeflex', 'tailwind', 'strapi', 'vite', 'mui', 'sass', 'scss', 'less', 'nx', 'css', 'jsx', 'tsx', 'mdx', 'cjs', 'mjs'].map(
    (w) => normalizeModificationPlanToken(w),
  ),
);

function loadExtraStopwords(): Set<string> {
  const raw = process.env.MODIFICATION_PLAN_EXTRA_STOPWORDS?.trim();
  if (!raw) return new Set();
  const out = new Set<string>();
  for (const part of raw.split(/[,;\n]+/)) {
    const t = normalizeModificationPlanToken(part.trim());
    if (t.length > 0) out.add(t);
  }
  return out;
}

function loadShortTermAllowlist(): Set<string> {
  const out = new Set(DEFAULT_SHORT_TERM_ALLOWLIST);
  const raw = process.env.MODIFICATION_PLAN_SHORT_TERMS_ALLOWLIST?.trim();
  if (raw) {
    for (const part of raw.split(/[,;\n]+/)) {
      const t = normalizeModificationPlanToken(part.trim());
      if (t.length > 0) out.add(t);
    }
  }
  return out;
}

function termMinLength(): number {
  const raw = process.env.MODIFICATION_PLAN_TERM_MIN_LENGTH?.trim();
  const n = raw ? parseInt(raw, 10) : 4;
  if (!Number.isFinite(n) || n < 2) return 4;
  return Math.min(n, 32);
}

export function extractModificationPlanCypherTerms(userDescription: string): string[] {
  const stop = new Set([...BASE_MODIFICATION_PLAN_STOPWORDS, ...loadExtraStopwords()]);
  const allowShort = loadShortTermAllowlist();
  const minLen = termMinLength();

  const words = userDescription
    .replace(/[^\w\s\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1\u00c1\u00c9\u00cd\u00d3\u00da\u00d1\u00fc\u00dc]/gi, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);

  const kept: string[] = [];
  const seenNorm = new Set<string>();
  for (const w of words) {
    const n = normalizeModificationPlanToken(w);
    if (stop.has(n)) continue;
    if (n.length < minLen && !allowShort.has(n)) continue;
    if (seenNorm.has(n)) continue;
    seenNorm.add(n);
    kept.push(w);
  }

  kept.sort((a, b) => b.length - a.length || a.localeCompare(b));
  return kept.slice(0, 12);
}

export function expandModificationPlanTermPairs(terms: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of terms) {
    for (const x of [t, t.charAt(0).toUpperCase() + t.slice(1)]) {
      if (!seen.has(x)) {
        seen.add(x);
        out.push(x);
      }
    }
  }
  return out;
}
