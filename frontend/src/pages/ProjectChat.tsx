/**
 * @fileoverview Chat a nivel proyecto: consulta el grafo de todos los repos del proyecto.
 * Las respuestas pueden citar archivos de cualquier repo asociado al proyecto.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../api';
import type { Project } from '../types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  cypher?: string;
  result?: unknown[];
}

/** Chat a nivel proyecto: consulta el grafo de todos los repos del proyecto (POST /projects/:id/chat). */
export function ProjectChat() {
  const { id: projectId } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    if (!projectId || !input.trim() || loading) return;
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
      .chatProject(projectId, { message: msg, history })
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
  }, [projectId, input, loading, messages]);

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
          <Link to="/">← Proyectos</Link>
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
          <Link to="/">← Proyectos</Link>
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
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="flex shrink-0 items-center gap-2 pb-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/">← Proyectos</Link>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/projects/${projectId}`}>Detalle del proyecto</Link>
        </Button>
        <span className="text-muted-foreground">
          Chat del proyecto: {displayName} ({project.repositories.length} repo{project.repositories.length !== 1 ? 's' : ''})
        </span>
      </div>

      <Card className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="shrink-0 pb-2">
          <CardTitle>Pregunta sobre todo el proyecto</CardTitle>
          <p className="text-sm text-muted-foreground">
            Este chat usa el grafo de todos los repos del proyecto. Puedes preguntar por archivos, componentes o flujos en cualquier repo.
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
                Escribe una pregunta. El modelo consultará el grafo de todo el proyecto (todos los repos indexados).
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
              placeholder="¿Qué quieres saber del proyecto?"
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
  );
}
