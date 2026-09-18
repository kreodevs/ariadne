import { describe, expect, it } from 'vitest';
import { sanitizeArchifyArchitectureIr, sanitizeArchifySequenceIr } from './archify-ir-sanitize.js';

describe('sanitizeArchifyArchitectureIr', () => {
  it('trunca sublabels que no caben aunque el ancho esté al máximo', () => {
    const out = sanitizeArchifyArchitectureIr({
      schema_version: 1,
      diagram_type: 'architecture',
      meta: { title: 'C4 Context' },
      components: [
        {
          id: 'ext_infra',
          type: 'external',
          label: 'Infraestructura',
          sublabel:
            'SDK de infraestructura o media detectado en package.json (@aws-sdk/client-s3)',
          pos: [40, 80],
          size: [130, 60],
        },
      ],
    });
    const component = out.components[0]!;
    expect(component.sublabel?.length).toBeLessThan(80);
    expect(component.size?.[0]).toBeLessThanOrEqual(280);
  });

  it('acorta labels org/repo y ensancha el componente para Archify', () => {
    const out = sanitizeArchifyArchitectureIr({
      schema_version: 1,
      diagram_type: 'architecture',
      meta: { title: 'C4 Context' },
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

    const component = out.components[0]!;
    expect(component.label).toBe('memoria-generacional');
    expect(component.sublabel).toContain('kreodevs/memoria-generacional');
    expect(component.size?.[0]).toBeGreaterThanOrEqual(130);
    expect(component.size?.[0]).toBeLessThanOrEqual(280);
  });

  it('reflow mantiene separación mínima tras ensanchar varios componentes en fila', () => {
    const ids = [
      'sys_cc2826e9509a4253',
      'ext_4ee71653bd084aad',
      'ext_d7803bcc833f4d46',
      'ext_76ee3705cdaa44e6',
    ];
    const out = sanitizeArchifyArchitectureIr({
      schema_version: 1,
      diagram_type: 'architecture',
      meta: { title: 'C4 Context' },
      components: ids.map((id, index) => ({
        id,
        type: id.startsWith('sys') ? 'backend' : 'external',
        label: id.startsWith('sys') ? 'kreodevs/memoria-generacional' : `external-${index}`,
        pos: [40 + index * 210, 80] as [number, number],
        size: [130, 60] as [number, number],
      })),
      connections: [
        { from: ids[0], to: ids[1], label: 'REST' },
        { from: ids[1], to: ids[2], label: 'eventos' },
      ],
    });

    const minGap = (
      a: { pos: [number, number]; size?: [number, number] },
      b: { pos: [number, number]; size?: [number, number] },
    ) => {
      const [ax, ay] = a.pos;
      const [aw, ah] = a.size ?? [130, 60];
      const [bx, by] = b.pos;
      const [bw, bh] = b.size ?? [130, 60];
      const dx = Math.max(0, Math.max(ax - (bx + bw), bx - (ax + aw)));
      const dy = Math.max(0, Math.max(ay - (by + bh), by - (ay + ah)));
      return Math.max(dx, dy);
    };

    for (let i = 0; i < out.components.length; i += 1) {
      for (let j = i + 1; j < out.components.length; j += 1) {
        expect(minGap(out.components[i]!, out.components[j]!)).toBeGreaterThanOrEqual(8);
      }
    }
    expect(out.meta.viewBox?.[0]).toBeGreaterThanOrEqual(820);
  });

  it('prefija ids que empiezan con dígito (container slugId + repoId)', () => {
    const out = sanitizeArchifyArchitectureIr({
      schema_version: 1,
      diagram_type: 'architecture',
      meta: { title: 'C4 Container' },
      components: [
        {
          id: '8ca79cef_application',
          type: 'backend',
          label: 'Application',
          pos: [40, 80],
          size: [130, 60],
        },
        {
          id: '89698d97_application',
          type: 'backend',
          label: 'Application',
          pos: [250, 80],
          size: [130, 60],
        },
      ],
      connections: [
        { from: '8ca79cef_application', to: '89698d97_application', label: 'REST' },
      ],
    });

    for (const component of out.components) {
      expect(component.id).toMatch(/^[a-zA-Z][a-zA-Z0-9_-]*$/);
    }
    expect(out.components[0]?.id).toBe('c_8ca79cef_application');
    expect(out.connections?.[0]?.from).toBe('c_8ca79cef_application');
    expect(out.connections?.[0]?.to).toBe('c_89698d97_application');
  });

  it('deduplica ids de componentes duplicados en el IR', () => {
    const out = sanitizeArchifyArchitectureIr({
      schema_version: 1,
      diagram_type: 'architecture',
      meta: { title: 'C4 Component' },
      components: [
        { id: 'same', type: 'frontend', label: 'One', pos: [40, 80], size: [130, 60] },
        { id: 'same', type: 'backend', label: 'Two', pos: [250, 80], size: [130, 60] },
      ],
    });
    expect(out.components.map((c) => c.id)).toEqual(['same', 'same_d1']);
  });

  it('ensancha el componente cuando el label no cabe ni tras acortar', () => {
    const out = sanitizeArchifyArchitectureIr({
      schema_version: 1,
      diagram_type: 'architecture',
      meta: { title: 'C4 Context' },
      components: [
        {
          id: 'svc_long',
          type: 'backend',
          label: 'motor-de-costos-y-listas-de-precios-extendido',
          pos: [40, 80],
          size: [130, 60],
        },
      ],
    });

    const component = out.components[0]!;
    expect(component.size?.[0]).toBeGreaterThan(130);
  });
});

describe('sanitizeArchifySequenceIr', () => {
  it('convierte mensajes self-loop en note del siguiente paso saliente', () => {
    const out = sanitizeArchifySequenceIr({
      schema_version: 1,
      diagram_type: 'sequence',
      meta: { title: 'API flow', viewBox: [820, 520] },
      participants: [
        { id: 'user', type: 'external', label: 'Usuario' },
        { id: 'web', type: 'frontend', label: 'Web UI' },
        { id: 'api', type: 'backend', label: 'API Gateway' },
      ],
      messages: [
        { from: 'user', to: 'web', y: 180, label: 'navega' },
        { from: 'web', to: 'web', y: 228, label: 'render Screen' },
        { from: 'web', to: 'api', y: 276, label: 'GET /api' },
      ],
    });

    expect(out.messages).toHaveLength(2);
    expect(out.messages.some((m) => m.from === m.to)).toBe(false);
    expect(out.messages[1]?.note).toContain('render Screen');
  });

  it('elimina quality_profile e id en messages (legacy)', () => {
    const out = sanitizeArchifySequenceIr({
      schema_version: 1,
      diagram_type: 'sequence',
      meta: {
        title: 'Test',
        quality_profile: 'showcase',
        viewBox: [820, 520],
      },
      participants: [
        { id: 'web', type: 'frontend', label: 'Web' },
        { id: 'api', type: 'backend', label: 'API' },
      ],
      messages: [
        {
          id: 'call',
          from: 'web',
          to: 'api',
          y: 200,
          label: 'GET /x',
          variant: 'emphasis',
        },
      ],
    });
    expect('quality_profile' in out.meta).toBe(false);
    expect(out.messages[0]).toEqual({
      from: 'web',
      to: 'api',
      y: 200,
      label: 'GET /x',
      variant: 'emphasis',
    });
  });
});
