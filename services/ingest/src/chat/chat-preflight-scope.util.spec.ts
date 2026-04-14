/**
 * Tests del preflight de alcance por path en mensaje.
 */
import { describe, expect, it } from 'vitest';
import {
  extractPathCandidatesForRepoResolve,
  filterCollectedResultsByTargetRepo,
  filterGatheredContextByTargetRepo,
  repoIdsInCollectedResults,
} from './chat-preflight-scope.util';

describe('extractPathCandidatesForRepoResolve', () => {
  it('captura absolutas Unix y relativas', () => {
    const s = 'Ver /Users/dev/acme/frontend/src/App.tsx y también packages/api/src/x.ts';
    const c = extractPathCandidatesForRepoResolve(s);
    expect(c).toContain('/Users/dev/acme/frontend/src/App.tsx');
    expect(c).toContain('packages/api/src/x.ts');
  });
});

describe('repoIdsInCollectedResults', () => {
  it('agrupa repoId únicos', () => {
    const a = '11111111-1111-4111-8111-111111111111';
    const b = '22222222-2222-4222-8222-222222222222';
    const ids = repoIdsInCollectedResults([{ path: 'x', repoId: a }, { repoId: b }, { path: 'z' }]);
    expect(ids.size).toBe(2);
    expect(ids.has(a)).toBe(true);
  });
});

describe('filterCollectedResultsByTargetRepo', () => {
  it('elimina filas de otro repo', () => {
    const t = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const rows = filterCollectedResultsByTargetRepo(
      [{ x: 1, repoId: t }, { x: 2, repoId: other }, { x: 3 }],
      t,
    );
    expect(rows).toHaveLength(2);
  });
});

describe('filterGatheredContextByTargetRepo', () => {
  const t = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const projectSet = new Set([t, other]);

  it('conserva bloques sin UUID de proyecto', () => {
    const ctx = ['solo texto', 'file `src/x.ts`'].join('\n\n---\n\n');
    expect(filterGatheredContextByTargetRepo(ctx, t, projectSet)).toBe(ctx);
  });

  it('tira bloques que solo citan otro repo', () => {
    const bad = `Filas:\n| path | repoId |\n| a | ${other} |`;
    const good = `OK ${t} data`;
    const ctx = [bad, good].join('\n\n---\n\n');
    const out = filterGatheredContextByTargetRepo(ctx, t, projectSet);
    expect(out).not.toContain(other);
    expect(out).toContain(t);
  });
});
