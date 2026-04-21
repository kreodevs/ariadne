/**
 * Modo de pipeline para POST /chat: default | evidence_first (MDD) | raw_evidence + deterministicRetriever.
 */
import type { ChatPipelineMode } from '@/types';

const OPTIONS: { value: ChatPipelineMode; label: string; hint: string }[] = [
  {
    value: 'default',
    label: 'Chat normal',
    hint: 'Prosa; ReAct en retrieve (hasta 4 vueltas LLM en backend).',
  },
  {
    value: 'evidence_first',
    label: 'MDD / SDD (recomendado)',
    hint: 'Una petición: JSON MDD 7 secciones desde Ariadne (menos idas y vueltas que varios MCP).',
  },
  {
    value: 'raw_evidence_fast',
    label: 'Evidencia bruta (barato)',
    hint: 'Sin LLM en retrieve; JSON para sintetizar fuera o depurar 429.',
  },
];

export function ChatPipelineModeSelect({
  value,
  onChange,
  id,
}: {
  value: ChatPipelineMode;
  onChange: (v: ChatPipelineMode) => void;
  id?: string;
}) {
  const baseId = id ?? 'chat-pipeline-mode';
  return (
    <fieldset className="space-y-2 rounded-md border border-dashed border-[var(--border)] p-3 text-xs">
      <legend className="text-muted-foreground px-1 font-medium">Modo Ariadne (The Forge)</legend>
      <div className="space-y-2">
        {OPTIONS.map((opt) => (
          <label key={opt.value} className="flex cursor-pointer items-start gap-2">
            <input
              type="radio"
              name={baseId}
              className="mt-1"
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
            />
            <span>
              <span className="font-medium text-foreground">{opt.label}</span>
              <span className="text-muted-foreground block leading-snug">{opt.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
