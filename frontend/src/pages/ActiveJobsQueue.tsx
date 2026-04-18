/**
 * @fileoverview Cola global de jobs de sync (queued / running) en todos los repositorios.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { ActiveSyncJob } from '../types';
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
import { RefreshCw } from 'lucide-react';

const POLL_MS = 5000;

export function ActiveJobsQueue() {
  const [jobs, setJobs] = useState<ActiveSyncJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    return api
      .getActiveSyncJobs()
      .then((list) => {
        setJobs(list);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cola de sincronización</h1>
          <p className="text-[var(--foreground-muted)] mt-1 text-sm">
            Jobs en cola o en ejecución en todos los repositorios. Se actualiza cada {POLL_MS / 1000}s.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setRefreshing(true);
            void load();
          }}
          disabled={refreshing}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          Actualizar
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Trabajos activos</CardTitle>
          <CardDescription>
            {loading && jobs.length === 0
              ? 'Cargando…'
              : jobs.length === 0
                ? 'No hay jobs en cola ni ejecutándose.'
                : `${jobs.length} job(s) pendiente(s) o en curso.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {loading && jobs.length === 0 ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : jobs.length === 0 ? null : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Estado</TableHead>
                  <TableHead>Repositorio</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Inicio</TableHead>
                  <TableHead className="text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j) => {
                  const scope =
                    typeof j.payload?.onlyProjectId === 'string'
                      ? j.payload.onlyProjectId
                      : null;
                  return (
                    <TableRow key={j.id}>
                      <TableCell>
                        <StatusBadge status={j.status} />
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        <div>
                          {j.repository.projectKey}/{j.repository.repoSlug}
                        </div>
                        {scope && (
                          <div className="text-xs text-[var(--foreground-muted)] mt-0.5">
                            Solo proyecto: {scope}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="capitalize">{j.type}</TableCell>
                      <TableCell className="text-sm text-[var(--foreground-muted)] whitespace-nowrap">
                        {new Date(j.startedAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/repos/${j.repositoryId}`}>Ver repo</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
