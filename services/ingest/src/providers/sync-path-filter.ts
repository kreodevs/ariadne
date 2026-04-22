/**
 * Filtro único para listFiles (GitHub/Bitbucket) y walk del shallow clone.
 * Incluye código JS/TS, `.md` del repo (salvo bajo `node_modules`), MDX Storybook, JSON Strapi v4 acotados,
 * y manifiestos/specs: `package.json`, `openapi.json`/`swagger.json`/`openapi.ya?ml` en cualquier carpeta.
 *
 * Carpetas típicas de **e2e** / Playwright / Cypress y archivos `*.e2e.*` se omiten por defecto.
 * Override: `INDEX_E2E=true` (mismo espíritu que `INDEX_TESTS` para specs).
 *
 * Carpetas **`migrations/`** (p. ej. TypeORM `src/migrations/*.ts`) suelen ser ruido en contexto legacy; se omiten por defecto.
 * Override: `INDEX_MIGRATIONS=true`.
 */

import { isProjectMarkdownPath, isStorybookDocumentationPath } from '../pipeline/storybook-documentation';

const CODE_EXT = ['.js', '.jsx', '.ts', '.tsx'];

/** Segmentos de ruta que nunca se indexan (artefactos, deps, entornos). */
export const SYNC_ALWAYS_SKIP_SEGMENTS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'venv',
  '.venv',
  '__pycache__',
]);

/**
 * Carpetas de tests e2e / herramientas y salidas; omitidas salvo `INDEX_E2E=1`.
 * No usar nombres genéricos como `tests` (podría ser código de dominio).
 */
export const SYNC_E2E_STYLE_SEGMENTS = new Set([
  'e2e',
  'playwright',
  'playwright-report',
  'test-results',
  '.playwright',
  'cypress',
  '__tests__',
  '__mocks__',
]);

/** Segmento de ruta `migrations` (ORM); omitido salvo `INDEX_MIGRATIONS=1`. */
export const SYNC_MIGRATION_STYLE_SEGMENTS = new Set(['migrations']);

/** @deprecated Preferir `SYNC_ALWAYS_SKIP_SEGMENTS` y `SYNC_E2E_STYLE_SEGMENTS`. */
export const SYNC_IGNORE_DIRS = new Set([
  ...SYNC_ALWAYS_SKIP_SEGMENTS,
  ...SYNC_E2E_STYLE_SEGMENTS,
]);

const IGNORE_FILE = /\.(test|spec)\.(js|jsx|ts|tsx)$|\.log$|\/\.env$|^\.env$/;
const E2E_FILE_RE = /\.e2e\.(js|jsx|ts|tsx)$/i;

function splitPathSegments(path: string): string[] {
  return path.replace(/\\/g, '/').split('/').filter(Boolean);
}

/** Si true, entran rutas bajo carpetas e2e/playwright/cypress y `*.e2e.*`. */
export function indexE2ePathsFromEnv(): boolean {
  const v = process.env.INDEX_E2E?.trim().toLowerCase();
  return v === 'true' || v === '1';
}

/** Si true, entran rutas bajo `.../migrations/` (p. ej. TypeORM). Default: excluidas. */
export function indexMigrationsPathsFromEnv(): boolean {
  const v = process.env.INDEX_MIGRATIONS?.trim().toLowerCase();
  return v === 'true' || v === '1';
}

/** ¿Omitir este directorio al recorrer el árbol (clone / API)? */
export function shouldSkipWalkDirectory(dirName: string): boolean {
  if (SYNC_ALWAYS_SKIP_SEGMENTS.has(dirName)) return true;
  if (!indexE2ePathsFromEnv() && SYNC_E2E_STYLE_SEGMENTS.has(dirName)) return true;
  if (!indexMigrationsPathsFromEnv() && SYNC_MIGRATION_STYLE_SEGMENTS.has(dirName)) return true;
  return false;
}

function pathHasSegmentIn(path: string, set: Set<string>): boolean {
  return splitPathSegments(path).some((s) => set.has(s));
}

/** Rutas bajo `node_modules`, `.git`, `dist`, etc. — no indexar aunque el usuario pida un archivo explícito ahí. */
export function pathHasGlobalSkipSegment(path: string): boolean {
  const norm = path.replace(/\\/g, '/');
  return pathHasSegmentIn(norm, SYNC_ALWAYS_SKIP_SEGMENTS);
}

/**
 * Manifiestos y specs que deben entrar en el mapping (clone + API) aunque el resto de .json se excluya.
 */
export function isManifestOrOpenApiSyncPath(path: string): boolean {
  const norm = path.replace(/\\/g, '/');
  const base = norm.slice(norm.lastIndexOf('/') + 1).toLowerCase();
  if (base === 'package.json') return true;
  if (base === 'swagger.json') return true;
  if (base === 'openapi.json') return true;
  if (base === 'openapi.yaml' || base === 'openapi.yml') return true;
  return false;
}

/**
 * JSON necesarios para el grafo Strapi (ApiRoute / StrapiContentType desde schema).
 * El resto de .json (package-lock, tsconfig, etc.) se excluye para no inflar el índice.
 */
export function isStrapiIndexableJsonPath(path: string): boolean {
  const norm = path.replace(/\\/g, '/');
  if (/\/content-types\/[^/]+\/schema\.json$/i.test(norm)) return true;
  if (/\/api\/[^/]+\/routes\/[^/]+\.json$/i.test(norm)) return true;
  if (/\/extensions\/[^/]+\/(?:server\/)?routes\/[^/]+\.json$/i.test(norm)) return true;
  return false;
}

function shouldIndexTests(): boolean {
  const v = process.env.INDEX_TESTS;
  return v === 'true' || v === '1';
}

/** ¿Incluir este path en mapping/sync/chunking? */
export function shouldSyncIndexPath(path: string): boolean {
  const norm = path.replace(/\\/g, '/');

  if (pathHasSegmentIn(norm, SYNC_ALWAYS_SKIP_SEGMENTS)) return false;
  if (!indexE2ePathsFromEnv()) {
    if (pathHasSegmentIn(norm, SYNC_E2E_STYLE_SEGMENTS)) return false;
    if (E2E_FILE_RE.test(norm)) return false;
  }
  if (!indexMigrationsPathsFromEnv() && pathHasSegmentIn(norm, SYNC_MIGRATION_STYLE_SEGMENTS)) {
    return false;
  }

  const ext = norm.slice(norm.lastIndexOf('.')).toLowerCase();
  const ignoreRe = shouldIndexTests() ? /\.log$|\/\.env$|^\.env$/ : IGNORE_FILE;
  if (CODE_EXT.includes(ext) && !ignoreRe.test(norm)) return true;
  if (isProjectMarkdownPath(norm)) return true;
  if (ext === '.mdx' && isStorybookDocumentationPath(norm)) return true;
  if (ext === '.json' && isStrapiIndexableJsonPath(norm)) return true;
  if (ext === '.json' && isManifestOrOpenApiSyncPath(norm)) return true;
  if ((ext === '.yaml' || ext === '.yml') && isManifestOrOpenApiSyncPath(norm)) return true;
  if ((ext === '.mjs' || ext === '.cjs') && !ignoreRe.test(norm)) return true;
  if (ext === '.prisma') return true;
  return false;
}
