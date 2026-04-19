/**
 * @fileoverview Cola global de sync: en cola / en curso + jobs terminados recientes (auditoría).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
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

function isActiveStatus(s: string): boolean {
  return s === 'queued' || s === 'running';
}

/** Resume progreso en vivo (payload mezclado durante el sync). */
function progressHint(payload: Record<string, unknown> | null | undefined): string | null {
  if (!payload) return null;
  const phase = typeof payload.phase === 'string' ? payload.phase : null;
  const current = typeof payload.current === 'number' ? payload.current : null;
  const total = typeof payload.total === 'number' ? payload.total : null;
  const lastFile = typeof payload.lastFile === 'string' ? payload.lastFile : null;
  if (current != null && total != null) {
    return [phase, `${current}/${total}`, lastFile ? lastFile.slice(-40) : null].filter(Boolean).join(' · ');
  }
  if (phase) return phase;
  return null;
}

/** Extrae línea de auditoría y lista de omitidos desde el payload al completar (full o webhook). */
function auditFromPayload(job: ActiveSyncJob): {
  summary: string;
  omitted: string[];
  errorLine: string | null;
} {
  const { status, payload, errorMessage } = job;
  if (status === 'failed') {
    return {
      summary: '—',
      omitted: [],
      errorLine: errorMessage?.trim() || 'Error desconocido',
    };
  }
  if (status !== 'completed' || !payload) {
    return { summary: '—', omitted: [], errorLine: null };
  }
  const indexed = typeof payload.indexed === 'number' ? payload.indexed : undefined;
  const skipped = typeof payload.skipped === 'number' ? payload.skipped : undefined;
  const total = typeof payload.total === 'number' ? payload.total : undefined;
  const deleted = typeof payload.deleted === 'number' ? payload.deleted : undefined;
  const parts: string[] = [];
  if (indexed !== undefined) parts.push(`${indexed} indexados`);
  if (skipped !== undefined) parts.push(`${skipped} omitidos`);
  if (total !== undefined) parts.push(`${total} archivos listados`);
  if (deleted !== undefined) parts.push(`${deleted} quitados del índice`);
  let omitted: string[] = [];
  if (Array.isArray(payload.skippedPaths)) {
    omitted = payload.skippedPaths.filter((x): x is string => typeof x === 'string');
  } else if (payload.skippedPathsByReason && typeof payload.skippedPathsByReason === 'object') {
    const o = payload.skippedPathsByReason as Record<string, unknown>;
    for (const k of ['fetch', 'parse', 'index'] as const) {
      const arr = o[k];
      if (Array.isArray(arr))
        omitted.push(...arr.filter((x): x is string => typeof x === 'string'));
    }
  }
  return {
    summary: parts.length ? parts.join(' · ') : '—',
    omitted,
    errorLine: null,
  };
}

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

  const counts = useMemo(() => {
    const active = jobs.filter((j) => isActiveStatus(j.status)).length;
    const done = jobs.length - active;
    return { active, done };
  }, [jobs]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cola de sincronización</h1>
          <p className="text-[var(--foreground-muted)] mt-1 text-sm">
            Jobs en cola o en ejecución, y los últimos terminados con resumen de indexación (auditoría).
            Se actualiza cada {POLL_MS / 1000}s.
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
          <CardTitle className="text-lg">Trabajos</CardTitle>
          <CardDescription>
            {loading && jobs.length === 0
              ? 'Cargando…'
              : jobs.length === 0
                ? 'No hay jobs recientes.'
                : `${counts.active} en cola o en curso${counts.done > 0 ? ` · ${counts.done} terminado(s) reciente(s)` : ''}.`}
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
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Estado</TableHead>
                    <TableHead>Repositorio</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Inicio</TableHead>
                    <TableHead>Fin</TableHead>
                    <TableHead>Auditoría / progreso</TableHead>
                    <TableHead className="text-right">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((j) => {
                    const scope =
                      typeof j.payload?.onlyProjectId === 'string' ? j.payload.onlyProjectId : null;
                    const active = isActiveStatus(j.status);
                    const prog = active ? progressHint(j.payload) : null;
                    const audit = auditFromPayload(j);
                    const showOmitted = audit.omitted.length > 0;
                    return (
                      <TableRow key={j.id}>
                        <TableCell>
                          <StatusBadge status={j.status} />
                        </TableCell>
                        <TableCell className="font-mono text-sm min-w-[10rem]">
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
                        <TableCell className="text-sm text-[var(--foreground-muted)] whitespace-nowrap">
                          {j.finishedAt ? new Date(j.finishedAt).toLocaleString() : '—'}
                        </TableCell>
                        <TableCell className="text-sm max-w-[28rem]">
                          {active && prog && (
                            <span className="text-[var(--foreground-muted)]">{prog}</span>
                          )}
                          {active && !prog && (
                            <span className="text-[var(--foreground-muted)]">En proceso…</span>
                          )}
                          {!active && j.status === 'completed' && (
                            <div className="space-y-1">
                              <div>{audit.summary}</div>
                              {showOmitted && (
                                <details className="text-xs text-[var(--foreground-muted)]">
                                  <summary className="cursor-pointer select-none hover:underline">
                                    Ver omitidos ({audit.omitted.length})
                                  </summary>
                                  <ul className="mt-1 pl-3 list-disc max-h-40 overflow-y-auto space-y-0.5">
                                    {audit.omitted.map((p) => (
                                      <li key={p} className="break-all font-mono">
                                        {p}
                                      </li>
                                    ))}
                                  </ul>
                                </details>
                              )}
                            </div>
                          )}
                          {!active && j.status === 'failed' && audit.errorLine && (
                            <span className="text-destructive text-xs break-words">{audit.errorLine}</span>
                          )}
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
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
