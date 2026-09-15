import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalC4HtmlPath, resolveExistingC4HtmlPath } from './c4-html.util';

describe('c4-html.util', () => {
  it('resuelve ruta canónica cuando el snapshot apunta a un path borrado', () => {
    const root = mkdtempSync(join(tmpdir(), 'c4-html-'));
    const projectId = 'proj-1';
    const level = 'context' as const;
    const canonical = canonicalC4HtmlPath(root, projectId, level);
    mkdirSync(join(root, projectId), { recursive: true });
    writeFileSync(canonical, '<html></html>', 'utf8');

    const resolved = resolveExistingC4HtmlPath(
      root,
      projectId,
      level,
      join(root, projectId, 'missing.html'),
    );
    expect(resolved).toBe(canonical);
  });
});
