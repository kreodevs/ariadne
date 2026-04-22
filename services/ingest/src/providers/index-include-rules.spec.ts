import { describe, it, expect } from 'vitest';
import {
  shouldIndexPathWithRepoRules,
  parseIndexIncludeRulesFromDto,
  isMandatoryDefaultRootIndexPath,
  filterPathsByRepoIndexRules,
} from './index-include-rules';
import { shouldSyncIndexPath } from './sync-path-filter';

describe('index-include-rules', () => {
  it('null rules coincide con shouldSyncIndexPath', () => {
    expect(shouldIndexPathWithRepoRules('src/App.tsx', null)).toBe(shouldSyncIndexPath('src/App.tsx'));
    expect(shouldIndexPathWithRepoRules('config/random.json', null)).toBe(false);
  });

  it('mandatory root: package.json y extensiones en raíz', () => {
    const rules = parseIndexIncludeRulesFromDto({ entries: [{ kind: 'path_prefix', path: 'apps/web' }] })!;
    expect(shouldIndexPathWithRepoRules('package.json', rules)).toBe(true);
    expect(shouldIndexPathWithRepoRules('tsconfig.json', rules)).toBe(true);
    expect(shouldIndexPathWithRepoRules('vite.config.ts', rules)).toBe(true);
    expect(shouldIndexPathWithRepoRules('.env.json', rules)).toBe(false);
    expect(shouldIndexPathWithRepoRules('apps/api/package.json', rules)).toBe(false);
  });

  it('entries vacío: solo mandatory root', () => {
    const rules = parseIndexIncludeRulesFromDto({ entries: [] })!;
    expect(shouldIndexPathWithRepoRules('package.json', rules)).toBe(true);
    expect(shouldIndexPathWithRepoRules('src/App.tsx', rules)).toBe(false);
  });

  it('path_prefix: código bajo prefijo', () => {
    const rules = parseIndexIncludeRulesFromDto({
      entries: [{ kind: 'path_prefix', path: 'services/api' }],
    })!;
    expect(shouldIndexPathWithRepoRules('services/api/src/main.ts', rules)).toBe(true);
    expect(shouldIndexPathWithRepoRules('services/other/x.ts', rules)).toBe(false);
  });

  it('file explícito sin pasar filtro global de .json profundo', () => {
    const rules = parseIndexIncludeRulesFromDto({
      entries: [{ kind: 'file', path: 'config/app.json' }],
    })!;
    expect(shouldIndexPathWithRepoRules('config/app.json', rules)).toBe(true);
    expect(shouldIndexPathWithRepoRules('config/other.json', rules)).toBe(false);
  });

  it('rechaza paths bajo node_modules aunque sean file explícitos', () => {
    const rules = parseIndexIncludeRulesFromDto({
      entries: [{ kind: 'file', path: 'node_modules/foo/index.js' }],
    })!;
    expect(shouldIndexPathWithRepoRules('node_modules/foo/index.js', rules)).toBe(false);
  });

  it('filterPathsByRepoIndexRules', () => {
    const rules = parseIndexIncludeRulesFromDto({ entries: [{ kind: 'path_prefix', path: 'a' }] })!;
    const out = filterPathsByRepoIndexRules(['a/b.ts', 'z/x.ts', 'package.json'], rules);
    expect(out).toContain('package.json');
    expect(out).toContain('a/b.ts');
    expect(out).not.toContain('z/x.ts');
  });

  it('isMandatoryDefaultRootIndexPath', () => {
    expect(isMandatoryDefaultRootIndexPath('package.json')).toBe(true);
    expect(isMandatoryDefaultRootIndexPath('foo.ts')).toBe(true);
    expect(isMandatoryDefaultRootIndexPath('dir/pkg.json')).toBe(false);
  });
});
