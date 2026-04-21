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
import { Loader2, RefreshCw } from 'lucide-react';

const POLL_MS = 5000;

function isActiveStatus(s: string): boolean {
  return s === 'queued' || s === 'running';
}

/** No borrar filas en ejecución (riesgo de inconsistencia con el worker). */
function canSelectJobForDelete(j: ActiveSyncJob): boolean {
  return j.status !== 'running';
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

/** Extrae línea de auditoría y listas indexados/omitidos desde el payload al completar (full o webhook). */
function auditFromPayload(job: ActiveSyncJob): {
  summary: string;
  indexedPaths: string[];
  indexedTotal: number;
  omitted: string[];
  errorLine: string | null;
} {
  const { status, payload, errorMessage } = job;
  if (status === 'failed') {
    return {
      summary: '—',
      indexedPaths: [],
      indexedTotal: 0,
      omitted: [],
      errorLine: errorMessage?.trim() || 'Error desconocido',
    };
  }
  if (status !== 'completed' || !payload) {
    return { summary: '—', indexedPaths: [], indexedTotal: 0, omitted: [], errorLine: null };
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
  let indexedPaths: string[] = [];
  if (Array.isArray(payload.paths)) {
    indexedPaths = payload.paths.filter((x): x is string => typeof x === 'string');
  }
  return {
    summary: parts.length ? parts.join(' · ') : '—',
    indexedPaths,
    indexedTotal: indexed ?? 0,
    omitted,
    errorLine: null,
  };
}

export function ActiveJobsQueue() {
  const [jobs, setJobs] = useState<ActiveSyncJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [deletingJobs, setDeletingJobs] = useState(false);
  /** Repo en el que acabamos de llamar a sync/resync (evita doble submit). */
  const [syncingRepoId, setSyncingRepoId] = useState<string | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  const load = useCallback(() => {
    return api
      .getActiveSyncJobs()
      .then((list) => {
        setJobs(list);
        setSelectedJobIds((prev) => {
          const ids = new Set(list.map((j) => j.id));
          return new Set([...prev].filter((id) => ids.has(id)));
        });
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

  const selectableIds = useMemo(
    () => jobs.filter(canSelectJobForDelete).map((j) => j.id),
    [jobs],
  );
  const allSelectableSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedJobIds.has(id));
  const hasSelection = selectedJobIds.size > 0;

  const toggleJobSelection = useCallback((jobId: string) => {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }, []);

  const toggleAllSelectable = useCallback(() => {
    if (allSelectableSelected) setSelectedJobIds(new Set());
    else setSelectedJobIds(new Set(selectableIds));
  }, [allSelectableSelected, selectableIds]);

  const onDeleteJob = useCallback(
    async (repositoryId: string, jobId: string) => {
      if (!window.confirm('¿Quitar este job del historial?')) return;
      setDeletingJobs(true);
      try {
        await api.deleteJob(repositoryId, jobId);
        setSelectedJobIds((s) => {
          const n = new Set(s);
          n.delete(jobId);
          return n;
        });
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setDeletingJobs(false);
      }
    },
    [load],
  );

  const onTriggerSync = useCallback(
    async (repositoryId: string) => {
      setSyncingRepoId(repositoryId);
      setSyncFeedback(null);
      try {
        const res = await api.triggerSync(repositoryId);
        setSyncFeedback(
          res.queued ? `Sync encolado (job ${res.jobId.slice(0, 8)}…)` : 'Sync solicitado',
        );
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSyncingRepoId(null);
      }
    },
    [load],
  );

  const onTriggerResync = useCallback(
    async (repositoryId: string) => {
      if (
        !window.confirm(
          '¿Re-sincronizar todo el repositorio? Se borrará el índice en Falkor para este repo y se volverá a indexar desde cero.',
        )
      ) {
        return;
      }
      setSyncingRepoId(repositoryId);
      setSyncFeedback(null);
      try {
        const res = await api.triggerResync(repositoryId);
        const extra =
          res.deletedNodes != null ? ` · ${res.deletedNodes} nodos eliminados del grafo` : '';
        setSyncFeedback(
          res.queued ? `Resync encolado (job ${res.jobId.slice(0, 8)}…)${extra}` : 'Resync solicitado',
        );
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSyncingRepoId(null);
      }
    },
    [load],
  );

  const onDeleteSelected = useCallback(async () => {
    if (selectedJobIds.size === 0) return;
    if (
      !window.confirm(
        `¿Eliminar ${selectedJobIds.size} job(s) del historial? Solo se borran registros en base de datos.`,
      )
    ) {
      return;
    }
    setDeletingJobs(true);
    try {
      const pairs = [...selectedJobIds]
        .map((jobId) => {
          const job = jobs.find((j) => j.id === jobId);
          return job ? { repositoryId: job.repositoryId, jobId } : null;
        })
        .filter((p): p is { repositoryId: string; jobId: string } => p !== null);
      await Promise.all(pairs.map((p) => api.deleteJob(p.repositoryId, p.jobId)));
      setSelectedJobIds(new Set());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingJobs(false);
    }
  }, [selectedJobIds, jobs, load]);

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
        <div className="flex flex-wrap gap-2">
          {hasSelection && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void onDeleteSelected()}
              disabled={deletingJobs}
            >
              Borrar seleccionados ({selectedJobIds.size})
            </Button>
          )}
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
          {syncFeedback && (
            <Alert className="mb-4 border-green-500/50 bg-green-500/10">
              <AlertTitle>Listo</AlertTitle>
              <AlertDescription>{syncFeedback}</AlertDescription>
            </Alert>
          )}
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
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        checked={allSelectableSelected}
                        onChange={toggleAllSelectable}
                        disabled={selectableIds.length === 0}
                        title={
                          selectableIds.length === 0
                            ? 'No hay filas eliminables (hay un job en ejecución)'
                            : 'Seleccionar todos los que se pueden borrar'
                        }
                        className="rounded border-input"
                      />
                    </TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Repositorio</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Inicio</TableHead>
                    <TableHead>Fin</TableHead>
                    <TableHead>Auditoría / progreso</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((j) => {
                    const selectable = canSelectJobForDelete(j);
                    const scope =
                      typeof j.payload?.onlyProjectId === 'string' ? j.payload.onlyProjectId : null;
                    const active = isActiveStatus(j.status);
                    const prog = active ? progressHint(j.payload) : null;
                    const audit = auditFromPayload(j);
                    const showOmitted = audit.omitted.length > 0;
                    const showIndexed = audit.indexedPaths.length > 0;
                    return (
                      <TableRow key={j.id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selectedJobIds.has(j.id)}
                            onChange={() => toggleJobSelection(j.id)}
                            disabled={!selectable}
                            title={
                              selectable
                                ? 'Seleccionar para borrar del historial'
                                : 'No se puede borrar mientras el job está en ejecución'
                            }
                            className="rounded border-input"
                          />
                        </TableCell>
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
                              {showIndexed && (
                                <details className="text-xs text-[var(--foreground-muted)]">
                                  <summary className="cursor-pointer select-none hover:underline">
                                    Ver indexados ({audit.indexedPaths.length}
                                    {audit.indexedTotal > audit.indexedPaths.length
                                      ? ` de ${audit.indexedTotal}`
                                      : ''}
                                    )
                                  </summary>
                                  <ul className="mt-1 pl-3 list-disc max-h-40 overflow-y-auto space-y-0.5">
                                    {audit.indexedPaths.map((p) => (
                                      <li key={p} className="break-all font-mono">
                                        {p}
                                      </li>
                                    ))}
                                  </ul>
                                </details>
                              )}
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
                        <TableCell className="text-right whitespace-nowrap">
                          <div className="flex justify-end gap-1 flex-wrap">
                            <Button
                              variant="secondary"
                              size="sm"
                              title="Encola un sync completo (misma acción que en la ficha del repo)"
                              disabled={deletingJobs || syncingRepoId === j.repositoryId}
                              onClick={() => void onTriggerSync(j.repositoryId)}
                            >
                              {syncingRepoId === j.repositoryId ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin mr-1" aria-hidden />
                                  Encolar…
                                </>
                              ) : (
                                'Encolar sync'
                              )}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="border-orange-500/60 text-orange-600 dark:text-orange-400"
                              title="Borra nodos del grafo para este repo y encola reindexación completa"
                              disabled={deletingJobs || syncingRepoId === j.repositoryId}
                              onClick={() => void onTriggerResync(j.repositoryId)}
                            >
                              Resync
                            </Button>
                            <Button variant="ghost" size="sm" asChild>
                              <Link to={`/repos/${j.repositoryId}`}>Ver repo</Link>
                            </Button>
                            {selectable && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                disabled={deletingJobs}
                                onClick={() => void onDeleteJob(j.repositoryId, j.id)}
                              >
                                Borrar
                              </Button>
                            )}
                          </div>
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
