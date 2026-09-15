import { describe, expect, it } from 'vitest';
import { fixArchifyArchitectureIr, fixArchifySequenceIr } from './c4-archify-ir-fix';

describe('c4-archify-ir-fix', () => {
  it('acorta label org/repo para Archify context', () => {
    const out = fixArchifyArchitectureIr({
      schema_version: 1,
      diagram_type: 'architecture',
      meta: { title: 'T' },
      components: [
        {
          id: 'sys_cc2826e9509a4253',
          type: 'backend',
          label: 'kreodevs/memoria-generacional',
          pos: [40, 80],
          size: [130, 60],
        },
      ],
    });
    expect(out.components[0]?.label).toBe('memoria-generacional');
    expect(out.components[0]?.sublabel).toContain('kreodevs/memoria-generacional');
  });

  it('quita REST en diagramas C4 Context', () => {
    const out = fixArchifyArchitectureIr({
      schema_version: 1,
      diagram_type: 'architecture',
      meta: { title: 'C4 Context — Memoria' },
      components: [
        { id: 'sys', type: 'backend', label: 'app', pos: [40, 80], size: [130, 60] },
        { id: 'ext', type: 'external', label: 'Pagos', pos: [250, 80], size: [130, 60] },
      ],
      connections: [{ from: 'sys', to: 'ext', label: 'REST', variant: 'emphasis' }],
    });
    expect(out.connections?.[0]?.label).toBeUndefined();
  });

  it('quita descripciones largas de inferencia en aristas', () => {
    const out = fixArchifyArchitectureIr({
      schema_version: 1,
      diagram_type: 'architecture',
      meta: { title: 'C4 Context' },
      components: [
        { id: 'sys', type: 'backend', label: 'app', pos: [40, 80], size: [130, 60] },
        { id: 'ext', type: 'external', label: 'Mensajería', pos: [250, 80], size: [130, 60] },
      ],
      connections: [
        {
          from: 'sys',
          to: 'ext',
          label: 'Bus o cola detectada en package.json (@nestjs/bu',
          variant: 'default',
        },
      ],
    });
    expect(out.connections?.[0]?.label).toBeUndefined();
  });

  it('quita label eventos redundante en context', () => {
    const out = fixArchifyArchitectureIr({
      schema_version: 1,
      diagram_type: 'architecture',
      meta: { title: 'C4 Context' },
      components: [
        { id: 'sys', type: 'backend', label: 'app', pos: [40, 80], size: [130, 60] },
        { id: 'ext', type: 'external', label: 'Eventos', pos: [250, 80], size: [130, 60] },
      ],
      connections: [{ from: 'sys', to: 'ext', label: 'eventos', variant: 'emphasis' }],
    });
    expect(out.connections?.[0]?.label).toBeUndefined();
  });

  it('quita label RENDERS en conexiones de componente', () => {
    const out = fixArchifyArchitectureIr({
      schema_version: 1,
      diagram_type: 'architecture',
      meta: { title: 'C4 Component' },
      components: [
        { id: 'a', type: 'frontend', label: 'Parent', pos: [40, 80], size: [130, 60] },
        { id: 'b', type: 'frontend', label: 'Child', pos: [250, 80], size: [130, 60] },
      ],
      connections: [{ from: 'a', to: 'b', label: 'RENDERS', variant: 'emphasis' }],
    });
    expect(out.connections?.[0]?.label).toBeUndefined();
    expect(out.connections?.[0]?.variant).toBe('emphasis');
  });

  it('elimina mensaje sequence from===to', () => {
    const out = fixArchifySequenceIr({
      schema_version: 1,
      diagram_type: 'sequence',
      meta: { title: 'T' },
      participants: [
        { id: 'web', type: 'frontend', label: 'Web' },
        { id: 'api', type: 'backend', label: 'API' },
      ],
      messages: [
        { from: 'web', to: 'web', y: 228, label: 'render Screen' },
        { from: 'web', to: 'api', y: 276, label: 'GET /api' },
      ],
    });
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0]?.label).toBe('GET /api');
  });
});
