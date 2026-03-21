/**
 * @fileoverview Página de chat con repo: NL→Cypher, Diagnóstico, Duplicados, Reingeniería, Full Audit, Ver índice.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MarkdownBlock } from '@/components/MarkdownBlock';
import { api } from '../api';
import type { Repository } from '../types';
import { Button } from '@/components/ui/button';
import { FullAuditModal } from './RepoChat/FullAuditModal';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';

/** Mensaje del chat: user o assistant, contenido, cypher opcional y resultado. */
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  cypher?: string;
  result?: unknown[];
}

const ANALYSIS_MODE_LABELS: Record<string, string> = {
  diagnostico: 'Diagnóstico',
  duplicados: 'Duplicados',
  reingenieria: 'Reingeniería',
  codigo_muerto: 'Código muerto',
  agents: 'AGENTS',
  skill: 'SKILL',
};
const ANALYSIS_RESULT_TITLES: Record<string, string> = {
  diagnostico: 'Deuda técnica',
  duplicados: 'Código duplicado',
  codigo_muerto: 'Código muerto',
  reingenieria: 'Reingeniería',
  agents: 'AGENTS.md',
  skill: 'SKILL.md',
};

/**
 * Página de chat con repo: preguntas NL→Cypher, botones de análisis (Diagnóstico, Duplicados, Reingeniería, Código muerto, Full Audit) y visor de índice.
 * Layout split: izquierda = resultado del análisis; derecha = historial de mensajes y input.
 */
export function RepoChat() {
  const { id } = useParams<{ id: string }>();
  const [repo, setRepo] = useState<Repository | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<{ mode: string; summary: string } | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [fullAuditOpen, setFullAuditOpen] = useState(false);
  const [fullAuditData, setFullAuditData] = useState<import('../types').FullAuditResult | null>(null);
  const [fullAuditLoading, setFullAuditLoading] = useState(false);
  const [fullAuditError, setFullAuditError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    api
      .getRepository(id)
      .then(setRepo)
      .catch((e) => setError(e.message));
  }, [id]);

  const runAnalysis = useCallback(
    (mode: 'diagnostico' | 'duplicados' | 'reingenieria' | 'codigo_muerto' | 'agents' | 'skill') => {
      if (!id) return;
      setLoadingAnalysis(mode);
      setAnalysisError(null);
      setError(null);
      api
        .analyze(id, mode)
        .then((res) => setAnalysisResult({ mode: res.mode, summary: res.summary }))
        .catch((e) => {
          setAnalysisError(e.message);
        })
        .finally(() => setLoadingAnalysis(null));
    },
    [id],
  );

  const runFullAudit = useCallback(() => {
    if (!id) return;
    setFullAuditOpen(true);
    setFullAuditLoading(true);
    setFullAuditError(null);
    setFullAuditData(null);
    api
      .getFullAudit(id)
      .then(setFullAuditData)
      .catch((e) => setFullAuditError(e.message))
      .finally(() => setFullAuditLoading(false));
  }, [id]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = useCallback(() => {
    if (!id || !input.trim() || loading) return;
    const msg = input.trim();
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: msg }]);
    setLoading(true);
    setError(null);

    const history = messages.slice(-6).map((m) => ({
      role: m.role,
      content: m.content,
      cypher: m.cypher,
      result: m.result,
    }));

    api
      .chat(id, { message: msg, history })
      .then((res) => {
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            content: res.answer,
            cypher: res.cypher,
            result: res.result,
          },
        ]);
      })
      .catch((e) => {
        setError(e.message);
        setMessages((m) => [...m, { role: 'assistant', content: `Error: ${e.message}` }]);
      })
      .finally(() => setLoading(false));
  }, [id, input, loading, messages]);

  /** Envía mensaje con Enter (sin Shift). */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  if (!id) return null;
  if (error && !repo) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/">← Repos</Link>
        </Button>
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }
  if (!repo) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/">← Repos</Link>
        </Button>
        <Card>
          <CardHeader>
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-48 mt-2" />
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="flex shrink-0 items-center gap-2 pb-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/">← Repos</Link>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/repos/${id}`}>Detalle</Link>
        </Button>
        <span className="text-muted-foreground">
          Chat con {repo.projectKey}/{repo.repoSlug}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Izquierda: diagnósticos e índice */}
        <aside className="flex w-[min(420px,45%)] shrink-0 flex-col gap-4 overflow-y-auto border-r pr-4">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => runAnalysis('diagnostico')}
              disabled={!!loadingAnalysis}
            >
              {loadingAnalysis === 'diagnostico' ? '…' : 'Diagnóstico'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => runAnalysis('duplicados')}
              disabled={!!loadingAnalysis}
            >
              {loadingAnalysis === 'duplicados' ? '…' : 'Duplicados'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => runAnalysis('reingenieria')}
              disabled={!!loadingAnalysis}
            >
              {loadingAnalysis === 'reingenieria' ? '…' : 'Reingeniería'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => runAnalysis('codigo_muerto')}
              disabled={!!loadingAnalysis}
            >
              {loadingAnalysis === 'codigo_muerto' ? '…' : 'Código muerto'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => runAnalysis('agents')}
              disabled={!!loadingAnalysis}
              title="Genera AGENTS.md para agentes AI (protocolo, herramientas, flujos)"
            >
              {loadingAnalysis === 'agents' ? '…' : 'AGENTS'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => runAnalysis('skill')}
              disabled={!!loadingAnalysis}
              title="Genera SKILL.md para Cursor/Claude (instrucciones, ejemplos, troubleshooting)"
            >
              {loadingAnalysis === 'skill' ? '…' : 'SKILL'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={runFullAudit}
              disabled={!!loadingAnalysis}
              title="Auditoría completa: arquitectura, seguridad, deuda técnica"
            >
              Full Audit
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/repos/${id}/index`}>Ver índice</Link>
            </Button>
          </div>
          <FullAuditModal
            open={fullAuditOpen}
            onOpenChange={setFullAuditOpen}
            data={fullAuditData}
            loading={fullAuditLoading}
            error={fullAuditError}
          />

          {loadingAnalysis && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {ANALYSIS_MODE_LABELS[loadingAnalysis] ?? loadingAnalysis}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 py-6 text-muted-foreground">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Analizando…
                </div>
              </CardContent>
            </Card>
          )}

          {analysisError && !loadingAnalysis && (
            <Alert variant="destructive">
              <AlertTitle>Error en el análisis</AlertTitle>
              <AlertDescription>{analysisError}</AlertDescription>
            </Alert>
          )}

          {analysisResult && !loadingAnalysis && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {ANALYSIS_RESULT_TITLES[analysisResult.mode] ?? analysisResult.mode}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className={`overflow-auto rounded border bg-muted/50 p-3 text-sm [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 [&_p]:my-1 [&_strong]:font-semibold [&_pre]:overflow-x-auto [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_table]:w-full [&_th]:text-left [&_th]:border [&_td]:border [&_td]:px-2 [&_td]:py-1 ${
                    analysisResult.mode === 'codigo_muerto' ? 'max-h-[75vh]' : 'max-h-[50vh]'
                  }`}
                >
                  <MarkdownBlock
                    content={typeof analysisResult.summary === 'string' ? analysisResult.summary : String(analysisResult.summary ?? '')}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {!analysisResult && !loadingAnalysis && !analysisError && !fullAuditOpen && (
            <p className="text-muted-foreground py-8 text-center text-sm">
              Usa los botones para ver diagnósticos, Full Audit o el índice FalkorDB.
            </p>
          )}
        </aside>

        {/* Derecha: chat */}
        <Card className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <CardHeader className="shrink-0 pb-2">
            <CardTitle>Pregunta sobre el código</CardTitle>
            <p className="text-sm text-muted-foreground">
              Ej: &quot;¿Qué componentes usan el hook useState?&quot;, &quot;Archivos que importan X&quot;
            </p>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4 overflow-hidden p-4">
            {error && (
              <Alert variant="destructive" className="shrink-0">
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex-1 space-y-4 overflow-y-auto pr-2">
            {messages.length === 0 && (
              <p className="text-muted-foreground py-8 text-center text-sm">
                Escribe una pregunta en lenguaje natural. El modelo la convertirá en Cypher y ejecutará
                contra el grafo indexado.
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === 'user'
                    ? 'ml-8 rounded-lg bg-primary/10 p-3 text-sm'
                    : 'mr-8 rounded-lg border bg-muted/50 p-3 text-sm'
                }
              >
                <div className="[&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 [&_p]:my-1 [&_strong]:font-semibold [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_pre]:overflow-x-auto [&_table]:w-full [&_th]:border [&_td]:border [&_td]:px-2 [&_td]:py-1">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ children }) => (children ? <p className="mb-1 last:mb-0">{children}</p> : null),
                      ul: ({ children }) => <ul className="list-disc pl-4 my-1">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal pl-4 my-1">{children}</ol>,
                      strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                      table: ({ children }) => (
                        <div className="overflow-x-auto my-2">
                          <table className="w-full text-xs border-collapse">{children}</table>
                        </div>
                      ),
                      th: ({ children }) => (
                        <th className="px-2 py-1 border bg-muted/80 font-medium text-left">{children}</th>
                      ),
                      td: ({ children }) => <td className="px-2 py-1 border">{children}</td>,
                      code: ({ className, children, ...props }) => {
                        const isBlock = className?.includes('language-');
                        return isBlock ? (
                          <pre className="my-2 rounded bg-muted p-2 text-xs font-mono overflow-x-auto">
                            <code {...props}>{children}</code>
                          </pre>
                        ) : (
                          <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono" {...props}>
                            {children}
                          </code>
                        );
                      },
                    }}
                  >
                    {m.content}
                  </ReactMarkdown>
                </div>
                {m.cypher && (
                  <pre className="mt-2 rounded bg-muted p-2 text-xs font-mono overflow-x-auto">
                    {m.cypher}
                  </pre>
                )}
              </div>
            ))}
            {loading && (
              <div className="mr-8 flex items-center gap-2 rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
                <span className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Pensando… (puede tardar unos segundos)
              </div>
            )}
            <div ref={scrollRef} />
            </div>

            <div className="flex shrink-0 gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="¿Qué quieres saber del repo?"
                rows={2}
                className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                disabled={loading}
              />
              <Button onClick={send} disabled={loading || !input.trim()} className="self-end">
                Enviar
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
