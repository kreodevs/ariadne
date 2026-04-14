/**
 * Filtro único para listFiles (GitHub/Bitbucket) y walk del shallow clone.
 * Incluye código JS/TS, `.md` del repo (salvo bajo `node_modules`), MDX Storybook y JSON Strapi v4 acotados.
 */

import { isProjectMarkdownPath, isStorybookDocumentationPath } from '../pipeline/storybook-documentation';

const CODE_EXT = ['.js', '.jsx', '.ts', '.tsx'];
/** Directorios que no se recorren (Bitbucket crawl / consistencia con clone). */
export const SYNC_IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'venv',
  '.venv',
  '__pycache__',
]);
const IGNORE_FILE = /\.(test|spec)\.(js|jsx|ts|tsx)$|\.log$|\/\.env$|^\.env$/;

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
  const base = path.split('/').pop() ?? '';
  if (SYNC_IGNORE_DIRS.has(base)) return false;
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  const ignoreRe = shouldIndexTests() ? /\.log$|\/\.env$|^\.env$/ : IGNORE_FILE;
  if (CODE_EXT.includes(ext) && !ignoreRe.test(path)) return true;
  if (isProjectMarkdownPath(path)) return true;
  if (ext === '.mdx' && isStorybookDocumentationPath(path)) return true;
  if (ext === '.json' && isStrapiIndexableJsonPath(path)) return true;
  if ((ext === '.mjs' || ext === '.cjs') && !ignoreRe.test(path)) return true;
  if (ext === '.prisma') return true;
  return false;
}
