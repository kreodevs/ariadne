/**
 * Panel colapsable: consulta Cypher contra Falkor vía API Nest (misma conexión que getComponentGraph).
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function escapeCypherString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

type Props = {
  graphProjectId: string;
  prefillComponentName?: string;
  /** Ocultar en vista C4. */
  hidden?: boolean;
};

export function ComponentGraphDebugPanel({ graphProjectId, prefillComponentName, hidden }: Props) {
  const defaultQuery = useMemo(() => {
    const pid = graphProjectId.trim();
    if (!pid) {
      return 'MATCH (n) RETURN count(n) AS c LIMIT 1';
    }
    const cn = prefillComponentName?.trim();
    if (cn) {
      return [
        `MATCH (c:Component { name: '${escapeCypherString(cn)}', projectId: '${escapeCypherString(pid)}' })`,
        `RETURN c`,
        `LIMIT 25`,
      ].join('\n');
    }
    return [
      `MATCH (c:Component { projectId: '${escapeCypherString(pid)}' })`,
      `RETURN c.name AS name, labels(c) AS labels`,
      `LIMIT 50`,
    ].join('\n');
  }, [graphProjectId, prefillComponentName]);

  const [query, setQuery] = useState(defaultQuery);
  useEffect(() => {
    setQuery(defaultQuery);
  }, [defaultQuery]);

  const [graphNameOverride, setGraphNameOverride] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resultJson, setResultJson] = useState<string | null>(null);

  const run = () => {
    setErr(null);
    setResultJson(null);
    setLoading(true);
    void (async () => {
      try {
        const r = await api.postFalkorDebugQuery({
          query,
          projectId: graphProjectId.trim() || undefined,
          graphName: graphNameOverride.trim() || undefined,
        });
        setResultJson(JSON.stringify(r, null, 2));
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  };

  if (hidden) return null;

  return (
    <details className="group rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)]">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-200 group-open:rotate-90" />
        Falkor (Cypher vía API)
        <span className="text-xs font-normal text-[var(--foreground-muted)]">
          misma conexión que Nest — activar FALKOR_DEBUG_CYPHER=1
        </span>
      </summary>
      <div className="border-t border-[var(--border)] space-y-3 p-3">
        <p className="text-xs text-[var(--foreground-muted)] leading-relaxed">
          No es el contenedor desde el navegador: el front llama a{' '}
          <span className="font-mono">POST /api/graph/falkor-debug-query</span> y Nest ejecuta en Falkor con{' '}
          <span className="font-mono">FalkorService</span>. Así validas que los datos coinciden con lo que devuelve{' '}
          <span className="font-mono">getComponentGraph</span> sin exponer Redis.
        </p>
        <div className="space-y-1">
          <Label htmlFor="falkor-graph-name">graphName (opcional, shard explícito)</Label>
          <Input
            id="falkor-graph-name"
            value={graphNameOverride}
            onChange={(e) => setGraphNameOverride(e.target.value)}
            placeholder="Vacío = grafo por projectId (routing habitual)"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="falkor-query">Cypher (solo lectura)</Label>
          <textarea
            id="falkor-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
            className="min-h-[160px] w-full resize-y rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs font-mono text-[var(--foreground)] placeholder:text-[var(--foreground-muted)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={run} disabled={loading || !query.trim()}>
            {loading ? 'Ejecutando…' : 'Ejecutar'}
          </Button>
        </div>
        {err ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive whitespace-pre-wrap">
            {err}
          </div>
        ) : null}
        {resultJson ? (
          <pre className="max-h-[min(480px,55vh)] overflow-auto rounded-md border border-[var(--border)] bg-[var(--muted)]/40 p-3 text-[11px] leading-relaxed font-mono text-[var(--foreground)]">
            {resultJson}
          </pre>
        ) : null}
      </div>
    </details>
  );
}
