import { memo } from 'react';
import { type Node, type NodeProps } from '@xyflow/react';

export type ComponentGraphNodeData = {
  label: string;
  kind: string;
  /** Ruta completa si aporta contexto respecto al label corto */
  subtitle?: string;
  isFocal: boolean;
};

export type ComponentGraphRFNode = Node<ComponentGraphNodeData, 'componentGraph'>;

function GraphFlowNodeInner({ data, selected }: NodeProps<ComponentGraphRFNode>) {
  const { label, kind, subtitle, isFocal } = data;

  return (
    <div
      className={[
        'rounded-lg border px-3 py-2 min-w-[140px] max-w-[220px] shadow-sm transition-[box-shadow,transform]',
        'bg-[var(--card)] border-[var(--border)] text-[var(--foreground)]',
        isFocal
          ? 'ring-2 ring-[var(--primary)] ring-offset-2 ring-offset-[var(--background)] scale-[1.02]'
          : '',
        selected ? 'ring-2 ring-[var(--ring)]' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--muted)] text-[var(--foreground-muted)] truncate max-w-[100px]"
          title={kind}
        >
          {kind}
        </span>
        {isFocal ? (
          <span className="text-[10px] font-medium text-[var(--primary)] shrink-0">foco</span>
        ) : null}
      </div>
      <div className="text-sm font-medium leading-snug break-words" title={label}>
        {label}
      </div>
      {subtitle ? (
        <div
          className="text-[10px] text-[var(--foreground-muted)] mt-1 truncate font-mono"
          title={subtitle}
        >
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}

export const GraphFlowNode = memo(GraphFlowNodeInner);
