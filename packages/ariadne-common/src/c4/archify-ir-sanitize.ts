import type { ArchifyArchitectureIr } from './to-archify.mapper.js';
import type { ArchifySequenceIr } from './to-archify-sequence.js';

const CELL_W = 130;
const CELL_H = 60;
const MAX_CELL_W = 280;
const GAP_X = 80;
const GAP_Y = 100;
const MARGIN_X = 40;
const MARGIN_Y = 80;
const MIN_VIEWBOX_W = 820;
const MIN_VIEWBOX_H = 480;
const VIEWBOX_BOTTOM_PAD = 120;

/** Misma heurística que Archify `render-architecture.mjs` (label showcase). */
const ARCHIFY_LABEL_WIDTH_FACTOR = 6.6;
const ARCHIFY_LABEL_WIDTH_TOLERANCE = 8;
const ARCHIFY_SUBLABEL_MIN_FONT = 6;
const ARCHIFY_TEXT_WIDTH_FACTOR = 0.6;
const ARCHIFY_TEXT_HORIZONTAL_PADDING = 8;

function archifyTextUnits(text: string): number {
  let units = 0;
  for (const ch of text) {
    const codePoint = ch.codePointAt(0) ?? 0;
    if (codePoint >= 0x1100 && (
      (codePoint >= 0x1100 && codePoint <= 0x115f) ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    )) {
      units += 2;
      continue;
    }
    units += 1;
  }
  return units;
}

function minComponentWidthForLabel(label: string): number {
  const estimated = archifyTextUnits(label) * ARCHIFY_LABEL_WIDTH_FACTOR;
  return Math.ceil(estimated - ARCHIFY_LABEL_WIDTH_TOLERANCE);
}

function minComponentWidthForSublabel(sublabel: string): number {
  const minimumTextWidth =
    archifyTextUnits(sublabel) * ARCHIFY_SUBLABEL_MIN_FONT * ARCHIFY_TEXT_WIDTH_FACTOR;
  return Math.ceil(minimumTextWidth + ARCHIFY_TEXT_HORIZONTAL_PADDING);
}

function componentWidthFitsArchifyText(label: string, sublabel?: string, width = CELL_W): boolean {
  const w = Math.max(CELL_W, width);
  const labelOk = archifyTextUnits(label) * ARCHIFY_LABEL_WIDTH_FACTOR <= w + ARCHIFY_LABEL_WIDTH_TOLERANCE;
  if (!sublabel?.trim()) return labelOk;
  const sublabelOk =
    archifyTextUnits(sublabel) * ARCHIFY_SUBLABEL_MIN_FONT * ARCHIFY_TEXT_WIDTH_FACTOR <=
    w - ARCHIFY_TEXT_HORIZONTAL_PADDING;
  return labelOk && sublabelOk;
}

/** Acorta `org/repo` al segmento final y conserva la ruta en sublabel. */
function splitRepoStyleLabel(
  label: string,
  sublabel?: string,
): { label: string; sublabel?: string } {
  const slash = label.lastIndexOf('/');
  if (slash <= 0 || slash >= label.length - 1) {
    return { label, sublabel };
  }
  const shortLabel = label.slice(slash + 1).trim();
  if (!shortLabel) return { label, sublabel };
  const fullPath = label.trim();
  const mergedSublabel = sublabel?.trim()
    ? `${fullPath} · ${sublabel.trim()}`.slice(0, 120)
    : fullPath.slice(0, 120);
  return { label: shortLabel, sublabel: mergedSublabel };
}

function truncateSublabelToFitWidth(sublabel: string, width: number): string {
  if (componentWidthFitsArchifyText('', sublabel, width)) return sublabel;
  let len = sublabel.length;
  while (len > 1) {
    const candidate = `${sublabel.slice(0, len - 1)}…`;
    if (componentWidthFitsArchifyText('', candidate, width)) return candidate;
    len -= 1;
  }
  return '…';
}

function fitArchifyComponentText(
  label: string,
  sublabel?: string,
): { label: string; sublabel?: string; width: number } {
  let nextLabel = label.trim() || 'Component';
  let nextSublabel = sublabel?.trim() || undefined;

  if (!componentWidthFitsArchifyText(nextLabel, nextSublabel)) {
    const split = splitRepoStyleLabel(nextLabel, nextSublabel);
    nextLabel = split.label;
    nextSublabel = split.sublabel;
  }

  const neededWidth = Math.max(
    CELL_W,
    minComponentWidthForLabel(nextLabel),
    nextSublabel ? minComponentWidthForSublabel(nextSublabel) : 0,
  );
  const width = Math.min(MAX_CELL_W, neededWidth);
  let finalSublabel = nextSublabel;
  if (finalSublabel && !componentWidthFitsArchifyText(nextLabel, finalSublabel, width)) {
    finalSublabel = truncateSublabelToFitWidth(finalSublabel, width);
  }

  return {
    label: nextLabel,
    sublabel: finalSublabel,
    width,
  };
}

type LegacyArchitectureComponent = ArchifyArchitectureIr['components'][number] & {
  row?: number;
  col?: number;
};

type ArchifyConnection = NonNullable<ArchifyArchitectureIr['connections']>[number];

type LegacyArchitectureIr = Omit<ArchifyArchitectureIr, 'components' | 'meta' | 'connections'> & {
  layout?: { cols?: number };
  meta?: ArchifyArchitectureIr['meta'] & { quality_profile?: string };
  components?: LegacyArchitectureComponent[];
  connections?: Array<ArchifyConnection & { id?: string }>;
};

type ArchifyComponent = ArchifyArchitectureIr['components'][number];

/** Patrón Archify `architecture.schema.json` para `components[].id`. */
const ARCHIFY_COMPONENT_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/** Normaliza un id C4 (p. ej. `8ca79cef_application` desde slugId+repo) al schema Archify. */
export function normalizeArchifyComponentId(id: string): string {
  const trimmed = id.trim() || 'component';
  const sanitized = trimmed
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  let candidate = (sanitized || 'component').slice(0, 60);
  if (!ARCHIFY_COMPONENT_ID_PATTERN.test(candidate)) {
    candidate = `c_${candidate}`.slice(0, 60);
  }
  return ARCHIFY_COMPONENT_ID_PATTERN.test(candidate) ? candidate : 'c_component';
}

/**
 * Archify rechaza ids que no empiezan por letra (container multi-repo: `{uuid8}_{key}`).
 * Remapea componentes y actualiza conexiones/boundaries.
 */
function normalizeArchifyComponentIds(
  components: ArchifyComponent[],
  connections: ArchifyConnection[],
  boundaries: ArchifyArchitectureIr['boundaries'],
): {
  components: ArchifyComponent[];
  connections: ArchifyConnection[];
  boundaries: ArchifyArchitectureIr['boundaries'];
} {
  const idRemap = new Map<string, string>();

  const nextComponents = components.map((component) => {
    const nextId = normalizeArchifyComponentId(component.id);
    if (nextId !== component.id) {
      idRemap.set(component.id, nextId);
    }
    return { ...component, id: nextId };
  });

  const resolveId = (rawId: string) => idRemap.get(rawId) ?? normalizeArchifyComponentId(rawId);

  const nextConnections = connections.map((conn) => ({
    ...conn,
    from: resolveId(conn.from),
    to: resolveId(conn.to),
  }));

  const nextBoundaries = boundaries?.map((boundary) => ({
    ...boundary,
    wraps: boundary.wraps.map((wrapId) => resolveId(wrapId)),
  }));

  return {
    components: nextComponents,
    connections: nextConnections,
    boundaries: nextBoundaries,
  };
}

/**
 * Archify rechaza IR con ids duplicados (`Component ids must be unique`).
 * Garantiza unicidad y remapea conexiones/boundaries.
 */
function dedupeArchifyComponentIds(
  components: ArchifyComponent[],
  connections: ArchifyConnection[],
  boundaries: ArchifyArchitectureIr['boundaries'],
): {
  components: ArchifyComponent[];
  connections: ArchifyConnection[];
  boundaries: ArchifyArchitectureIr['boundaries'];
} {
  const used = new Set<string>();
  const idRemap = new Map<string, string>();
  const occurrence = new Map<string, number>();

  const nextComponents = components.map((component, index) => {
    const count = occurrence.get(component.id) ?? 0;
    occurrence.set(component.id, count + 1);
    if (count === 0 && !used.has(component.id)) {
      used.add(component.id);
      return component;
    }

    let candidate = `${component.id.slice(0, 44)}_d${count}`;
    let seq = count + 1;
    while (used.has(candidate)) {
      candidate = `${component.id.slice(0, 40)}_d${index}_${seq}`;
      seq += 1;
    }
    used.add(candidate);
    idRemap.set(`${component.id}#${index}`, candidate);
    return { ...component, id: candidate };
  });

  const resolveId = (rawId: string, indexHint?: number): string => {
    if (indexHint != null) {
      const mapped = idRemap.get(`${rawId}#${indexHint}`);
      if (mapped) return mapped;
    }
    return rawId;
  };

  const nextConnections = connections.map((conn) => ({
    ...conn,
    from: resolveId(conn.from),
    to: resolveId(conn.to),
  }));

  const nextBoundaries = boundaries?.map((boundary) => ({
    ...boundary,
    wraps: boundary.wraps.map((wrapId) => resolveId(wrapId)),
  }));

  return {
    components: nextComponents,
    connections: nextConnections,
    boundaries: nextBoundaries,
  };
}

/** Recoloca el grid usando el ancho/alto real de cada celda (evita solapes tras ensanchar labels). */
function reflowArchifyArchitectureLayout(
  components: ArchifyComponent[],
  cols: number,
): ArchifyComponent[] {
  if (components.length === 0) return components;

  const rows = Math.ceil(components.length / cols);
  const colWidths = Array.from({ length: cols }, () => CELL_W);
  const rowHeights = Array.from({ length: rows }, () => CELL_H);

  for (let index = 0; index < components.length; index += 1) {
    const component = components[index]!;
    const col = index % cols;
    const row = Math.floor(index / cols);
    const width = component.size?.[0] ?? CELL_W;
    const height = component.size?.[1] ?? CELL_H;
    colWidths[col] = Math.max(colWidths[col], width);
    rowHeights[row] = Math.max(rowHeights[row], height);
  }

  const colX: number[] = [];
  let x = MARGIN_X;
  for (let col = 0; col < cols; col += 1) {
    colX[col] = x;
    x += colWidths[col] + GAP_X;
  }

  const rowY: number[] = [];
  let y = MARGIN_Y;
  for (let row = 0; row < rows; row += 1) {
    rowY[row] = y;
    y += rowHeights[row] + GAP_Y;
  }

  return components.map((component, index) => ({
    ...component,
    pos: [colX[index % cols], rowY[Math.floor(index / cols)]] as [number, number],
  }));
}

function computeArchitectureViewBox(components: ArchifyComponent[]): [number, number] {
  if (components.length === 0) {
    return [MIN_VIEWBOX_W, MIN_VIEWBOX_H];
  }

  let maxRight = MARGIN_X;
  let maxBottom = MARGIN_Y;
  for (const component of components) {
    const [posX, posY] = component.pos;
    const width = component.size?.[0] ?? CELL_W;
    const height = component.size?.[1] ?? CELL_H;
    maxRight = Math.max(maxRight, posX + width);
    maxBottom = Math.max(maxBottom, posY + height);
  }

  return [
    Math.max(MIN_VIEWBOX_W, maxRight + MARGIN_X),
    Math.max(MIN_VIEWBOX_H, maxBottom + MARGIN_Y + VIEWBOX_BOTTOM_PAD),
  ];
}

/** Elimina campos legacy (pre v2.9) y normaliza al schema Archify actual. */
export function sanitizeArchifyArchitectureIr(ir: LegacyArchitectureIr): ArchifyArchitectureIr {
  const cols =
    ir.layout?.cols ??
    Math.min(4, Math.max(2, Math.ceil(Math.sqrt((ir.components?.length ?? 1) + 1))));

  const sizedComponents = (ir.components ?? []).map((c, index) => {
    const row = c.row ?? Math.floor(index / cols);
    const col = c.col ?? index % cols;
    const pos: [number, number] =
      Array.isArray(c.pos) && c.pos.length === 2
        ? [c.pos[0]!, c.pos[1]!]
        : [MARGIN_X + col * (CELL_W + GAP_X), MARGIN_Y + row * (CELL_H + GAP_Y)];
    const baseSize: [number, number] =
      Array.isArray(c.size) && c.size.length === 2 ? [c.size[0]!, c.size[1]!] : [CELL_W, CELL_H];
    const fitted = fitArchifyComponentText(c.label, c.sublabel);
    const size: [number, number] = [Math.max(baseSize[0], fitted.width), baseSize[1]];
    return {
      id: c.id,
      type: c.type,
      label: fitted.label,
      sublabel: fitted.sublabel,
      tag: c.tag,
      pos,
      size,
    };
  });
  const connections: ArchifyConnection[] = (ir.connections ?? []).map((conn) => {
    const { id: _id, ...rest } = conn;
    return rest;
  });

  const normalized = normalizeArchifyComponentIds(sizedComponents, connections, ir.boundaries);
  const deduped = dedupeArchifyComponentIds(
    normalized.components,
    normalized.connections,
    normalized.boundaries,
  );
  const components = reflowArchifyArchitectureLayout(deduped.components, cols);
  const viewBox = computeArchitectureViewBox(components);

  const { quality_profile: _qp, ...meta } = ir.meta ?? { title: 'Architecture' };

  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: meta.title ?? 'Architecture',
      subtitle: meta.subtitle,
      output: meta.output,
      animation: meta.animation,
      viewBox,
    },
    components,
    ...(deduped.boundaries?.length ? { boundaries: deduped.boundaries } : {}),
    ...(deduped.connections.length ? { connections: deduped.connections } : {}),
    ...(ir.cards?.length ? { cards: ir.cards } : {}),
  };
}

type ArchifySequenceMessage = ArchifySequenceIr['messages'][number];

/**
 * Archify exige ≥60px entre columnas; mensajes from===to fallan (0px).
 * Convierte self-loops en `note` del siguiente mensaje saliente del participante.
 */
function resolveSequenceSelfLoopMessages(messages: ArchifySequenceMessage[]): ArchifySequenceMessage[] {
  const pendingByParticipant = new Map<string, string[]>();
  const resolved: ArchifySequenceMessage[] = [];

  for (const message of messages) {
    if (message.from === message.to) {
      const label = message.label?.trim();
      if (label) {
        const queue = pendingByParticipant.get(message.from) ?? [];
        queue.push(label);
        pendingByParticipant.set(message.from, queue);
      }
      continue;
    }

    const pending = pendingByParticipant.get(message.from);
    let note = message.note?.trim();
    if (pending?.length) {
      note = [...pending, note].filter(Boolean).join(' · ');
      pendingByParticipant.delete(message.from);
    }

    resolved.push({
      from: message.from,
      to: message.to,
      y: message.y,
      label: message.label,
      variant: message.variant,
      ...(note ? { note } : {}),
    });
  }

  for (const [participantId, notes] of pendingByParticipant) {
    if (notes.length === 0) continue;
    const noteText = notes.join(' · ');
    let targetIdx = -1;
    for (let i = resolved.length - 1; i >= 0; i -= 1) {
      const candidate = resolved[i];
      if (candidate.from === participantId || candidate.to === participantId) {
        targetIdx = i;
        break;
      }
    }
    if (targetIdx < 0) continue;
    const target = resolved[targetIdx];
    const mergedNote = [target.note, noteText].filter(Boolean).join(' · ');
    resolved[targetIdx] = { ...target, note: mergedNote };
  }

  return resolved;
}

/** Elimina quality_profile y `id` en messages (legacy pre v2.9). */
export function sanitizeArchifySequenceIr(
  ir: ArchifySequenceIr & {
    meta?: ArchifySequenceIr['meta'] & { quality_profile?: string };
    messages?: Array<
      ArchifySequenceIr['messages'][number] & { id?: string }
    >;
  },
): ArchifySequenceIr {
  const { quality_profile: _qp, ...meta } = ir.meta ?? { title: 'Sequence' };

  const messages = resolveSequenceSelfLoopMessages(
    (ir.messages ?? []).map((m) => ({
      from: m.from,
      to: m.to,
      y: m.y,
      label: m.label,
      variant: m.variant,
      note: m.note,
    })),
  );

  return {
    schema_version: 1,
    diagram_type: 'sequence',
    meta: {
      title: meta.title ?? 'Sequence',
      subtitle: meta.subtitle,
      output: meta.output,
      animation: meta.animation,
      viewBox: meta.viewBox,
    },
    participants: ir.participants ?? [],
    messages,
    ...(ir.cards?.length ? { cards: ir.cards } : {}),
  };
}
