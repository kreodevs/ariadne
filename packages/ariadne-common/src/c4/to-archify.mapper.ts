import { isArchifyWireProtocol } from './api-flow-labels.util.js';
import type { C4Element, C4Model, C4Relationship } from './c4-model.types.js';

export type ArchifyComponentType =
  | 'frontend'
  | 'backend'
  | 'database'
  | 'cloud'
  | 'security'
  | 'messagebus'
  | 'external';

/** IR Archify v2.9+ (architecture.schema.json) — pos/size, sin layout ni quality_profile en meta. */
export interface ArchifyArchitectureIr {
  schema_version: 1;
  diagram_type: 'architecture';
  meta: {
    title: string;
    subtitle?: string;
    output?: string;
    animation?: 'trace' | 'none';
    viewBox?: [number, number];
  };
  components: Array<{
    id: string;
    type: ArchifyComponentType;
    label: string;
    sublabel?: string;
    tag?: string;
    pos: [number, number];
    size?: [number, number];
  }>;
  boundaries?: Array<{
    kind: 'region' | 'security-group';
    label: string;
    wraps: string[];
    pad?: number;
  }>;
  connections?: Array<{
    from: string;
    to: string;
    label?: string;
    variant?: 'default' | 'emphasis' | 'security' | 'dashed';
    fromSide?: 'left' | 'right' | 'top' | 'bottom';
    toSide?: 'left' | 'right' | 'top' | 'bottom';
  }>;
  cards?: Array<{ dot: string; title: string; items: string[] }>;
}

const CELL_W = 130;
const CELL_H = 60;
const GAP_X = 80;
const GAP_Y = 100;
const MARGIN_X = 40;
const MARGIN_Y = 80;
/** Sublabel máximo en context (cajas Archify ~130–280px). */
const CONTEXT_SUBLABEL_MAX = 36;

function truncateDiagramText(text: string, max = CONTEXT_SUBLABEL_MAX): string {
  const t = text.trim();
  if (!t) return '';
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Sublabel corto para C4 Context (dominio + hints de package.json). */
function buildContextSublabel(el: C4Element, pathSublabel?: string): string | undefined {
  const desc = el.description?.trim();

  if (el.kind === 'system') {
    if (desc) {
      const domainOnly = desc.replace(/^Dominio:\s*/i, '').trim();
      return truncateDiagramText(domainOnly);
    }
    return pathSublabel ? truncateDiagramText(pathSublabel) : undefined;
  }

  if (el.kind === 'external' && desc) {
    const paren = /\(([^)]+)\)/.exec(desc);
    if (paren) return truncateDiagramText(paren[1]!.trim());
    return truncateDiagramText(desc);
  }

  if (desc) return truncateDiagramText(desc);
  if (el.technology) return truncateDiagramText(el.technology);
  return pathSublabel ? truncateDiagramText(pathSublabel) : undefined;
}

function gridPosition(index: number, cols: number): { pos: [number, number]; size: [number, number] } {
  const row = Math.floor(index / cols);
  const col = index % cols;
  return {
    pos: [MARGIN_X + col * (CELL_W + GAP_X), MARGIN_Y + row * (CELL_H + GAP_Y)],
    size: [CELL_W, CELL_H],
  };
}

function archifyTypeForElement(el: C4Element, level: C4Model['level']): ArchifyComponentType {
  if (el.kind === 'person') return 'cloud';
  if (el.kind === 'external') return 'external';
  if (level === 'context' && el.kind === 'system') return 'backend';
  if (level === 'component' && el.kind === 'component') {
    const pathHint = (el.technology ?? el.name).toLowerCase();
    if (/route|page|view|screen|frontend|tsx|jsx/.test(pathHint)) return 'frontend';
    return 'backend';
  }

  if (el.stackRole === 'frontend') return 'frontend';
  if (el.stackRole === 'backend') return 'backend';

  const tech = (el.technology ?? '').toLowerCase();
  const name = el.name.toLowerCase();
  if (/postgres|mysql|mongo|redis|falkor|database|mariadb|elasticsearch/.test(tech + name)) {
    return 'database';
  }
  if (/frontend|web|ui|vite|react/.test(tech + name) || name === 'frontend') {
    return 'frontend';
  }
  if (/queue|kafka|sqs|rabbit|bull/.test(tech + name)) {
    return 'messagebus';
  }
  if (/mcp|orchestrator|ingest|api|nest|backend|cartographer/.test(tech + name)) {
    return 'backend';
  }
  return 'backend';
}

function diagramElements(model: C4Model): C4Element[] {
  if (model.level === 'context') {
    return model.elements.filter((e) =>
      e.kind === 'person' || e.kind === 'system' || e.kind === 'external',
    );
  }
  if (model.level === 'component') {
    return model.elements.filter((e) => e.kind === 'component' || e.kind === 'container');
  }
  return model.elements.filter(
    (e) => e.kind === 'container' || e.kind === 'system' || e.kind === 'external',
  );
}

function diagramRelationships(model: C4Model): C4Relationship[] {
  const ids = new Set(diagramElements(model).map((e) => e.id));
  return model.relationships.filter((r) => ids.has(r.from) && ids.has(r.to) && r.label !== 'contains');
}

/** En nivel componente, RENDERS/IMPORTS/CALLS no llevan label (Archify showcase en grafos densos). */
const IMPLICIT_COMPONENT_PROTOCOLS = new Set(['RENDERS', 'IMPORTS', 'CALLS']);

function archifyConnectionFromRelationship(
  rel: C4Relationship,
  level: C4Model['level'],
  _elementNameById?: ReadonlyMap<string, string>,
): NonNullable<ArchifyArchitectureIr['connections']>[number] {
  const protocol = rel.protocol?.trim();
  const protocolUpper = protocol?.toUpperCase();

  if (level === 'component' && protocolUpper && IMPLICIT_COMPONENT_PROTOCOLS.has(protocolUpper)) {
    return { from: rel.from, to: rel.to, variant: 'dashed' };
  }

  if (level === 'context') {
    const emphasized = isArchifyWireProtocol(protocol);
    return {
      from: rel.from,
      to: rel.to,
      variant: emphasized ? ('emphasis' as const) : ('default' as const),
    };
  }

  const label =
    level === 'component' && protocolUpper === 'ROUTE_TO_COMPONENT'
      ? rel.label
      : rel.protocol ?? rel.label;
  return {
    from: rel.from,
    to: rel.to,
    ...(label ? { label } : {}),
    variant: rel.protocol ? ('emphasis' as const) : ('default' as const),
  };
}

/**
 * Mapea C4Model → JSON IR Archify architecture (pos/size grid, schema v2.9).
 */
export function c4ModelToArchifyArchitecture(
  model: C4Model,
  title?: string,
): ArchifyArchitectureIr {
  const nodes = diagramElements(model).filter((e) => {
    if (model.level === 'context') return true;
    if (model.level === 'component') return e.kind === 'component';
    return e.kind !== 'system';
  });
  const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(nodes.length + 1))));

  const components = nodes.map((el, index) => {
    const { pos, size } = gridPosition(index, cols);
    const slash = el.name.lastIndexOf('/');
    const label =
      slash > 0 && slash < el.name.length - 1
        ? el.name.slice(slash + 1).trim() || el.name
        : el.name;
    const pathSublabel =
      slash > 0 && slash < el.name.length - 1 ? el.name.trim() : undefined;
    const sublabel =
      model.level === 'context'
        ? buildContextSublabel(el, pathSublabel)
        : (() => {
            const tech = el.technology?.slice(0, 64);
            return pathSublabel && tech && tech !== pathSublabel
              ? `${pathSublabel} · ${tech}`.slice(0, 64)
              : pathSublabel ?? tech;
          })();
    return {
      id: el.id,
      type: archifyTypeForElement(el, model.level),
      label,
      sublabel,
      pos,
      size,
    };
  });

  const elementNameById = new Map(diagramElements(model).map((el) => [el.id, el.name] as const));
  const connections = diagramRelationships(model).map((rel) =>
    archifyConnectionFromRelationship(rel, model.level, elementNameById),
  );

  const dbCount = components.filter((c) => c.type === 'database').length;
  const personCount = model.elements.filter((e) => e.kind === 'person').length;
  const externalCount = model.elements.filter((e) => e.kind === 'external').length;
  const cards: ArchifyArchitectureIr['cards'] = [];
  if (model.systemName) {
    cards.push({
      dot: 'cyan',
      title: model.level === 'context' ? 'Contexto' : 'Sistema',
      items: [
        model.systemName,
        model.level === 'context'
          ? `${externalCount} sistema(s) externo(s)`
          : `${components.length} contenedores`,
      ],
    });
  }
  if (model.level === 'context' && personCount > 0) {
    cards.push({
      dot: 'violet',
      title: 'Actores',
      items: [`${personCount} persona(s)`],
    });
  }
  if (dbCount > 0) {
    cards.push({
      dot: 'emerald',
      title: 'Persistencia',
      items: [`${dbCount} almacén(es) de datos`],
    });
  }

  const rows = Math.ceil(nodes.length / cols);
  const viewBoxW = Math.max(820, MARGIN_X * 2 + cols * CELL_W + (cols - 1) * GAP_X);
  const viewBoxH = Math.max(480, MARGIN_Y * 2 + rows * CELL_H + (rows - 1) * GAP_Y + 120);

  const defaultTitle =
    model.level === 'context'
      ? `C4 Context — ${model.systemName ?? model.projectId}`
      : model.level === 'component'
        ? `C4 Component — ${model.systemName ?? model.projectId}`
        : `C4 Container — ${model.systemName ?? model.projectId}`;
  const subtitle =
    model.level === 'context'
      ? model.generator === 'hybrid'
        ? 'Nivel contexto (dominios + narrativa LLM)'
        : 'Nivel contexto (determinista desde dominios)'
      : model.level === 'component'
        ? 'Nivel componente (Falkor IMPORTS/RENDERS/CALLS)'
        : model.level === 'container'
          ? 'Nivel contenedor (determinista)'
          : undefined;

  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: title ?? defaultTitle,
      subtitle,
      viewBox: [viewBoxW, viewBoxH],
    },
    components,
    connections,
    ...(cards.length > 0 ? { cards } : {}),
  };
}
