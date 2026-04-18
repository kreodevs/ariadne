/**
 * @fileoverview Lista de repositorios con DataTable (ordenar / filtrar) y acciones existentes.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { api } from '../api';
import type { Repository } from '../types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/StatusBadge';
import { DataTable } from '@/components/data-table/DataTable';

export function RepoList() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [resyncingId, setResyncingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

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

  const onResync = (r: Repository) => {
    if (
      !window.confirm(
        `¿Re-sincronizar ${r.projectKey}/${r.repoSlug}? Se borrará el índice actual y se volverá a indexar desde cero.`,
      )
    ) {
      return;
    }
    setResyncingId(r.id);
    api
      .triggerResync(r.id)
      .then((res) => {
        setError(null);
        const n = (res as { deletedNodes?: number }).deletedNodes;
        setFeedback(
          n != null
            ? `Resync encolado. Se borraron ${n} nodos del grafo; la reindexación corre en segundo plano.`
            : 'Resync encolado. La reindexación corre en segundo plano.',
        );
        setTimeout(() => setFeedback(null), 6000);
        load();
      })
      .catch((e) => setError(e.message))
      .finally(() => setResyncingId(null));
  };

  const onDelete = (r: Repository) => {
    if (!window.confirm(`¿Eliminar ${r.projectKey}/${r.repoSlug}? Se borrarán jobs e índice asociados.`)) return;
    setDeletingId(r.id);
    api
      .deleteRepository(r.id)
      .then(() => load())
      .catch((e) => setError(e.message))
      .finally(() => setDeletingId(null));
  };

  const columns = useMemo<ColumnDef<Repository>[]>(
    () => [
      { accessorKey: 'provider', header: 'Provider', cell: (info) => info.getValue<string>() },
      { accessorKey: 'projectKey', header: 'Project', cell: (info) => info.getValue<string>() },
      { accessorKey: 'repoSlug', header: 'Repo', cell: (info) => info.getValue<string>() },
      { accessorKey: 'defaultBranch', header: 'Branch' },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: 'id',
        header: 'Project ID (MCP)',
        cell: ({ row }) => (
          <code
            role="button"
            tabIndex={0}
            onClick={() => navigator.clipboard.writeText(row.original.id)}
            onKeyDown={(e) => e.key === 'Enter' && navigator.clipboard.writeText(row.original.id)}
            title="Clic para copiar"
            className="block max-w-[min(100%,320px)] cursor-pointer select-text truncate rounded bg-[var(--muted)] px-1.5 py-0.5 font-mono text-xs hover:bg-[var(--muted)]/80"
          >
            {row.original.id}
          </code>
        ),
      },
      {
        accessorKey: 'lastSyncAt',
        header: 'Último sync',
        cell: ({ row }) => (
          <span className="text-[var(--foreground-muted)]">
            {row.original.lastSyncAt ? new Date(row.original.lastSyncAt).toLocaleString() : '—'}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex flex-wrap gap-1">
              <Button variant="outline" size="sm" asChild>
                <Link to={`/repos/${r.id}`}>Ver</Link>
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link to={`/repos/${r.id}/edit`}>Editar</Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={resyncingId === r.id || deletingId === r.id}
                onClick={() => onResync(r)}
              >
                {resyncingId === r.id ? 'Resync…' : 'Resync'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-[var(--destructive)] hover:text-[var(--destructive)]"
                disabled={deletingId === r.id || resyncingId === r.id}
                onClick={() => onDelete(r)}
              >
                {deletingId === r.id ? '…' : 'Eliminar'}
              </Button>
            </div>
          );
        },
      },
    ],
    [deletingId, resyncingId],
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-semibold tracking-tight">The Forge</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--foreground-muted)]">
          Repositorios sincronizados con FalkorSpecs: ingest, webhooks y jobs. Ordena columnas o filtra por texto.
        </p>
      </div>

      {loading && (
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-2 h-4 w-64" />
          </CardHeader>
          <CardContent className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      )}

      {feedback && (
        <Alert>
          <AlertTitle>Listo</AlertTitle>
          <AlertDescription>{feedback}</AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!loading && !error && (
        <Card className="border-[var(--border)] bg-[var(--card)]/60">
          <CardHeader className="flex flex-col gap-4 space-y-0 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="text-lg">Repositorios</CardTitle>
              <CardDescription className="text-sm">
                {repos.length} repositorio{repos.length !== 1 ? 's' : ''} registrados
              </CardDescription>
            </div>
            <Button asChild className="w-full shrink-0 touch-manipulation sm:w-auto">
              <Link to="/repos/new">Nuevo repo</Link>
            </Button>
          </CardHeader>
          <CardContent className="min-w-0">
            {repos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="mb-2 text-sm text-[var(--foreground-muted)]">No hay repositorios configurados.</p>
                <Button asChild>
                  <Link to="/repos/new">Añadir uno</Link>
                </Button>
              </div>
            ) : (
              <DataTable
                columns={columns}
                data={repos}
                filterPlaceholder="Buscar en tabla…"
                tableClassName="overflow-x-auto"
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
