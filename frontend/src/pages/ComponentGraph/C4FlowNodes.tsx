/**
 * Nodos C4: sistema (padre) y contenedor (hijo) para subflows en React Flow.
 */
import { memo } from 'react';
import { type NodeProps } from '@xyflow/react';
import { Box, Database, Globe } from 'lucide-react';
import type { C4ContainerRFNode, C4SystemRFNode } from './c4ArchitectureFlow';

function C4SystemInner({ data }: NodeProps<C4SystemRFNode>) {
  return (
    <div className="rounded-xl border-2 border-dashed border-slate-400/90 dark:border-slate-500 bg-slate-100/40 dark:bg-slate-950/50 shadow-inner h-full w-full min-h-[180px] flex flex-col">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-t-[10px] bg-slate-200/90 dark:bg-slate-800/90 border-b border-slate-300/80 dark:border-slate-600">
        <Globe className="size-4 text-slate-600 dark:text-slate-300 shrink-0" aria-hidden />
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">
            Sistema de software
          </div>
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate" title={data.label}>
            {data.label}
          </div>
        </div>
      </div>
      <div className="flex-1 relative" />
    </div>
  );
}

function toneForKind(kind: string): string {
  if (kind === 'database') return 'border-emerald-500/70 bg-emerald-50/90 dark:bg-emerald-950/40';
  if (kind === 'external') return 'border-slate-400 bg-slate-100/95 dark:bg-slate-800/80';
  return 'border-sky-500/70 bg-sky-50/90 dark:bg-sky-950/35';
}

function C4ContainerInner({ data }: NodeProps<C4ContainerRFNode>) {
  const Icon = data.kind === 'database' ? Database : Box;
  return (
    <div
      className={[
        'rounded-lg border-2 px-2.5 py-2 shadow-md min-w-[168px] max-w-[190px]',
        toneForKind(data.kind),
        'text-slate-900 dark:text-slate-100',
      ].join(' ')}
    >
      <div className="flex items-start gap-2">
        <Icon className="size-3.5 shrink-0 mt-0.5 opacity-80" aria-hidden />
        <div className="min-w-0">
          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Contenedor
          </div>
          <div className="text-xs font-semibold leading-snug break-words">{data.label}</div>
          {data.technology ? (
            <div className="text-[9px] font-mono text-slate-600 dark:text-slate-400 mt-1 truncate" title={data.technology}>
              {data.technology}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export const C4SystemNode = memo(C4SystemInner);
export const C4ContainerNode = memo(C4ContainerInner);
