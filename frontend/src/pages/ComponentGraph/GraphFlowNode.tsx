import { memo } from 'react';
import { type Node, type NodeProps } from '@xyflow/react';
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

  return (
    <div
      className={[
        'rounded-xl border px-3 py-2.5 min-w-[168px] max-w-[260px] shadow-md transition-[box-shadow,transform]',
        expandable ? 'cursor-pointer' : '',
        'bg-[var(--card)] border-[var(--border)] text-[var(--foreground)]',
        isFocal
          ? 'ring-2 ring-[var(--primary)] ring-offset-2 ring-offset-[var(--background)] scale-[1.02]'
          : '',
        selected ? 'ring-2 ring-[var(--ring)]' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
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
