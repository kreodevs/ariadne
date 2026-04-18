import { describe, expect, it } from 'vitest';
import { scanC4Infrastructure } from './c4-infrastructure';

describe('scanC4Infrastructure', () => {
  it('detecta servicios en docker-compose con build relativo', async () => {
    const pathSet = new Set(['docker-compose.yml', 'services/api/src/index.ts']);
    const getContent = async (p: string) => {
      if (p === 'docker-compose.yml') {
        return `services:\n  api:\n    build: ./services/api\n  db:\n    image: postgres:15\n`;
      }
      return null;
    };
    const spec = await scanC4Infrastructure(pathSet, getContent, 'org/repo');
    expect(spec.containers.some((c) => c.name === 'api')).toBe(true);
    expect(spec.containers.find((c) => c.name === 'api')?.pathPrefixes).toContain('services/api/');
    expect(spec.containers.find((c) => c.name === 'db')?.c4Kind).toBe('database');
  });
});
