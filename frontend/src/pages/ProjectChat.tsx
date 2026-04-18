/**
 * @fileoverview Chat a nivel proyecto: consulta el grafo de todos los repos del proyecto.
 * Multi-root: opción chat amplio (`strictChatScope: false`). Análisis por repo con alcance opcional; AGENTS/SKILL a nivel proyecto.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MarkdownBlock } from '@/components/MarkdownBlock';
import { AnalyzeReportMetaBadges } from '@/components/analyze/AnalyzeReportMetaBadges';
import { AnalyzeScopeFields } from '@/components/analyze/AnalyzeScopeFields';
import { api } from '../api';
import type { AnalyzeCodeMode, AnalyzeReportMeta, Project } from '../types';
import { scopeFromAnalyzeForm } from '../utils/analyze-scope-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
  seguridad: 'Seguridad',
  agents: 'AGENTS',
  skill: 'SKILL',
};

const ANALYSIS_RESULT_TITLES: Record<string, string> = {
  diagnostico: 'Deuda técnica',
  duplicados: 'Código duplicado',
  codigo_muerto: 'Código muerto',
  reingenieria: 'Reingeniería',
  seguridad: 'Auditoría de seguridad',
  agents: 'AGENTS.md',
  skill: 'SKILL.md',
};

/** Chat a nivel proyecto: consulta el grafo de todos los repos del proyecto (POST /projects/:id/chat). */
export function ProjectChat() {
  const { id: projectId } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<{
    mode: string;
    summary: string;
    reportMeta?: AnalyzeReportMeta;
  } | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [selectedRepoId, setSelectedRepoId] = useState<string>('');
  const [includePrefixesText, setIncludePrefixesText] = useState('');
  const [excludeGlobsText, setExcludeGlobsText] = useState('');
  const [crossPackageDuplicates, setCrossPackageDuplicates] = useState(false);
  /** Multi-root: `false` → envía `strictChatScope: false` (chat sobre todos los roots sin exigir scope). */
  const [allowBroadProjectChat, setAllowBroadProjectChat] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!project?.repositories?.length) return;
    setSelectedRepoId((prev) => {
      if (prev && project.repositories.some((r) => r.id === prev)) return prev;
      return project.repositories[0].id;
    });
  }, [project]);

  const runAnalysis = useCallback(
    (mode: AnalyzeCodeMode) => {
      if (!projectId || !project) return;
      setLoadingAnalysis(mode);
      setAnalysisError(null);
      setError(null);

      if (mode === 'agents' || mode === 'skill') {
        api
          .analyzeProject(projectId, { mode })
          .then((res) =>
            setAnalysisResult({ mode: res.mode, summary: res.summary, reportMeta: res.reportMeta }),
          )
          .catch((e) => setAnalysisError(e.message))
          .finally(() => setLoadingAnalysis(null));
        return;
      }

      if (project.repositories.length > 1 && !selectedRepoId) {
        setAnalysisError('Selecciona un repositorio para el análisis.');
        setLoadingAnalysis(null);
        return;
      }

      const scope = scopeFromAnalyzeForm(includePrefixesText, excludeGlobsText);
      const payload: {
        mode: 'diagnostico' | 'duplicados' | 'reingenieria' | 'codigo_muerto' | 'seguridad';
        repositoryId?: string;
        scope?: import('../types').ChatScope;
        crossPackageDuplicates?: boolean;
      } = { mode };
      if (project.repositories.length > 1) payload.repositoryId = selectedRepoId;
      if (scope) payload.scope = scope;
      if (mode === 'duplicados' && crossPackageDuplicates) payload.crossPackageDuplicates = true;

      api
        .analyzeProject(projectId, payload)
        .then((res) =>
          setAnalysisResult({ mode: res.mode, summary: res.summary, reportMeta: res.reportMeta }),
        )
        .catch((e) => setAnalysisError(e.message))
        .finally(() => setLoadingAnalysis(null));
    },
    [
      projectId,
      project,
      selectedRepoId,
      includePrefixesText,
      excludeGlobsText,
      crossPackageDuplicates,
    ],
  );

  useEffect(() => {
    if (!projectId) return;
    api
      .getProject(projectId)
      .then(setProject)
      .catch((e) => setError(e.message));
  }, [projectId]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /** Envía mensaje al chat del proyecto (POST /projects/:id/chat) y actualiza mensajes. */
  const send = useCallback(() => {
    if (!projectId || !project || !input.trim() || loading) return;
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

    const chatBody: Parameters<typeof api.chatProject>[1] = { message: msg, history };
    if (project.repositories.length > 1 && allowBroadProjectChat) {
      chatBody.strictChatScope = false;
    }

    api
      .chatProject(projectId, chatBody)
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
  }, [projectId, project, input, loading, messages, allowBroadProjectChat]);

  /** Envía mensaje con Enter (sin Shift). */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  if (!projectId) return null;
  if (error && !project) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/projects">← Proyectos</Link>
        </Button>
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }
  if (!project) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/projects">← Proyectos</Link>
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

  const displayName = project.name || project.repositories[0]?.projectKey + '/' + project.repositories[0]?.repoSlug || projectId.slice(0, 8);

  return (
    <div className="flex min-h-[min(100dvh,920px)] max-lg:min-h-0 lg:h-[calc(100dvh-10rem)] flex-col">
      <div className="flex shrink-0 flex-col gap-2 pb-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2 sm:pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" className="touch-manipulation" asChild>
            <Link to="/projects">← Proyectos</Link>
          </Button>
          <Button variant="ghost" size="sm" className="touch-manipulation" asChild>
            <Link to={`/projects/${projectId}`}>Detalle del proyecto</Link>
          </Button>
        </div>
        <span className="text-muted-foreground text-sm line-clamp-2 sm:line-clamp-none">
          Chat del proyecto: {displayName} ({project.repositories.length} repo{project.repositories.length !== 1 ? 's' : ''})
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:gap-4">
        <aside className="order-2 flex max-h-[38vh] w-full min-h-0 shrink-0 flex-col gap-4 overflow-y-auto overflow-x-hidden border-t border-[var(--border)] pt-4 lg:order-1 lg:max-h-none lg:w-[min(420px,45%)] lg:overflow-hidden lg:border-t-0 lg:border-r lg:pt-0 lg:pr-4">
          {project.repositories.length > 1 ? (
            <div className="space-y-1 text-xs">
              <span className="text-muted-foreground">Repo para análisis de código</span>
              <Select value={selectedRepoId} onValueChange={setSelectedRepoId}>
                <SelectTrigger size="sm" className="w-full font-mono text-xs">
                  <SelectValue placeholder="Elegir repositorio" />
                </SelectTrigger>
                <SelectContent>
                  {project.repositories.map((r) => (
                    <SelectItem key={r.id} value={r.id} className="font-mono text-xs">
                      {r.projectKey}/{r.repoSlug}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <AnalyzeScopeFields
            includePrefixesText={includePrefixesText}
            onIncludePrefixesText={setIncludePrefixesText}
            excludeGlobsText={excludeGlobsText}
            onExcludeGlobsText={setExcludeGlobsText}
            crossPackageDuplicates={crossPackageDuplicates}
            onCrossPackageDuplicates={setCrossPackageDuplicates}
            showCrossPackage
          />

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => runAnalysis('diagnostico')}
              disabled={!!loadingAnalysis || project.repositories.length === 0}
            >
              {loadingAnalysis === 'diagnostico' ? '…' : 'Diagnóstico'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => runAnalysis('duplicados')}
              disabled={!!loadingAnalysis || project.repositories.length === 0}
            >
              {loadingAnalysis === 'duplicados' ? '…' : 'Duplicados'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => runAnalysis('reingenieria')}
              disabled={!!loadingAnalysis || project.repositories.length === 0}
            >
              {loadingAnalysis === 'reingenieria' ? '…' : 'Reingeniería'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => runAnalysis('codigo_muerto')}
              disabled={!!loadingAnalysis || project.repositories.length === 0}
            >
              {loadingAnalysis === 'codigo_muerto' ? '…' : 'Código muerto'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => runAnalysis('seguridad')}
              disabled={!!loadingAnalysis || project.repositories.length === 0}
              title="Heurística: secretos en fuentes indexadas"
            >
              {loadingAnalysis === 'seguridad' ? '…' : 'Seguridad'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => runAnalysis('agents')}
              disabled={!!loadingAnalysis}
              title="Genera AGENTS.md para agentes AI"
            >
              {loadingAnalysis === 'agents' ? '…' : 'AGENTS'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => runAnalysis('skill')}
              disabled={!!loadingAnalysis}
              title="Genera SKILL.md para Cursor/Claude"
            >
              {loadingAnalysis === 'skill' ? '…' : 'SKILL'}
            </Button>
            {selectedRepoId ? (
              <Button variant="outline" size="sm" asChild>
                <Link to={`/repos/${selectedRepoId}/index`}>Ver índice</Link>
              </Button>
            ) : null}
          </div>
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
                  Generando…
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
            <Card className="flex min-h-0 flex-1 flex-col">
              <CardHeader className="shrink-0 pb-2">
                <CardTitle className="text-base">
                  {ANALYSIS_RESULT_TITLES[analysisResult.mode] ?? analysisResult.mode}
                </CardTitle>
                <AnalyzeReportMetaBadges meta={analysisResult.reportMeta} />
                {analysisResult.reportMeta?.graphCoverageNote ? (
                  <p className="text-muted-foreground mt-1 text-xs leading-snug">
                    {analysisResult.reportMeta.graphCoverageNote}
                  </p>
                ) : null}
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col p-0 px-6 pb-6">
                <div className="flex-1 min-h-0 overflow-auto rounded border bg-muted/50 p-3 text-sm [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 [&_p]:my-1 [&_strong]:font-semibold [&_pre]:overflow-x-auto [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_table]:w-full [&_th]:text-left [&_th]:border [&_td]:border [&_td]:px-2 [&_td]:py-1">
                  <MarkdownBlock content={typeof analysisResult.summary === 'string' ? analysisResult.summary : String(analysisResult.summary ?? '')} />
                </div>
              </CardContent>
            </Card>
          )}
          {!analysisResult && !loadingAnalysis && !analysisError && (
            <p className="text-muted-foreground py-8 text-center text-sm">
              Análisis por repo (diagnóstico, duplicados, …) o AGENTS/SKILL para markdown de agentes.
            </p>
          )}
        </aside>

        <Card className="order-1 flex min-h-[min(52vh,560px)] min-w-0 flex-1 flex-col overflow-hidden lg:order-2 lg:min-h-0">
        <CardHeader className="shrink-0 pb-2">
          <CardTitle>Pregunta sobre todo el proyecto</CardTitle>
          <p className="text-sm text-muted-foreground">
            Este chat usa el grafo de todos los repos del proyecto. Puedes preguntar por archivos, componentes o flujos en cualquier repo.
          </p>
          {project.repositories.length > 1 ? (
            <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-md border border-dashed border-[var(--border)] p-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5 rounded border-[var(--border)]"
                checked={allowBroadProjectChat}
                onChange={(e) => setAllowBroadProjectChat(e.target.checked)}
              />
              <span className="text-muted-foreground leading-snug">
                Chat amplio: no exigir scope ni inferencia por rol (equivale a{' '}
                <code className="rounded bg-muted px-1 font-mono">strictChatScope: false</code> en la API). Si está
                desmarcado y el mensaje no acota un repo, el servidor puede responder{' '}
                <code className="rounded bg-muted px-1 font-mono">[AMBIGUOUS_SCOPE]</code>.
              </span>
            </label>
          ) : null}
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
                Escribe una pregunta. El modelo consultará el grafo de todo el proyecto (todos los repos indexados).
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === 'user'
                    ? 'ml-2 sm:ml-8 rounded-lg bg-primary/10 p-3 text-sm'
                    : 'mr-2 sm:mr-8 rounded-lg border bg-muted/50 p-3 text-sm'
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

          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-end">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="¿Qué quieres saber del proyecto?"
              rows={2}
              className="min-h-[4.5rem] flex-1 resize-none rounded-md border bg-background px-3 py-2 text-base sm:text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              disabled={loading}
            />
            <Button
              onClick={send}
              disabled={loading || !input.trim()}
              className="w-full shrink-0 sm:w-auto sm:self-end touch-manipulation"
            >
              Enviar
            </Button>
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
