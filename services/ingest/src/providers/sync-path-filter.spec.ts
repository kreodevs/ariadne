import { describe, it, expect, afterEach } from 'vitest';
import {
  shouldSyncIndexPath,
  shouldSkipWalkDirectory,
  indexE2ePathsFromEnv,
} from './sync-path-filter';

describe('sync-path-filter (e2e / tests)', () => {
  afterEach(() => {
    delete process.env.INDEX_E2E;
    delete process.env.INDEX_TESTS;
  });

  it('omite carpetas e2e y similares en el path', () => {
    expect(shouldSyncIndexPath('apps/web/e2e/smoke.ts')).toBe(false);
    expect(shouldSyncIndexPath('cypress/integration/foo.cy.ts')).toBe(false);
    expect(shouldSyncIndexPath('src/__tests__/setup.ts')).toBe(false);
  });

  it('omite archivos *.e2e.* aunque estén fuera de carpeta e2e', () => {
    expect(shouldSyncIndexPath('src/login.e2e.ts')).toBe(false);
    expect(shouldSyncIndexPath('src/Login.e2e.tsx')).toBe(false);
  });

  it('con INDEX_E2E=1 permite rutas e2e y *.e2e.*', () => {
    process.env.INDEX_E2E = '1';
    expect(indexE2ePathsFromEnv()).toBe(true);
    expect(shouldSyncIndexPath('apps/web/e2e/smoke.ts')).toBe(true);
    expect(shouldSyncIndexPath('src/login.e2e.ts')).toBe(true);
  });

  it('shouldSkipWalkDirectory respeta INDEX_E2E', () => {
    expect(shouldSkipWalkDirectory('e2e')).toBe(true);
    process.env.INDEX_E2E = 'true';
    expect(shouldSkipWalkDirectory('e2e')).toBe(false);
    expect(shouldSkipWalkDirectory('node_modules')).toBe(true);
  });

  it('sigue indexando código normal', () => {
    expect(shouldSyncIndexPath('src/features/Login.tsx')).toBe(true);
    expect(shouldSyncIndexPath('src/lib/utils.spec.ts')).toBe(false);
    process.env.INDEX_TESTS = '1';
    expect(shouldSyncIndexPath('src/lib/utils.spec.ts')).toBe(true);
  });
});
