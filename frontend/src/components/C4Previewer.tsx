/**
 * @fileoverview Previsualización C4 vía Kroki (POST plantuml/svg).
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const LEVELS = [
  { value: 1 as const, label: 'Contexto' },
  { value: 2 as const, label: 'Contenedor' },
  { value: 3 as const, label: 'Componente' },
];

export function C4Previewer({
  projectId,
  level,
  onLevelChange,
  shadowMode,
  onShadowModeChange,
  sessionId,
  onSessionIdChange,
}: {
  projectId: string;
  level: 1 | 2 | 3;
  onLevelChange: (l: 1 | 2 | 3) => void;
  shadowMode: boolean;
  onShadowModeChange: (v: boolean) => void;
  sessionId: string;
  onSessionIdChange: (v: string) => void;
}) {
  const [dsl, setDsl] = useState('');
  const [loading, setLoading] = useState(false);
  const [krokiError, setKrokiError] = useState<string | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const prevUrl = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setKrokiError(null);
    (async () => {
      try {
        const sid = shadowMode && sessionId.trim() ? sessionId.trim() : undefined;
        const r = await api.getProjectArchitectureC4(projectId, { level, sessionId: sid });
        if (cancelled) return;
        setDsl(r.dsl);
        const res = await fetch('https://kroki.io/plantuml/svg', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          body: r.dsl,
        });
        if (!res.ok) {
          throw new Error(`Kroki ${res.status}`);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        if (prevUrl.current) URL.revokeObjectURL(prevUrl.current);
        prevUrl.current = url;
        setImgUrl(url);
        setKrokiError(null);
      } catch (e) {
        if (!cancelled) {
          setKrokiError(e instanceof Error ? e.message : String(e));
          setImgUrl(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, level, shadowMode, sessionId]);

  useEffect(() => {
    return () => {
      if (prevUrl.current) URL.revokeObjectURL(prevUrl.current);
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        {LEVELS.map((lv) => (
          <Button
            key={lv.value}
            type="button"
            size="sm"
            variant={level === lv.value ? 'default' : 'outline'}
            onClick={() => onLevelChange(lv.value)}
          >
            {lv.label}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 items-end">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="shadow-mode"
            checked={shadowMode}
            onChange={(e) => onShadowModeChange(e.target.checked)}
            className="rounded border-input"
          />
          <Label htmlFor="shadow-mode" className="text-sm font-normal cursor-pointer">
            Shadow mode (Visual SDD)
          </Label>
        </div>
        {shadowMode ? (
          <div className="space-y-1 min-w-[200px]">
            <Label htmlFor="shadow-sid">sessionId</Label>
            <Input
              id="shadow-sid"
              value={sessionId}
              onChange={(e) => onSessionIdChange(e.target.value)}
              placeholder="FalkorSpecsShadow:…"
              className="font-mono text-xs"
            />
          </div>
        ) : null}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Generando diagrama…</p>
      ) : krokiError ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
          Kroki no disponible desde el navegador ({krokiError}). DSL abajo — úsalo en{' '}
          <a href="https://kroki.io" className="underline" target="_blank" rel="noreferrer">
            kroki.io
          </a>
          .
        </div>
      ) : imgUrl ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-2 overflow-auto">
          <img src={imgUrl} alt="Diagrama C4" className="max-w-full h-auto mx-auto" />
        </div>
      ) : null}

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">DSL PlantUML</summary>
        <pre className="mt-2 p-3 rounded-md bg-muted overflow-auto max-h-64 font-mono whitespace-pre-wrap">{dsl}</pre>
      </details>
    </div>
  );
}
