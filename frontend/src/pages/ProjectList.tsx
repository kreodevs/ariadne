/**
 * @fileoverview Lista de proyectos (multi-root). Cards con salud de ingesta por repo (datos API).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Project } from '../types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

function ingestHealth(repos: Project['repositories']): { pct: number; ready: number; total: number } {
  const total = repos.length;
  if (total === 0) return { pct: 0, ready: 0, total: 0 };
  const ready = repos.filter((r) => r.status === 'ready').length;
  return { ready, total, pct: Math.round((ready / total) * 100) };
}

/** Lista de proyectos (multi-root) con GET /projects; cada proyecto enlaza a su detalle. */
export function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getProjects()
      .then(setProjects)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-8">
        <div>
          <Skeleton className="h-10 w-48" />
          <Skeleton className="mt-2 h-5 w-72 max-w-full" />
        </div>
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-28 w-full rounded-xl" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-4xl font-semibold tracking-tight">Proyectos</h1>
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-4xl font-semibold tracking-tight">Proyectos</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--foreground-muted)]">
            Multi-root: cada proyecto agrupa repositorios. La barra de salud usa el estado de ingesta devuelto por
            el API (<span className="font-mono">ready</span> vs total).
          </p>
        </div>
        <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto">
          <Button variant="outline" asChild className="touch-manipulation">
            <Link to="/domains">Dominios</Link>
          </Button>
          <Button asChild className="touch-manipulation">
            <Link to="/projects/new">Nuevo proyecto</Link>
          </Button>
        </div>
      </div>

      {projects.length === 0 ? (
        <Card className="border-[var(--border)] bg-[var(--card)]/60">
          <CardContent className="flex flex-col items-center justify-center py-14 text-center">
            <p className="mb-2 text-sm text-[var(--foreground-muted)]">
              No hay proyectos. Crea uno y luego añade repositorios.
            </p>
            <Button asChild>
              <Link to="/projects/new">Crear proyecto</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => {
            const h = ingestHealth(p.repositories);
            return (
              <Card
                key={p.id}
                className="border-[var(--border)] bg-[var(--card)]/80 shadow-[var(--shadow-glow)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--primary)]/30"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-lg leading-snug">
                      <Link to={`/projects/${p.id}`} className="text-[var(--foreground)] hover:text-[var(--primary)] hover:underline">
                        {p.name ||
                          (p.repositories[0]
                            ? `${p.repositories[0].projectKey}/${p.repositories[0].repoSlug}`
                            : p.id.slice(0, 8))}
                      </Link>
                    </CardTitle>
                    {p.domainName ? (
                      <Badge
                        variant="outline"
                        className="shrink-0 border-[var(--border)] text-[10px] font-normal"
                        style={{ borderColor: p.domainColor ?? undefined }}
                      >
                        {p.domainName}
                      </Badge>
                    ) : null}
                  </div>
                  <CardDescription className="line-clamp-2 text-sm">
                    {p.repositories.length} repo{p.repositories.length !== 1 ? 's' : ''}
                    {p.description ? ` · ${p.description}` : ''}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-xs text-[var(--foreground-muted)]">
                      <span>Ingesta</span>
                      <span className="font-mono tabular-nums">
                        {h.total === 0 ? '—' : `${h.ready}/${h.total} ready`}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--muted)]">
                      <div
                        className="h-full rounded-full bg-[var(--success)] transition-all duration-500"
                        style={{ width: `${h.total === 0 ? 0 : h.pct}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-[var(--foreground-muted)]">ID (MCP):</span>
                    <code
                      role="button"
                      tabIndex={0}
                      onClick={() => navigator.clipboard.writeText(p.id)}
                      onKeyDown={(e) => e.key === 'Enter' && navigator.clipboard.writeText(p.id)}
                      title="Clic para copiar"
                      className="cursor-pointer select-text rounded-md bg-[var(--muted)] px-2 py-0.5 font-mono text-xs hover:bg-[var(--muted)]/80"
                    >
                      {p.id}
                    </code>
                  </div>
                  <Button variant="secondary" size="sm" className="w-full touch-manipulation sm:w-auto" asChild>
                    <Link to={`/projects/${p.id}`}>Ver proyecto</Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
