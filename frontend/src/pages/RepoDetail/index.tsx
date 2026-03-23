/**
 * @fileoverview Detalle del repo: info, Sync, Resync, jobs, link a Chat.
 * Refactorizado con compound components y useRepoDetail para reducir complejidad.
 */
import { useRepoDetail } from './useRepoDetail';
import { RepoDetailLoading } from './RepoDetailLoading';
import { RepoDetailError } from './RepoDetailError';
import { RepoDetailNotFound } from './RepoDetailNotFound';
import { RepoDetailHeader } from './RepoDetailHeader';
import { RepoDetailRepoCard } from './RepoDetailRepoCard';
import { RepoDetailJobsCard } from './RepoDetailJobsCard';

/**
 * Página de detalle de repositorio.
 * Compound components: RepoDetail.Loading, RepoDetail.Error, RepoDetail.NotFound,
 * RepoDetail.Header, RepoDetail.RepoCard, RepoDetail.JobsCard.
 */
export function RepoDetail() {
  const state = useRepoDetail();

  if (state.loading && !state.repo) {
    return <RepoDetail.Loading />;
  }
  if (state.error) {
    return <RepoDetail.Error error={state.error} />;
  }
  if (!state.repo || !state.id) {
    return <RepoDetail.NotFound />;
  }

  return (
    <div className="space-y-6">
      <RepoDetail.Header />
      <RepoDetail.RepoCard {...getRepoCardProps(state)} />
      <RepoDetail.JobsCard {...getJobsCardProps(state)} />
    </div>
  );
}

/** Deriva props para RepoDetail.RepoCard desde el estado de useRepoDetail. */
function getRepoCardProps(state: ReturnType<typeof useRepoDetail>) {
  return {
    repo: state.repo!,
    id: state.id!,
    syncing: state.syncing,
    deleting: state.deleting,
    syncFeedback: state.syncFeedback,
    onDelete: state.onDelete,
    onSync: state.onSync,
    onResync: state.onResync,
    onRegenerateProjectId: state.onRegenerateProjectId,
  };
}

/** Deriva props para RepoDetail.JobsCard desde el estado de useRepoDetail. */
function getJobsCardProps(state: ReturnType<typeof useRepoDetail>) {
  return {
    repoId: state.id,
    jobs: state.jobs,
    selectedJobIds: state.selectedJobIds,
    deletingJobs: state.deletingJobs,
    toggleJobSelection: state.toggleJobSelection,
    toggleAllJobs: state.toggleAllJobs,
    onDeleteJob: state.onDeleteJob,
    onDeleteSelectedJobs: state.onDeleteSelectedJobs,
    onDeleteAllJobs: state.onDeleteAllJobs,
    analysisJobId: state.analysisJobId,
    analysisModalOpen: state.analysisModalOpen,
    onAnalyzeJob: state.onAnalyzeJob,
    setAnalysisModalOpen: state.setAnalysisModalOpen,
  };
}

RepoDetail.Loading = RepoDetailLoading;
RepoDetail.Error = RepoDetailError;
RepoDetail.NotFound = RepoDetailNotFound;
RepoDetail.Header = RepoDetailHeader;
RepoDetail.RepoCard = RepoDetailRepoCard;
RepoDetail.JobsCard = RepoDetailJobsCard;
