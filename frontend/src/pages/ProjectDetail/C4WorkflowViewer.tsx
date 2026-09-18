/**
 * @fileoverview Workflow Archify con selector de flujos indexados (ruta, enum, job, journey…).
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api';
import { formatC4ArchifyFailure } from '@/utils/c4-archify-error';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

type WorkflowTarget = {
  id: string;
  kind: string;
  label: string;
  description: string;
  routePath?: string | null;
  isDefault?: boolean;
};

function formatTargetLabel(target: WorkflowTarget): string {
  const kindLabels: Record<string, string> = {
    'route-flow': 'Ruta',
    'enum-status': 'Enum',
    'service-chain': 'CALLS',
    journey: 'Journey',
    wizard: 'Wizard',
    job: 'Job',
    langgraph: 'LangGraph',
    cron: 'Cron',
    'sync-pipeline': 'Sync',
  };
  const prefix = kindLabels[target.kind] ?? target.kind;
  return `${prefix}: ${target.label}`;
}

export function C4WorkflowViewer({ projectId }: { projectId: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [targets, setTargets] = useState<WorkflowTarget[]>([]);
  const [selectedTarget, setSelectedTarget] = useState('sync-pipeline');
  const [meta, setMeta] = useState<{ title?: string; targetId?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTargets = useCallback(async () => {
    try {
      const res = await api.listC4WorkflowTargets(projectId);
      setTargets(res.targets);
      setSelectedTarget((current) => {
        if (current && res.targets.some((t) => t.id === current)) return current;
        return res.targets.find((t) => t.isDefault)?.id ?? res.targets[0]?.id ?? 'sync-pipeline';
      });
    } catch {
      setTargets([]);
    }
  }, [projectId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setHtml(await api.getC4WorkflowHtml(projectId, selectedTarget));
    } catch (e) {
      setHtml(null);
      const message = e instanceof Error ? e.message : String(e);
      if (!/^404:/.test(message)) setError(message);
    } finally {
      setLoading(false);
    }
  }, [projectId, selectedTarget]);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await api.generateC4Workflow(projectId, selectedTarget);
      setMeta({ title: res.title, targetId: res.targetId });
      if (res.htmlReady) await load();
      else {
        setError(
          formatC4ArchifyFailure({
            htmlReady: false,
            archifyError: res.archifyError,
            archifyBin: res.archifyBin,
            fallback: 'Workflow generado pero sin HTML Archify.',
          }),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }, [projectId, selectedTarget, load]);

  useEffect(() => {
    void loadTargets();
  }, [loadTargets]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && targets.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="size-4 animate-spin" />
        Cargando workflows…
      </div>
    );
  }

  const selected = targets.find((t) => t.id === selectedTarget);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[min(100%,280px)] flex-1 space-y-1">
          <Label className="text-xs text-muted-foreground">Flujo indexado</Label>
          <Select value={selectedTarget} onValueChange={setSelectedTarget}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Elige un proceso" />
            </SelectTrigger>
            <SelectContent>
              {targets.map((t) => (
                <SelectItem key={t.id} value={t.id} className="text-xs">
                  {formatTargetLabel(t)}
                  {t.isDefault ? ' · recomendado' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" size="sm" disabled={generating} onClick={() => void generate()}>
          {generating ? <Loader2 className="size-4 animate-spin" /> : 'Generar workflow'}
        </Button>
      </div>
      {selected ? (
        <p className="text-xs text-muted-foreground">{selected.description}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Procesos por ruta, enum Prisma, cadenas CALLS, journeys, wizards y jobs indexados en Falkor.
        </p>
      )}
      {meta?.title ? <Badge variant="secondary" className="text-xs">{meta.title}</Badge> : null}
      {error ? <p className="text-xs text-destructive whitespace-pre-wrap">{error}</p> : null}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="size-4 animate-spin" />
          Cargando diagrama…
        </div>
      ) : html ? (
        <iframe
          title="C4 Workflow"
          srcDoc={html}
          className="w-full min-h-[480px] rounded-xl border border-[var(--border)]"
          sandbox="allow-scripts allow-same-origin"
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          Tras un resync verás flujos del proyecto en el selector. Genera el diagrama del proceso elegido.
        </p>
      )}
    </div>
  );
}
