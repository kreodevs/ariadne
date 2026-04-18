import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Box, GitBranch, Radio, Link2 } from 'lucide-react';

export type NodeFlowRole = 'focal' | 'dependency' | 'legacy_consumer' | 'related';

export type ComponentGraphNodeData = {
  label: string;
  kind: string;
  subtitle?: string;
  isFocal: boolean;
  role: NodeFlowRole;
  /** Nombre de componente para la API (expandir vecindario). */
  componentName: string;
  expandable: boolean;
  stats: {
    dependsOut: number;
    dependsIn: number;
    legacyOut: number;
    legacyIn: number;
  };
};

export type ComponentGraphRFNode = Node<ComponentGraphNodeData, 'componentGraph'>;

/** Borde izquierdo por tipo de nodo (Controlador, Ruta, DB, Modelo, …). */
function kindAccentClass(kind: string): string {
  const k = kind.toLowerCase();
  if (k.includes('controller') || k.includes('route')) return 'border-l-sky-500';
  if (k.includes('service') || k.includes('module') || k.includes('nest')) return 'border-l-violet-500';
  if (k.includes('model') || k.includes('entity')) return 'border-l-emerald-500';
  if (k.includes('db') || k.includes('database') || k.includes('redis')) return 'border-l-amber-500';
  if (k.includes('hook') || k.includes('util')) return 'border-l-cyan-500';
  return 'border-l-slate-500';
}

const roleCopy: Record<NodeFlowRole, { title: string; tone: string }> = {
  focal: { title: 'Foco', tone: 'text-[var(--primary)]' },
  dependency: { title: 'Dependencia', tone: 'text-sky-400 dark:text-sky-300' },
  legacy_consumer: { title: 'Te usa (legacy)', tone: 'text-amber-500 dark:text-amber-400' },
  related: { title: 'Relacionado', tone: 'text-[var(--foreground-muted)]' },
};

function RoleIcon({ role }: { role: NodeFlowRole }) {
  const cls = 'size-4 shrink-0 opacity-90';
  switch (role) {
    case 'focal':
      return <Radio className={cls} aria-hidden />;
    case 'dependency':
      return <GitBranch className={cls} aria-hidden />;
    case 'legacy_consumer':
      return <Link2 className={cls} aria-hidden />;
    default:
      return <Box className={cls} aria-hidden />;
  }
}

function GraphFlowNodeInner({ data, selected }: NodeProps<ComponentGraphRFNode>) {
  const { label, kind, subtitle, isFocal, role, stats, expandable } = data;
  const rc = roleCopy[role];

  const accent = kindAccentClass(kind);

  return (
    <div
      className={[
        'relative rounded-xl border border-[var(--border)] border-l-[3px] px-3 py-2.5 min-w-[168px] max-w-[260px] w-[240px] shadow-md transition-[box-shadow,transform]',
        accent,
        expandable ? 'cursor-pointer' : '',
        'bg-[var(--card)] text-[var(--foreground)]',
        isFocal
          ? 'ring-2 ring-[var(--primary)] ring-offset-2 ring-offset-[var(--background)] scale-[1.02]'
          : '',
        selected ? 'ring-2 ring-[var(--ring)]' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        isConnectable={false}
        className="!h-3 !w-3 !min-h-0 !min-w-0 !border-2 !border-[var(--border)] !bg-[var(--card)]"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        isConnectable={false}
        className="!h-3 !w-3 !min-h-0 !min-w-0 !border-2 !border-[var(--border)] !bg-[var(--card)]"
      />
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <RoleIcon role={role} />
          <div className="min-w-0">
            <div className={`text-[11px] font-semibold leading-tight ${rc.tone}`}>{rc.title}</div>
            <div
              className="text-[9px] font-bold uppercase tracking-wider text-[var(--foreground-muted)] truncate mt-0.5"
              title={kind}
            >
              {kind}
            </div>
          </div>
        </div>
        {isFocal ? (
          <span className="text-[9px] font-semibold uppercase text-[var(--primary)] shrink-0">★</span>
        ) : null}
      </div>

      <div className="text-sm font-semibold leading-snug break-words border-t border-[var(--border)]/60 pt-2" title={label}>
        {label}
      </div>

      {subtitle ? (
        <div
          className="text-[10px] text-[var(--foreground-muted)] mt-1.5 line-clamp-2 font-mono leading-relaxed"
          title={subtitle}
        >
          {subtitle}
        </div>
      ) : null}

      <div className="mt-2.5 grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] text-[var(--foreground-muted)] border-t border-[var(--border)]/40 pt-2">
        <span title="Aristas depends salientes">→ dep out: {stats.dependsOut}</span>
        <span title="Aristas depends entrantes">← dep in: {stats.dependsIn}</span>
        <span title="Legacy: consumidores (saliente)">↩ legacy out: {stats.legacyOut}</span>
        <span title="Legacy: te usan (entrante)">↪ legacy in: {stats.legacyIn}</span>
      </div>

      {expandable ? (
        <p className="mt-2 text-[9px] text-[var(--foreground-muted)]/90 italic">Clic para traer vecindario (depth 1)</p>
      ) : null}
    </div>
  );
}

export const GraphFlowNode = memo(GraphFlowNodeInner);
