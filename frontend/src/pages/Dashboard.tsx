/**
 * @fileoverview Dashboard: KPIs reales desde API (proyectos, repos, dominios, salud agregada).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api';
import type { Domain, Project, Repository } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { FolderKanban, Layers, GitBranch, Activity } from 'lucide-react';

function repoHealth(repos: Repository[]): { ready: number; total: number; pct: number } {
  const total = repos.length;
  if (total === 0) return { ready: 0, total: 0, pct: 100 };
  const ready = repos.filter((r) => r.status === 'ready').length;
  return { ready, total, pct: Math.round((ready / total) * 100) };
}

export function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    Promise.all([api.getProjects(), api.getRepositories(), api.getDomains()])
      .then(([p, r, d]) => {
        if (!cancel) {
          setProjects(p);
          setRepos(r);
          setDomains(d);
        }
      })
      .catch((e) => {
        if (!cancel) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, []);

  const health = useMemo(() => repoHealth(repos), [repos]);

  if (loading) {
    return (
      <div className="space-y-8">
        <div>
          <Skeleton className="h-10 w-64 max-w-full" />
          <Skeleton className="mt-2 h-5 w-96 max-w-full" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-4xl font-semibold tracking-tight text-[var(--foreground)]">Dashboard</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--foreground-muted)]">
          Resumen de gobierno de arquitectura: proyectos multi-root, repositorios indexados y dominios. Los datos
          provienen del servicio ingest en tiempo real.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-[var(--border)] bg-[var(--card)]/80 shadow-[var(--shadow-glow)] transition-transform hover:-translate-y-0.5">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-[var(--foreground-muted)]">Proyectos</CardTitle>
            <FolderKanban className="size-4 text-[var(--primary)]" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">{projects.length}</div>
            <CardDescription className="mt-1 text-xs">
              <Link to="/projects" className="text-[var(--primary)] hover:underline">
                Ver listado
              </Link>
            </CardDescription>
          </CardContent>
        </Card>

        <Card className="border-[var(--border)] bg-[var(--card)]/80 shadow-[var(--shadow-glow)] transition-transform hover:-translate-y-0.5">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-[var(--foreground-muted)]">Repositorios</CardTitle>
            <GitBranch className="size-4 text-[var(--primary)]" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">{repos.length}</div>
            <CardDescription className="mt-1 text-xs">
              <Link to="/repos" className="text-[var(--primary)] hover:underline">
                The Forge
              </Link>
            </CardDescription>
          </CardContent>
        </Card>

        <Card className="border-[var(--border)] bg-[var(--card)]/80 shadow-[var(--shadow-glow)] transition-transform hover:-translate-y-0.5">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-[var(--foreground-muted)]">Dominios</CardTitle>
            <Layers className="size-4 text-[var(--primary)]" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">{domains.length}</div>
            <CardDescription className="mt-1 text-xs">
              <Link to="/domains" className="text-[var(--primary)] hover:underline">
                Gestionar
              </Link>
            </CardDescription>
          </CardContent>
        </Card>

        <Card className="border-[var(--border)] bg-[var(--card)]/80 shadow-[var(--shadow-glow)] transition-transform hover:-translate-y-0.5">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-[var(--foreground-muted)]">Salud ingesta</CardTitle>
            <Activity className="size-4 text-[var(--success)]" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">{health.pct}%</div>
            <p className="mt-2 text-xs text-[var(--foreground-muted)]">
              {health.ready}/{health.total} repos en estado <span className="font-mono">ready</span>
            </p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--muted)]">
              <div
                className="h-full rounded-full bg-[var(--success)] transition-all duration-500"
                style={{ width: `${health.pct}%` }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Accesos rápidos</CardTitle>
          <CardDescription className="text-sm">Mismas rutas que el menú lateral; sin lógica nueva.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Link
            to="/c4"
            className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/40 px-4 py-2 text-sm font-medium transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
          >
            C4 Viewer
          </Link>
          <Link
            to="/graph-explorer"
            className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/40 px-4 py-2 text-sm font-medium transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
          >
            Explorador de grafo
          </Link>
          <Link
            to="/jobs"
            className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/40 px-4 py-2 text-sm font-medium transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
          >
            Cola de sync
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
