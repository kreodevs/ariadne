/**
 * @fileoverview Hook con la lógica de datos y acciones de la página de detalle de repo (estado, polling, sync, delete, análisis).
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import type { Repository, SyncJob } from '../../types';

const POLL_INTERVAL_MS = 2000;

/** Estado y acciones para selección y borrado de jobs. Reduce anidamiento en useRepoDetail. */
function useRepoDetailJobs(
  id: string | undefined,
  jobs: SyncJob[],
  load: () => Promise<void>,
  setError: (msg: string | null) => void,
) {
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [deletingJobs, setDeletingJobs] = useState(false);

  const toggleJobSelection = useCallback((jobId: string) => {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }, []);

  const toggleAllJobs = useCallback(() => {
    setSelectedJobIds((prev) =>
      prev.size === jobs.length ? new Set() : new Set(jobs.map((j) => j.id)),
    );
  }, [jobs]);

  const onDeleteJob = useCallback(
    async (jobId: string) => {
      if (!id) return;
      if (!window.confirm('¿Eliminar este job del historial?')) return;
      setDeletingJobs(true);
      try {
        await api.deleteJob(id, jobId);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setDeletingJobs(false);
      }
    },
    [id, load, setError],
  );

  const onDeleteSelectedJobs = useCallback(
    async () => {
      if (!id || selectedJobIds.size === 0) return;
      if (!window.confirm(`¿Eliminar ${selectedJobIds.size} job(s) del historial?`)) return;
      setDeletingJobs(true);
      try {
        await Promise.all([...selectedJobIds].map((jobId) => api.deleteJob(id, jobId)));
        setSelectedJobIds(new Set());
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setDeletingJobs(false);
      }
    },
    [id, selectedJobIds, load, setError],
  );

  const onDeleteAllJobs = useCallback(
    async () => {
      if (!id) return;
      if (!window.confirm(`¿Eliminar todos los jobs (${jobs.length}) del historial?`)) return;
      setDeletingJobs(true);
      try {
        await api.deleteAllJobs(id);
        setSelectedJobIds(new Set());
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setDeletingJobs(false);
      }
    },
    [id, jobs.length, load, setError],
  );

  return {
    selectedJobIds,
    deletingJobs,
    toggleJobSelection,
    toggleAllJobs,
    onDeleteJob,
    onDeleteSelectedJobs,
    onDeleteAllJobs,
  };
}

/** Estado y acciones de sync/resync. Reduce anidamiento en useRepoDetail. */
function useRepoDetailSync(
  id: string | undefined,
  load: () => Promise<void>,
  setError: (msg: string | null) => void,
) {
  const [syncing, setSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  const runSync = useCallback(
    async (resync: boolean) => {
      if (!id) return;
      if (
        resync &&
        !window.confirm(
          '¿Re-sincronizar todo? Se borrará el índice actual y se volverá a indexar desde cero.',
        )
      ) {
        return;
      }
      setSyncing(true);
      setSyncFeedback(null);
      try {
        const res = await (resync ? api.triggerResync(id) : api.triggerSync(id));
        const resyncRes = res as { queued: boolean; deletedNodes?: number };
        const msg =
          resync && resyncRes.deletedNodes != null
            ? `Borrados ${resyncRes.deletedNodes} nodos. Job encolado.`
            : resyncRes.queued
              ? 'Job encolado'
              : 'Sync iniciado';
        setSyncFeedback(msg);
        setTimeout(() => setSyncFeedback(null), resync ? 5000 : 4000);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSyncing(false);
      }
    },
    [id, load, setError],
  );

  return {
    syncing,
    syncFeedback,
    onSync: () => runSync(false),
    onResync: () => runSync(true),
  };
}

/**
 * Estado y handlers para RepoDetail: repo, jobs, loading, sync, delete, análisis.
 * Compone useRepoDetailJobs y useRepoDetailSync para reducir nesting.
 */
export function useRepoDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [repo, setRepo] = useState<Repository | null>(null);
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [analysisJobId, setAnalysisJobId] = useState<string | null>(null);
  const [analysisModalOpen, setAnalysisModalOpen] = useState(false);
  const [embedding, setEmbedding] = useState(false);
  const [embedFeedback, setEmbedFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [r, j] = await Promise.all([api.getRepository(id), api.getJobs(id)]);
      setRepo(r);
      setJobs(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const hasActive = jobs.some((j) => j.status === 'running' || j.status === 'queued');
  useEffect(() => {
    if (!hasActive || !id) return;
    const t = setInterval(() => {
      api.getRepository(id).then(setRepo).catch(() => {});
      api.getJobs(id).then(setJobs).catch(() => {});
    }, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [hasActive, id]);

  const onDelete = useCallback(async () => {
    if (!id || !repo) return;
    if (
      !window.confirm(
        `¿Eliminar ${repo.projectKey}/${repo.repoSlug}? Se borrarán jobs e índice asociados.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      await api.deleteRepository(id);
      navigate('/projects');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }, [id, repo, navigate]);

  const jobsState = useRepoDetailJobs(id, jobs, load, setError);
  const syncState = useRepoDetailSync(id, load, setError);

  const onAnalyzeJob = useCallback((jobId: string) => {
    setAnalysisJobId(jobId);
    setAnalysisModalOpen(true);
  }, []);

  const onEmbedIndex = useCallback(async () => {
    if (!id) return;
    setEmbedding(true);
    setEmbedFeedback(null);
    try {
      const r = await api.runEmbedIndex(id);
      setEmbedFeedback(
        r.errors > 0
          ? `Embeddings: ${r.indexed} indexados, ${r.errors} errores (revisa logs ingest).`
          : `Embeddings: ${r.indexed} nodos indexados.`,
      );
      setTimeout(() => setEmbedFeedback(null), 8000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEmbedding(false);
    }
  }, [id]);

  return {
    id,
    repo,
    jobs,
    loading,
    error,
    deleting,
    load,
    onDelete,
    ...syncState,
    ...jobsState,
    analysisJobId,
    analysisModalOpen,
    onAnalyzeJob,
    setAnalysisModalOpen,
    embedding,
    embedFeedback,
    onEmbedIndex,
  };
}
