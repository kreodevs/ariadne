/**
 * @fileoverview Lifecycle Archify: sync job y request HTTP.
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
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

type LifecycleTarget = { id: string; label: string; description: string };

export function C4LifecycleViewer({ projectId }: { projectId: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [targets, setTargets] = useState<LifecycleTarget[]>([]);
  const [selectedTarget, setSelectedTarget] = useState('sync-job');
  const [routePath, setRoutePath] = useState('');
  const [meta, setMeta] = useState<{ title?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTargets = useCallback(async () => {
    try {
      const res = await api.listC4LifecycleTargets(projectId);
      setTargets(res.targets);
      setSelectedTarget((current) => current || res.targets[0]?.id || 'sync-job');
    } catch {
      setTargets([]);
    }
  }, [projectId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setHtml(await api.getC4LifecycleHtml(projectId, selectedTarget));
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
      const res = await api.generateC4Lifecycle(
        projectId,
        selectedTarget,
        selectedTarget === 'api-request' ? routePath.trim() || undefined : undefined,
      );
      setMeta({ title: res.title });
      if (res.htmlReady) await load();
      else {
        setError(
          formatC4ArchifyFailure({
            htmlReady: false,
            archifyError: res.archifyError,
            archifyBin: res.archifyBin,
            fallback: 'Lifecycle generado pero sin HTML Archify.',
          }),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }, [projectId, selectedTarget, routePath, load]);

  useEffect(() => {
    void loadTargets();
  }, [loadTargets]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="size-4 animate-spin" />
        Cargando lifecycle…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[min(100%,240px)] space-y-1">
          <Label className="text-xs text-muted-foreground">Tipo de lifecycle</Label>
          <Select value={selectedTarget} onValueChange={setSelectedTarget}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Elige lifecycle" />
            </SelectTrigger>
            <SelectContent>
              {targets.map((t) => (
                <SelectItem key={t.id} value={t.id} className="text-xs">
                  {t.label} — {t.description}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {selectedTarget === 'api-request' ? (
          <div className="min-w-[min(100%,240px)] flex-1 space-y-1">
            <Label className="text-xs text-muted-foreground">Ruta UI (opcional)</Label>
            <Input
              className="h-9 text-xs"
              value={routePath}
              onChange={(e) => setRoutePath(e.target.value)}
              placeholder="/admin/evento/$eventId/configuracion"
            />
          </div>
        ) : null}
        <Button type="button" size="sm" disabled={generating} onClick={() => void generate()}>
          {generating ? <Loader2 className="size-4 animate-spin" /> : 'Generar lifecycle'}
        </Button>
      </div>
      {meta?.title ? <Badge variant="secondary" className="text-xs">{meta.title}</Badge> : null}
      {error ? <p className="text-xs text-destructive whitespace-pre-wrap">{error}</p> : null}
      {html ? (
        <iframe
          title="C4 Lifecycle"
          srcDoc={html}
          className="w-full min-h-[480px] rounded-xl border border-[var(--border)]"
          sandbox="allow-scripts allow-same-origin"
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          Estados y transiciones del sync job o del ciclo request/response HTTP.
        </p>
      )}
    </div>
  );
}
