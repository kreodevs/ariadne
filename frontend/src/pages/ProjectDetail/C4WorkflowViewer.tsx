/**
 * @fileoverview Workflow Archify del pipeline full-sync.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api';
import { formatC4ArchifyFailure } from '@/utils/c4-archify-error';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

export function C4WorkflowViewer({ projectId }: { projectId: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ title?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setHtml(await api.getC4WorkflowHtml(projectId));
    } catch (e) {
      setHtml(null);
      const message = e instanceof Error ? e.message : String(e);
      if (!/^404:/.test(message)) setError(message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await api.generateC4Workflow(projectId);
      setMeta({ title: res.title });
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
  }, [projectId, load]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="size-4 animate-spin" />
        Cargando workflow…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" disabled={generating} onClick={() => void generate()}>
          {generating ? <Loader2 className="size-4 animate-spin" /> : 'Generar workflow sync'}
        </Button>
        {meta?.title ? <Badge variant="secondary" className="text-xs">{meta.title}</Badge> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Proceso full-sync: mapping → indexing → Falkor → embeddings → C4 (Archify workflow).
      </p>
      {error ? <p className="text-xs text-destructive whitespace-pre-wrap">{error}</p> : null}
      {html ? (
        <iframe
          title="C4 Workflow"
          srcDoc={html}
          className="w-full min-h-[480px] rounded-xl border border-[var(--border)]"
          sandbox="allow-scripts allow-same-origin"
        />
      ) : (
        <p className="text-xs text-muted-foreground">Genera el diagrama de proceso del pipeline de indexación.</p>
      )}
    </div>
  );
}
