import { Link } from 'react-router-dom';
import type { Repository } from '../../types';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/StatusBadge';

interface RepoDetailRepoCardProps {
  repo: Repository;
  id: string;
  syncing: boolean;
  deleting: boolean;
  syncFeedback: string | null;
  onDelete: () => void;
  onSync: () => void;
  onResync: () => void;
}

/** Card del repo: provider/project/repo, branch, status, último sync, acciones Sync/Resync/Borrar. */
export function RepoDetailRepoCard({
  repo,
  id,
  syncing,
  deleting,
  syncFeedback,
  onDelete,
  onSync,
  onResync,
}: RepoDetailRepoCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-xl">
            {repo.provider} / {repo.projectKey} / {repo.repoSlug}
          </CardTitle>
          <CardDescription className="mt-2 flex flex-wrap items-center gap-4">
            <span>Branch: {repo.defaultBranch}</span>
            <StatusBadge status={repo.status} />
            <span>
              Último sync: {repo.lastSyncAt ? new Date(repo.lastSyncAt).toLocaleString() : '—'}
            </span>
            {repo.lastCommitSha && (
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {repo.lastCommitSha.slice(0, 7)}
              </code>
            )}
            <code
              role="button"
              tabIndex={0}
              onClick={() => navigator.clipboard.writeText(repo.id)}
              onKeyDown={(e) =>
                e.key === 'Enter' && navigator.clipboard.writeText(repo.id)
              }
              title="Clic para copiar (seleccionable)"
              className="select-text cursor-pointer rounded bg-muted px-1.5 py-0.5 text-xs font-mono hover:bg-muted/80"
            >
              Project ID: {repo.id}
            </code>
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to={`/repos/${id}/edit`}>Editar</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to={`/repos/${id}/chat`}>Chat</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to={`/repos/${id}/index`}>Índice</Link>
          </Button>
          <Button variant="destructive" size="sm" onClick={onDelete} disabled={deleting}>
            {deleting ? 'Eliminando...' : 'Eliminar'}
          </Button>
          <Button onClick={onSync} disabled={syncing}>
            {syncing ? 'Encolando...' : 'Sync ahora'}
          </Button>
          <Button
            variant="outline"
            onClick={onResync}
            disabled={syncing}
            title="Borrar índice y re-sincronizar desde cero"
          >
            Re-sincronizar todo
          </Button>
          {syncFeedback && (
            <span className="text-sm text-green-600 dark:text-green-400">{syncFeedback}</span>
          )}
        </div>
      </CardHeader>
    </Card>
  );
}
