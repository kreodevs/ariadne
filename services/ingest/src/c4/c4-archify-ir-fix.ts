/**
 * Parches mínimos Archify showcase aplicados en ingest (antes del sanitize de ariadne-common).
 * Cubre: labels org/repo, self-loops sequence, y labels RENDERS/IMPORTS/CALLS en componentes.
 */
import { isArchifyWireProtocol, type ArchifyArchitectureIr, type ArchifySequenceIr } from 'ariadne-common';

const IMPLICIT_EDGE_LABELS = new Set(['renders', 'imports', 'calls']);

const ARCHIFY_MIN_COMPONENT_W = 130;
const ARCHIFY_LABEL_FACTOR = 6.6;
const ARCHIFY_LABEL_PAD = 8;

function labelWidthPx(label: string): number {
  return label.length * ARCHIFY_LABEL_FACTOR;
}

function minWidthForLabel(label: string): number {
  return Math.ceil(labelWidthPx(label) - ARCHIFY_LABEL_PAD);
}

/** Acorta `org/repo` → `repo` y ensancha size si hace falta. */
export function fixArchifyArchitectureIr(ir: ArchifyArchitectureIr): ArchifyArchitectureIr {
  const components = (ir.components ?? []).map((c) => {
    let label = c.label?.trim() || 'Component';
    let sublabel = c.sublabel?.trim() || undefined;
    const slash = label.lastIndexOf('/');
    if (slash > 0 && slash < label.length - 1) {
      const full = label;
      label = full.slice(slash + 1).trim() || label;
      if (!sublabel) {
        sublabel = full.slice(0, 48);
      }
    }
    const baseW = Array.isArray(c.size) ? c.size[0]! : ARCHIFY_MIN_COMPONENT_W;
    const baseH = Array.isArray(c.size) ? c.size[1]! : 60;
    const width = Math.max(baseW, ARCHIFY_MIN_COMPONENT_W, minWidthForLabel(label));
    return {
      ...c,
      label,
      ...(sublabel ? { sublabel } : {}),
      size: [width, baseH] as [number, number],
    };
  });
  const isContextDiagram = /c4 context/i.test(ir.meta?.title ?? '');
  const connections = (ir.connections ?? []).map((conn) => {
    const label = conn.label?.trim() ?? '';
    if (!label) return conn;
    const normalized = label.toLowerCase();
    if (
      isContextDiagram ||
      IMPLICIT_EDGE_LABELS.has(normalized) ||
      !isArchifyWireProtocol(label)
    ) {
      const { label: _label, ...rest } = conn;
      return { ...rest, variant: conn.variant ?? 'dashed' };
    }
    return conn;
  });

  return {
    ...ir,
    components,
    ...(connections.length ? { connections } : {}),
  };
}

/** Elimina self-loops (web→web) que Archify rechaza (<60px span). */
export function fixArchifySequenceIr(ir: ArchifySequenceIr): ArchifySequenceIr {
  const messages = (ir.messages ?? []).filter((m) => m.from !== m.to);
  return { ...ir, messages };
}
