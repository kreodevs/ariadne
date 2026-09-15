import { describe, expect, it } from 'vitest';
import { infrastructureSpecToC4Model, mergeC4ContainerModels } from 'ariadne-common';
import {
  inferRepoStackContainer,
  parsePnpmWorkspacePatterns,
  scanC4Infrastructure,
} from './c4-infrastructure';

describe('inferRepoStackContainer', () => {
  it('detecta repo frontend React+Vite', async () => {
    const pathSet = new Set(['package.json', 'src/App.tsx', 'vite.config.ts']);
    const getContent = async (p: string) => {
      if (p !== 'package.json') return null;
      return JSON.stringify({
        name: 'oohbp-frontend',
        dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
        devDependencies: { vite: '^5.0.0' },
      });
    };
    const spec = await inferRepoStackContainer(getContent, pathSet, 'desarrollo_imj/oohbp2');
    expect(spec?.stackRole).toBe('frontend');
    expect(spec?.key).toBe('frontend');
    expect(spec?.pathPrefixes).toContain('src/');
    expect(spec?.technology).toContain('Vite');
  });

  it('detecta repo backend NestJS', async () => {
    const pathSet = new Set(['package.json', 'src/main.ts', 'nest-cli.json']);
    const getContent = async (p: string) => {
      if (p !== 'package.json') return null;
      return JSON.stringify({
        name: 'erp-api',
        dependencies: { '@nestjs/core': '^10.0.0', typeorm: '^0.3.0' },
      });
    };
    const spec = await inferRepoStackContainer(getContent, pathSet, 'desarrollo_imj/erp');
    expect(spec?.stackRole).toBe('backend');
    expect(spec?.key).toBe('backend');
    expect(spec?.technology).toBe('NestJS');
  });
});

describe('scanC4Infrastructure', () => {
  it('detecta servicios en docker-compose con build relativo y depends_on', async () => {
    const pathSet = new Set(['docker-compose.yml', 'services/api/src/index.ts']);
    const getContent = async (p: string) => {
      if (p === 'docker-compose.yml') {
        return `services:
  api:
    build: ./services/api
    depends_on:
      - db
  db:
    image: postgres:15
`;
      }
      return null;
    };
    const { spec, composePath } = await scanC4Infrastructure(pathSet, getContent, 'org/repo');
    expect(composePath).toBe('docker-compose.yml');
    expect(spec.containers.some((c) => c.name === 'api')).toBe(true);
    expect(spec.containers.find((c) => c.name === 'api')?.pathPrefixes).toContain('services/api/');
    expect(spec.containers.find((c) => c.name === 'db')?.c4Kind).toBe('database');
    expect(spec.communications?.some((c) => c.fromKey === 'api' && c.toKey === 'db')).toBe(true);
  });

  it('detecta compose aunque docker-compose.yml no esté en indexed_files (probe remoto)', async () => {
    const pathSet = new Set(['backend/src/main.ts', 'apps/super-admin/src/App.tsx']);
    const getContent = async (p: string) => {
      if (p === 'docker-compose.yml') {
        return `services:
  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    depends_on:
      - postgres
  postgres:
    image: postgres:16-alpine
`;
      }
      return null;
    };
    const { spec, composePath } = await scanC4Infrastructure(pathSet, getContent, 'org/memoria');
    expect(composePath).toBe('docker-compose.yml');
    expect(spec.containers.some((c) => c.name === 'backend')).toBe(true);
    expect(spec.containers.find((c) => c.name === 'backend')?.pathPrefixes).toContain('backend/');
    expect(spec.containers.find((c) => c.name === 'postgres')?.c4Kind).toBe('database');
    expect(
      spec.communications?.some((c) => c.fromKey === 'backend' && c.toKey === 'postgres'),
    ).toBe(true);
  });

  it('parsea pnpm-workspace.yaml y expone paquetes del monorepo', async () => {
    expect(
      parsePnpmWorkspacePatterns(`packages:
  - 'apps/*'
  - 'packages/*'
  - backend
  - worker
`),
    ).toEqual(['apps/*', 'packages/*', 'backend', 'worker']);

    const pathSet = new Set([
      'package.json',
      'backend/package.json',
      'backend/src/main.ts',
      'worker/package.json',
      'apps/super-admin/package.json',
      'apps/attendee-app/package.json',
    ]);
    const getContent = async (p: string) => {
      if (p === 'package.json') return JSON.stringify({ name: 'memoria-generacional', private: true });
      if (p === 'pnpm-workspace.yaml') {
        return `packages:
  - 'apps/*'
  - backend
  - worker
`;
      }
      return null;
    };
    const { spec } = await scanC4Infrastructure(pathSet, getContent, 'org/memoria');
    expect(spec.containers.some((c) => c.name === 'backend')).toBe(true);
    expect(spec.containers.some((c) => c.name === 'super-admin')).toBe(true);
    expect(spec.containers.some((c) => c.name === 'attendee-app')).toBe(true);
    expect(spec.containers.some((c) => c.name === 'worker')).toBe(true);
    expect(spec.containers.find((c) => c.name === 'backend')?.technology).toBe('pnpm workspace');
  });

  it('prefiere compose sobre workspaces (sin duplicar apps)', async () => {
    const pathSet = new Set([
      'docker-compose.yml',
      'backend/src/main.ts',
      'apps/super-admin/src/App.tsx',
    ]);
    const getContent = async (p: string) => {
      if (p === 'docker-compose.yml') {
        return `services:
  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
  super-admin:
    build:
      context: .
      dockerfile: Dockerfile.frontend
`;
      }
      if (p === 'pnpm-workspace.yaml') {
        return `packages:
  - 'apps/*'
  - backend
`;
      }
      return null;
    };
    const { spec } = await scanC4Infrastructure(pathSet, getContent, 'org/memoria');
    const names = spec.containers.map((c) => c.name);
    expect(names).toContain('backend');
    expect(names).toContain('super-admin');
    expect(names.filter((n) => n === 'super-admin')).toHaveLength(1);
    expect(spec.containers.some((c) => c.technology === 'pnpm workspace')).toBe(false);
  });

  it('usa package.json cuando no hay compose (front/back sueltos)', async () => {
    const pathSet = new Set(['package.json', 'src/pages/Home.tsx', 'vite.config.ts']);
    const getContent = async (p: string) => {
      if (p === 'package.json') {
        return JSON.stringify({
          name: 'app-web',
          dependencies: { react: '^18.0.0' },
          devDependencies: { vite: '^5.0.0' },
        });
      }
      return null;
    };
    const { spec } = await scanC4Infrastructure(pathSet, getContent, 'org/web');
    expect(spec.containers.some((c) => c.stackRole === 'frontend')).toBe(true);
    expect(spec.containers.some((c) => c.name === 'Application')).toBe(false);
  });
});

describe('mergeC4ContainerModels multi-root', () => {
  it('añade REST entre frontend y backend de repos distintos', () => {
    const front = infrastructureSpecToC4Model(
      {
        systemName: 'org/oohbp2',
        containers: [
          {
            key: 'frontend',
            name: 'Web UI',
            pathPrefixes: ['src/'],
            technology: 'React + Vite',
            c4Kind: 'software',
            stackRole: 'frontend',
          },
        ],
      },
      'proj',
      { repoId: 'repo-front-11111111-aaaa-bbbb-cccc-dddddddddddd' },
    );
    const back = infrastructureSpecToC4Model(
      {
        systemName: 'org/erp',
        containers: [
          {
            key: 'backend',
            name: 'API',
            pathPrefixes: ['src/'],
            technology: 'NestJS',
            c4Kind: 'software',
            stackRole: 'backend',
          },
        ],
      },
      'proj',
      { repoId: 'repo-back-22222222-aaaa-bbbb-cccc-dddddddddddd' },
    );
    const merged = mergeC4ContainerModels([front, back], 'proj');
    expect(
      merged.relationships.some(
        (r) => r.protocol === 'REST' && r.label === 'REST' && r.from.includes('frontend'),
      ),
    ).toBe(true);
  });
});
