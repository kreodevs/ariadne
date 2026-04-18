/**
 * @fileoverview Lista de proyectos (multi-root). Cada proyecto agrupa N repositorios.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Project } from '../types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';

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
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Proyectos</h1>
          <p className="text-muted-foreground mt-1">Cada proyecto puede tener varios repositorios (multi-root).</p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
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
        <h1 className="text-2xl font-bold tracking-tight">Proyectos</h1>
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Proyectos</h1>
          <p className="text-muted-foreground mt-1">Cada proyecto puede tener varios repositorios (multi-root).</p>
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto justify-end">
          <Button variant="outline" asChild className="touch-manipulation">
            <Link to="/domains">Dominios</Link>
          </Button>
          <Button asChild className="touch-manipulation">
            <Link to="/projects/new">Nuevo proyecto</Link>
          </Button>
        </div>
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground mb-2">No hay proyectos. Crea uno y luego añade repositorios.</p>
            <Button asChild>
              <Link to="/projects/new">Crear proyecto</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Card key={p.id} className="transition-shadow hover:shadow-md">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">
                  <Link to={`/projects/${p.id}`} className="hover:underline">
                    {p.name || p.repositories[0]?.projectKey + '/' + p.repositories[0]?.repoSlug || p.id.slice(0, 8)}
                  </Link>
                </CardTitle>
                <CardDescription>
                  {p.repositories.length} repo{p.repositories.length !== 1 ? 's' : ''}
                  {p.description && (
                    <>
                      {' · '}
                      <span className="line-clamp-2">{p.description}</span>
                    </>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground text-xs">ID (MCP):</span>
                  <code
                    role="button"
                    tabIndex={0}
                    onClick={() => navigator.clipboard.writeText(p.id)}
                    onKeyDown={(e) => e.key === 'Enter' && navigator.clipboard.writeText(p.id)}
                    title="Clic para copiar"
                    className="select-text cursor-pointer rounded bg-muted px-1.5 py-0.5 text-xs font-mono hover:bg-muted/80"
                  >
                    {p.id}
                  </code>
                </div>
                <Button variant="secondary" size="sm" asChild>
                  <Link to={`/projects/${p.id}`}>Ver proyecto</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
