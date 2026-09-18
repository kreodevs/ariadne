/**
 * @fileoverview Secuencia API Archify con selector de ruta indexada en Falkor.
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

type SequenceRoute = {
  routePath: string;
  screenName: string | null;
  apiSummary: string | null;
  isPublicEntry: boolean;
  hasApiLink: boolean;
  kind?: 'route' | 'api-client';
  screenFilePath?: string | null;
};

function formatRouteLabel(route: SequenceRoute): string {
  if (route.kind === 'api-client') {
    const file = route.screenFilePath?.split('/').pop() ?? route.routePath.split('/').pop();
    const parts = [file ?? 'API client'];
    if (route.apiSummary) parts.push(route.apiSummary);
    return parts.join(' · ');
  }
  const parts = [route.routePath];
  if (route.screenName && route.screenName !== 'API client') parts.push(route.screenName);
  if (route.apiSummary) parts.push(route.apiSummary);
  return parts.join(' · ');
}

export function C4SequenceViewer({ projectId }: { projectId: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [routes, setRoutes] = useState<SequenceRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<string>('');
  const [meta, setMeta] = useState<{ title?: string; synthetic?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRoutes = useCallback(async () => {
    try {
      const res = await api.listC4SequenceRoutes(projectId);
      setRoutes(res.routes);
      setSelectedRoute((current) => {
        if (current) return current;
        const preferred =
          res.routes.find((r) => r.isPublicEntry && r.hasApiLink) ??
          res.routes.find((r) => r.hasApiLink) ??
          res.routes[0];
        return preferred?.routePath ?? '';
      });
    } catch {
      setRoutes([]);
    }
  }, [projectId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setHtml(await api.getC4SequenceHtml(projectId));
    } catch (e) {
      setHtml(null);
      const message = e instanceof Error ? e.message : String(e);
      // Sin secuencia generada aún: estado vacío, no error de Archify.
      if (!/^404:/.test(message)) {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await api.generateC4Sequence(
        projectId,
        selectedRoute.trim() || undefined,
      );
      setMeta({ title: res.title, synthetic: res.synthetic });
      if (res.htmlReady) await load();
      else {
        setError(
          formatC4ArchifyFailure({
            htmlReady: false,
            archifyError: res.archifyError,
            archifyBin: res.archifyBin,
            fallback: 'Secuencia generada pero sin HTML Archify.',
          }),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }, [projectId, selectedRoute, load]);

  useEffect(() => {
    void loadRoutes();
  }, [loadRoutes]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="size-4 animate-spin" />
        Cargando secuencia API…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[min(100%,320px)] flex-1 space-y-1">
          <Label className="text-xs text-muted-foreground">Ruta indexada</Label>
          {routes.length > 0 ? (
            <Select value={selectedRoute} onValueChange={setSelectedRoute}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Elige una ruta o flujo API" />
              </SelectTrigger>
              <SelectContent>
                {routes.map((route) => (
                  <SelectItem
                    key={`${route.kind ?? 'route'}:${route.routePath}`}
                    value={route.routePath}
                    className="text-xs"
                  >
                    {formatRouteLabel(route)}
                    {route.kind === 'api-client' ? ' · cliente API' : ''}
                    {route.isPublicEntry ? ' · entrada' : ''}
                    {!route.hasApiLink ? ' · sin API' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-xs text-muted-foreground">
              Sin rutas ni clientes API en Falkor. Haz sync del frontend y vuelve a intentar.
            </p>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          disabled={generating || (routes.length > 0 && !selectedRoute)}
          onClick={() => void generate()}
        >
          {generating ? <Loader2 className="size-4 animate-spin" /> : 'Generar secuencia API'}
        </Button>
      </div>

      {meta?.title ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{meta.title}</span>
          {meta.synthetic ? (
            <Badge variant="outline" className="text-xs">Flujo sintético</Badge>
          ) : (
            <Badge variant="secondary" className="text-xs">Desde Falkor</Badge>
          )}
        </div>
      ) : null}

      {error ? <p className="text-xs text-destructive whitespace-pre-wrap">{error}</p> : null}
      {html ? (
        <iframe
          title="C4 Sequence"
          srcDoc={html}
          className="w-full min-h-[480px] rounded-xl border border-[var(--border)]"
          sandbox="allow-scripts allow-same-origin"
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          Elige una ruta y genera el flujo Route → pantalla → API Nest → persistencia con nombres del
          monorepo.
        </p>
      )}
    </div>
  );
}
