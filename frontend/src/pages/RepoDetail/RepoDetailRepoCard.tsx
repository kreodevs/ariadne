import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Repository } from '../../types';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/StatusBadge';
import { RefreshCw } from 'lucide-react';

interface RepoDetailRepoCardProps {
  repo: Repository;
  id: string;
  syncing: boolean;
  deleting: boolean;
  syncFeedback: string | null;
  onDelete: () => void;
  onSync: () => void;
  onResync: () => void;
  onRegenerateProjectId?: () => Promise<void>;
}

function IdChip({
  label,
  value,
  onCopy,
  onRegenerate,
  warning,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  onRegenerate?: () => Promise<void>;
  warning?: boolean;
}) {
  const [regenLoading, setRegenLoading] = useState(false);
  const handleRegen = onRegenerate
    ? async () => {
        setRegenLoading(true);
        try {
          await onRegenerate();
        } finally {
          setRegenLoading(false);
        }
      }
    : undefined;

  return (
    <span className="inline-flex items-center gap-1">
      <code
        role="button"
        tabIndex={0}
        onClick={() => onCopy()}
        onKeyDown={(e) => e.key === 'Enter' && onCopy()}
        title="Clic para copiar"
        className={`select-text cursor-pointer rounded px-1.5 py-0.5 text-xs font-mono hover:opacity-90 ${
          warning ? 'bg-amber-500/20 text-amber-800 dark:text-amber-200' : 'bg-muted'
        }`}
      >
        {label}: {value}
      </code>
      {handleRegen && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleRegen}
          disabled={regenLoading}
          title="Regenerar Project ID (sin perder datos)"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${regenLoading ? 'animate-spin' : ''}`} />
        </Button>
      )}
    </span>
  );
}

/** Card del repo: provider/project/repo, branch, status, último sync, IDs, acciones Sync/Resync/Borrar. */
export function RepoDetailRepoCard({
  repo,
  id,
  syncing,
  deleting,
  syncFeedback,
  onDelete,
  onSync,
  onResync,
  onRegenerateProjectId,
}: RepoDetailRepoCardProps) {
  const effectiveProjectId = repo.projectIds?.[0] ?? repo.id;
  const idsCollide = effectiveProjectId === repo.id;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

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
            <IdChip
              label="Repository ID"
              value={repo.id}
              onCopy={() => copyToClipboard(repo.id)}
            />
            <IdChip
              label="Project ID"
              value={effectiveProjectId}
              onCopy={() => copyToClipboard(effectiveProjectId)}
              onRegenerate={idsCollide ? onRegenerateProjectId : undefined}
              warning={idsCollide}
            />
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
