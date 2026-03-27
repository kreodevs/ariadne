/**
 * @fileoverview Lista de repositorios con tabla, link a detalle y eliminar.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Repository } from '../types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/StatusBadge';

/** Lista repos con GET /repositories, link a /repos/:id y /repos/new. */
export function RepoList() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /** Carga GET /repositories y actualiza estado. */
  const load = () => {
    api
      .getRepositories()
      .then(setRepos)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  /** Elimina repo con DELETE /repositories/:id tras confirmar; recarga la lista. */
  const onDelete = (r: Repository) => {
    if (!window.confirm(`¿Eliminar ${r.projectKey}/${r.repoSlug}? Se borrarán jobs e índice asociados.`)) return;
    setDeletingId(r.id);
    api
      .deleteRepository(r.id)
      .then(() => load())
      .catch((e) => setError(e.message))
      .finally(() => setDeletingId(null));
  };

  return (
    <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Repositorios</h1>
          <p className="text-muted-foreground mt-1">
            Gestiona los repositorios sincronizados con FalkorSpecs.
          </p>
        </div>

        {loading && (
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-64 mt-2" />
            </CardHeader>
            <CardContent className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </CardContent>
          </Card>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!loading && !error && (
          <Card>
            <CardHeader className="flex flex-col gap-4 space-y-0 pb-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <CardTitle>Listado</CardTitle>
                <CardDescription>
                  {repos.length} repositorio{repos.length !== 1 ? 's' : ''}
                </CardDescription>
              </div>
              <Button asChild className="w-full shrink-0 sm:w-auto touch-manipulation">
                <Link to="/repos/new">Nuevo repo</Link>
              </Button>
            </CardHeader>
            <CardContent className="min-w-0">
              {repos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <p className="text-muted-foreground mb-2">No hay repositorios configurados.</p>
                  <Button asChild>
                    <Link to="/repos/new">Añadir uno</Link>
                  </Button>
                </div>
              ) : (
                <Table className="min-w-[720px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Provider</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Repo</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Project ID (MCP)</TableHead>
                      <TableHead>Último sync</TableHead>
                      <TableHead className="w-[200px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {repos.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.provider}</TableCell>
                        <TableCell>{r.projectKey}</TableCell>
                        <TableCell>{r.repoSlug}</TableCell>
                        <TableCell>{r.defaultBranch}</TableCell>
                        <TableCell>
                          <StatusBadge status={r.status} />
                        </TableCell>
                        <TableCell>
                          <code
                            role="button"
                            tabIndex={0}
                            onClick={() => navigator.clipboard.writeText(r.id)}
                            onKeyDown={(e) =>
                              e.key === 'Enter' && navigator.clipboard.writeText(r.id)
                            }
                            title="Clic para copiar (seleccionable)"
                            className="block select-text cursor-pointer rounded bg-muted px-1.5 py-0.5 text-xs font-mono hover:bg-muted/80"
                          >
                            {r.id}
                          </code>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.lastSyncAt
                            ? new Date(r.lastSyncAt).toLocaleString()
                            : '—'}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="outline" size="sm" asChild>
                              <Link to={`/repos/${r.id}`}>Ver</Link>
                            </Button>
                            <Button variant="ghost" size="sm" asChild>
                              <Link to={`/repos/${r.id}/edit`}>Editar</Link>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              disabled={deletingId === r.id}
                              onClick={() => onDelete(r)}
                            >
                              {deletingId === r.id ? '...' : 'Eliminar'}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
    </div>
  );
}
