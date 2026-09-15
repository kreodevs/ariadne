/**
 * @fileoverview Visor HTML Archify (C4 context/container/component) vía API autenticada.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatC4ArchifyFailure } from '@/utils/c4-archify-error';
import { C4EvidencePanel } from './C4EvidencePanel';
import { C4SnapshotCompare } from './C4SnapshotCompare';

export type C4DiagramLevel = 'context' | 'container' | 'component';

type C4Evidence = { source: string; reason?: string; filePath?: string; nodeId?: string };
type C4Element = {
  id: string;
  kind: string;
  name: string;
  containerKey?: string;
  evidence?: C4Evidence[];
};

function isLlmAssisted(el: C4Element): boolean {
  return (el.evidence ?? []).some((e) => e.source === 'llm');
}

const LEVEL_LABELS: Record<C4DiagramLevel, string> = {
  context: 'Context',
  container: 'Container',
  component: 'Component',
};

export function C4DiagramViewer({
  projectId,
  level,
  containerKey,
  scopeKey,
}: {
  projectId: string;
  level: C4DiagramLevel;
  containerKey?: string;
  scopeKey: string;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [elements, setElements] = useState<C4Element[]>([]);
  const [generator, setGenerator] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ htmlReady?: boolean; hasModel?: boolean } | null>(null);
  const [useLlm, setUseLlm] = useState(false);
  const [componentKey, setComponentKey] = useState(containerKey ?? '');

  const applyModel = useCallback((model: { elements?: C4Element[]; generator?: string }) => {
    setElements(model.elements ?? []);
    setGenerator(model.generator ?? null);
  }, []);

  const loadHtml = useCallback(async () => {
    setLoading(true);
    setError(null);
    let hasModel = false;
    try {
      const res = await api.getC4Model(projectId, level);
      const model = res.model as {
        elements?: C4Element[];
        generator?: string;
      };
      applyModel(model);
      hasModel = true;
      setMeta({ htmlReady: res.htmlReady, hasModel: true });

      const doc = await api.getC4Html(projectId, level);
      setHtml(doc);
      setMeta({ htmlReady: true, hasModel: true });
    } catch (e) {
      setHtml(null);
      if (hasModel) {
        setMeta((prev) => ({ ...prev, htmlReady: false, hasModel: true }));
        setError(
          formatC4ArchifyFailure({
            htmlReady: false,
            fallback:
              'Modelo C4 guardado pero el diagrama HTML no está disponible. Pulsa «Regenerar diagrama» para crearlo.',
          }),
        );
      } else {
        setElements([]);
        setGenerator(null);
        setMeta({ hasModel: false });
        const msg = e instanceof Error ? e.message : String(e);
        if (/404/i.test(msg) && /sin snapshot/i.test(msg)) {
          setError(null);
        } else {
          setError(msg);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [projectId, level, applyModel]);

  const regenerate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await api.generateC4(projectId, {
        level,
        useLlm: level === 'context' ? useLlm : false,
        containerKey: level === 'component' ? componentKey.trim() || undefined : undefined,
      });
      const single = res as {
        htmlReady?: boolean;
        archifyError?: string | null;
        archifyBin?: string | null;
        model?: { elements?: C4Element[]; generator?: string };
      };
      setMeta({ htmlReady: single.htmlReady });
      if (single.model?.elements) setElements(single.model.elements);
      if (single.model?.generator) setGenerator(single.model.generator);
      if (single.htmlReady) {
        await loadHtml();
      } else {
        setError(
          formatC4ArchifyFailure({
            htmlReady: false,
            archifyError: single.archifyError,
            archifyBin: single.archifyBin,
            fallback:
              'Modelo C4 guardado pero HTML no generado. Revisa Archify en Ajustes → Sistema y vuelve a generar.',
          }),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }, [projectId, level, useLlm, componentKey, loadHtml]);

  useEffect(() => {
    void loadHtml();
  }, [loadHtml]);

  useEffect(() => {
    if (containerKey) setComponentKey(containerKey);
  }, [containerKey]);

  const levelLabel = LEVEL_LABELS[level];
  const componentElements = elements.filter((e) => e.kind === 'component');

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
        <Loader2 className="size-4 animate-spin" />
        Cargando diagrama C4 {levelLabel}…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" disabled={generating} onClick={() => void regenerate()}>
          {generating ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Generando…
            </>
          ) : (
            'Regenerar diagrama'
          )}
        </Button>
        {level === 'context' ? (
          <div className="flex items-center gap-2">
            <input
              id={`c4-llm-${projectId}`}
              type="checkbox"
              className="size-4 rounded border border-[var(--border)]"
              checked={useLlm}
              onChange={(e) => setUseLlm(e.target.checked)}
            />
            <Label htmlFor={`c4-llm-${projectId}`} className="text-xs font-normal cursor-pointer">
              Narrativa LLM (actores + descripciones)
            </Label>
          </div>
        ) : null}
        {level === 'component' ? (
          <div className="flex items-center gap-2 min-w-[200px]">
            <Label className="text-xs text-muted-foreground shrink-0">Container</Label>
            <Input
              className="h-8 text-xs"
              placeholder="ej. frontend, ingest"
              value={componentKey}
              onChange={(e) => setComponentKey(e.target.value)}
            />
          </div>
        ) : null}
        {generator ? (
          <Badge variant="outline" className="text-xs">
            {generator === 'hybrid' ? 'LLM asistido' : 'Determinista'}
          </Badge>
        ) : null}
        {meta?.htmlReady === false ? (
          <span className="text-xs text-muted-foreground">JSON C4 sin HTML Archify</span>
        ) : null}
      </div>

      {elements.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {elements
            .filter((e) => e.kind !== 'container' || level !== 'component')
            .slice(0, 24)
            .map((el) => (
              <Badge
                key={el.id}
                variant="secondary"
                className={cn('text-xs font-normal', isLlmAssisted(el) && 'border-violet-500/40')}
              >
                {el.name}
                <span className="ml-1 opacity-60">({el.kind})</span>
                {isLlmAssisted(el) ? <span className="ml-1 text-violet-600">LLM</span> : null}
              </Badge>
            ))}
        </div>
      ) : null}

      {level === 'component' && componentElements.length > 0 ? (
        <C4EvidencePanel projectId={projectId} scopeKey={scopeKey} elements={componentElements} />
      ) : null}

      <C4SnapshotCompare projectId={projectId} level={level} />

      {error ? (
        <Alert variant={meta?.hasModel ? 'default' : 'destructive'}>
          <AlertTitle>Diagrama C4 {levelLabel}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p className="whitespace-pre-wrap text-sm">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void regenerate()}>
              Generar ahora
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {html ? (
        <iframe
          title={`C4 ${levelLabel}`}
          srcDoc={html}
          className="w-full min-h-[640px] rounded-2xl border border-[var(--border)] bg-[var(--card)]"
          sandbox="allow-scripts allow-same-origin"
        />
      ) : !error ? (
        <p className="text-sm text-muted-foreground">
          Sin diagrama {levelLabel}. Pulsa «Regenerar diagrama» para crearlo
          {level === 'context'
            ? ' desde dominios y whitelist del proyecto.'
            : level === 'component'
              ? ' desde el subgrafo Falkor del container (requiere sync previo).'
              : ' desde docker-compose.'}
        </p>
      ) : null}
    </div>
  );
}
