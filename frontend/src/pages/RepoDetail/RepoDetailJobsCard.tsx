import { useState } from 'react';
import type { SyncJob } from '../../types';
import { Button } from '@/components/ui/button';
import { JobAnalysisModal } from './JobAnalysisModal';
import { SkippedFilesModal } from './SkippedFilesModal';
import { IndexedFilesModal } from './IndexedFilesModal';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/StatusBadge';
import { formatJobPayload } from './utils';

interface RepoDetailJobsCardProps {
  repoId: string | undefined;
  /** Proyecto Ariadne (opcional): análisis de job vía ruta por proyecto. */
  projectId: string | null;
  jobs: SyncJob[];
  selectedJobIds: Set<string>;
  deletingJobs: boolean;
  toggleJobSelection: (jobId: string) => void;
  toggleAllJobs: () => void;
  onDeleteJob: (jobId: string) => void;
  onDeleteSelectedJobs: () => void;
  onDeleteAllJobs: () => void;
  analysisJobId: string | null;
  analysisModalOpen: boolean;
  onAnalyzeJob: (jobId: string) => void;
  setAnalysisModalOpen: (open: boolean) => void;
}

/** Card con tabla de jobs, análisis por job y modales de archivos indexados / omitidos. */
export function RepoDetailJobsCard({
  repoId,
  projectId,
  jobs,
  selectedJobIds,
  deletingJobs,
  toggleJobSelection,
  toggleAllJobs,
  onDeleteJob,
  onDeleteSelectedJobs,
  onDeleteAllJobs,
  analysisJobId,
  analysisModalOpen,
  onAnalyzeJob,
  setAnalysisModalOpen,
}: RepoDetailJobsCardProps) {
  const [skippedModalJobId, setSkippedModalJobId] = useState<string | null>(null);
  const [indexedModalJobId, setIndexedModalJobId] = useState<string | null>(null);
  const hasSelection = selectedJobIds.size > 0;
  const allSelected = jobs.length > 0 && selectedJobIds.size === jobs.length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle>Jobs</CardTitle>
          <CardDescription>Historial de sincronizaciones</CardDescription>
        </div>
        {jobs.length > 0 && (
          <div className="flex gap-2">
            {hasSelection && (
              <Button
                variant="destructive"
                size="sm"
                onClick={onDeleteSelectedJobs}
                disabled={deletingJobs}
              >
                Borrar ({selectedJobIds.size})
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onDeleteAllJobs} disabled={deletingJobs}>
              Borrar todos
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <JobsTable
          jobs={jobs}
          selectedJobIds={selectedJobIds}
          allSelected={allSelected}
          deletingJobs={deletingJobs}
          toggleJobSelection={toggleJobSelection}
          toggleAllJobs={toggleAllJobs}
          onDeleteJob={onDeleteJob}
          onAnalyzeJob={onAnalyzeJob}
          onShowSkipped={(jobId) => setSkippedModalJobId(jobId)}
          onShowIndexed={(jobId) => setIndexedModalJobId(jobId)}
        />
        <JobAnalysisModal
          repoId={repoId ?? null}
          projectId={projectId}
          jobId={analysisJobId}
          open={analysisModalOpen}
          onOpenChange={setAnalysisModalOpen}
        />
        <SkippedFilesModal
          open={skippedModalJobId !== null}
          onOpenChange={(open) => !open && setSkippedModalJobId(null)}
          payload={jobs.find((j) => j.id === skippedModalJobId)?.payload}
        />
        <IndexedFilesModal
          open={indexedModalJobId !== null}
          onOpenChange={(open) => !open && setIndexedModalJobId(null)}
          payload={jobs.find((j) => j.id === indexedModalJobId)?.payload}
        />
      </CardContent>
    </Card>
  );
}

interface JobsTableProps {
  jobs: SyncJob[];
  selectedJobIds: Set<string>;
  allSelected: boolean;
  deletingJobs: boolean;
  toggleJobSelection: (jobId: string) => void;
  toggleAllJobs: () => void;
  onDeleteJob: (jobId: string) => void;
  onAnalyzeJob: (jobId: string) => void;
  onShowSkipped: (jobId: string) => void;
  onShowIndexed: (jobId: string) => void;
}

/** Tabla de jobs con checkbox global, columnas estado/resultado y acciones por fila. */
function JobsTable({
  jobs,
  selectedJobIds,
  allSelected,
  deletingJobs,
  toggleJobSelection,
  toggleAllJobs,
  onDeleteJob,
  onAnalyzeJob,
  onShowSkipped,
  onShowIndexed,
}: JobsTableProps) {
  if (jobs.length === 0) {
    return <p className="text-muted-foreground py-8 text-center">No hay jobs aún.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAllJobs}
              className="rounded border-input"
            />
          </TableHead>
          <TableHead>Tipo</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead>Inicio</TableHead>
          <TableHead>Fin</TableHead>
          <TableHead>Resultado</TableHead>
          <TableHead>Error</TableHead>
          <TableHead className="w-24"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((j) => (
          <JobRow
            key={j.id}
            job={j}
            isSelected={selectedJobIds.has(j.id)}
            deletingJobs={deletingJobs}
            onToggleSelect={() => toggleJobSelection(j.id)}
            onDelete={() => onDeleteJob(j.id)}
            onAnalyze={() => onAnalyzeJob(j.id)}
            onShowSkipped={() => onShowSkipped(j.id)}
            onShowIndexed={() => onShowIndexed(j.id)}
          />
        ))}
      </TableBody>
    </Table>
  );
}

interface JobRowProps {
  job: SyncJob;
  isSelected: boolean;
  deletingJobs: boolean;
  onToggleSelect: () => void;
  onDelete: () => void;
  onAnalyze: () => void;
  onShowSkipped: () => void;
  onShowIndexed: () => void;
}

/** Fila de job: checkbox, tipo, estado, fechas, resultado, error, botones analizar/omitidos/borrar. */
function JobRow({
  job,
  isSelected,
  deletingJobs,
  onToggleSelect,
  onDelete,
  onAnalyze,
  onShowSkipped,
  onShowIndexed,
}: JobRowProps) {
  const skipped = (job.payload?.skipped as number) ?? 0;
  const indexed = (job.payload?.indexed as number) ?? 0;
  const hasSkipped = skipped > 0 && job.status === 'completed';
  const hasIndexed = indexed > 0 && job.status === 'completed';

  return (
    <TableRow>
      <TableCell>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          className="rounded border-input"
        />
      </TableCell>
      <TableCell>{job.type}</TableCell>
      <TableCell>
        <StatusBadge status={job.status} />
      </TableCell>
      <TableCell>{new Date(job.startedAt).toLocaleString()}</TableCell>
      <TableCell>{job.finishedAt ? new Date(job.finishedAt).toLocaleString() : '—'}</TableCell>
      <TableCell className="max-w-xs">
        <div className="flex flex-col gap-1 items-start">
          <span>{formatJobPayload(job.payload, job.status)}</span>
          <div className="flex flex-wrap gap-x-3 gap-y-0">
            {hasIndexed && (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-muted-foreground underline"
                onClick={onShowIndexed}
              >
                Ver indexados
              </Button>
            )}
            {hasSkipped && (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-muted-foreground underline"
                onClick={onShowSkipped}
              >
                Ver omitidos
              </Button>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell className="min-w-[280px] max-w-xl align-top">
        <JobErrorMessage errorMessage={job.errorMessage} />
      </TableCell>
      <TableCell className="flex gap-1">
        {job.type === 'incremental' && job.status === 'completed' && (
          <Button variant="outline" size="sm" onClick={onAnalyze}>
            Analizar
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={onDelete}
          disabled={deletingJobs}
        >
          Borrar
        </Button>
      </TableCell>
    </TableRow>
  );
}

/** Muestra mensaje de error del job en bloque <pre> o "—" si no hay. */
function JobErrorMessage({ errorMessage }: { errorMessage?: string | null }) {
  if (!errorMessage) return '—';
  return (
    <pre className="max-h-32 overflow-auto rounded bg-muted p-2 text-xs text-destructive/90 whitespace-pre-wrap break-words">
      {errorMessage}
    </pre>
  );
}
