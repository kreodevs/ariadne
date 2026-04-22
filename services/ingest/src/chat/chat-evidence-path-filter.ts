/**
 * Criterio “no evidencia de código fuente” alineado con
 * `ChatCypherService.wherePathNotNonSourceEvidenceNoise` (Cypher). Si cambias reglas aquí,
 * actualiza también esa función.
 */
import { SCHEMA_RELATIONAL_RAG_SOURCE_PATH } from '../pipeline/schema-relational-rag-doc';

/** Instalaciones antiguas pueden seguir con el path virtual bajo `ariadne-internal/`. */
const LEGACY_SCHEMA_RELATIONAL_RAG_PATH = 'ariadne-internal/relational-schema-rag-index.md';

function normalizeRepoPath(raw: string | null | undefined): string {
  return String(raw ?? '')
    .trim()
    .replace(/\\/g, '/')
    .toLowerCase();
}

/** Path del índice RAG de esquema: no tratarlo como ruido aunque sea `.md` o prefijo interno. */
export function isSchemaRelationalRagEvidencePath(raw: string | null | undefined): boolean {
  const p = normalizeRepoPath(raw);
  return (
    p === SCHEMA_RELATIONAL_RAG_SOURCE_PATH.toLowerCase() || p === LEGACY_SCHEMA_RELATIONAL_RAG_PATH
  );
}

/**
 * `true` si el path debe excluirse de bundles de evidencia (markdown de proyecto, docs, tooling, tests, …).
 * Paths vacíos no se consideran ruido (misma semántica que el `coalesce(..., '') = ''` en Cypher).
 */
export function isNonSourceEvidenceNoisePath(raw: string | null | undefined): boolean {
  const p = normalizeRepoPath(raw);
  if (!p) return false;
  if (isSchemaRelationalRagEvidencePath(p)) return false;
  return (
    p.endsWith('.md') ||
    p.endsWith('.mdx') ||
    p.endsWith('.rst') ||
    p.startsWith('docs/') ||
    p.startsWith('documents/') ||
    p.startsWith('scripts/') ||
    p.startsWith('prompts/') ||
    p.startsWith('ariadne-internal/') ||
    p.startsWith('.github/') ||
    p.includes('/__tests__/') ||
    p.includes('/__mocks__/') ||
    p.includes('/coverage/') ||
    p.includes('/playwright-report/') ||
    p.includes('.stories.') ||
    p.includes('/e2e/') ||
    p.includes('/tests/') ||
    p.includes('/test/') ||
    p === 'package.json' ||
    p === 'package-lock.json' ||
    p === 'pnpm-lock.yaml' ||
    p === 'yarn.lock' ||
    p === 'openapi.json' ||
    p.endsWith('/openapi.json') ||
    p.startsWith('eslint') ||
    p.startsWith('playwright.') ||
    p.startsWith('postcss.') ||
    p.startsWith('tailwind.') ||
    p.startsWith('vite.') ||
    p.startsWith('vitest.') ||
    p.startsWith('jest.') ||
    p.startsWith('webpack.') ||
    p.startsWith('rollup.') ||
    p.startsWith('biome.') ||
    p.startsWith('ecosystem.') ||
    p.includes('fix-eslint-warnings')
  );
}

export function shouldDropEvidenceNoiseCypherRow(row: Record<string, unknown>): boolean {
  const p = row.path;
  if (typeof p !== 'string') return false;
  return isNonSourceEvidenceNoisePath(p);
}
