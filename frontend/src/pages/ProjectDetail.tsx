/**
 * @fileoverview Detalle de proyecto: nombre, lista de repos, enlaces a chat/índice, añadir repo (nuevo o existente).
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import type { Project, Repository } from '../types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Input } from '@/components/ui/input';
import { Pencil, RefreshCw } from 'lucide-react';

/** Modal para asociar un repo existente al proyecto. Extraído para reducir anidamiento en ProjectDetail. */
function AssociateRepoDialog({
  open,
  onOpenChange,
  loadingRepos,
  associateError,
  associateSuccess,
  associatingId,
  availableRepos,
  onAssociate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loadingRepos: boolean;
  associateError: string | null;
  associateSuccess: string | null;
  associatingId: string | null;
  availableRepos: Repository[];
  onAssociate: (repoId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Asociar repositorio existente</DialogTitle>
          <DialogDescription>
            Elige un repo ya dado de alta en Ariadne. Se asociará a este proyecto sin crear otro webhook; seguirá sincronizándose con el mismo.
          </DialogDescription>
        </DialogHeader>
        {associateError && (
          <Alert variant="destructive">
            <AlertDescription>{associateError}</AlertDescription>
          </Alert>
        )}
        {associateSuccess && (
          <Alert className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30">
            <AlertDescription>{associateSuccess}</AlertDescription>
          </Alert>
        )}
        {loadingRepos ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Cargando repositorios…</div>
        ) : availableRepos.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No hay repositorios disponibles para asociar (todos están ya en este proyecto o no hay otros registrados).
          </p>
        ) : (
          <ul className="max-h-60 overflow-y-auto space-y-2 rounded-md border p-2">
            {availableRepos.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 rounded border bg-muted/30 px-3 py-2">
                <span className="font-medium text-sm truncate">
                  {r.projectKey}/{r.repoSlug}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onAssociate(r.id)}
                  disabled={associatingId !== null}
                >
                  {associatingId === r.id ? 'Asociando…' : 'Asociar'}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}

/** Card de descripción editable. Extraído para reducir anidamiento en ProjectDetail. */
function ProjectDetailDescriptionCard({
  description,
  editingDescription,
  descriptionDraft,
  savingDescription,
  onStartEdit,
  onCancelEdit,
  onDraftChange,
  onSave,
}: {
  description: string | null;
  editingDescription: boolean;
  descriptionDraft: string;
  savingDescription: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onDraftChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Descripción</CardTitle>
        <CardDescription>Ej: solo ramas main, mixto (varias ramas), etc.</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {editingDescription ? (
          <div className="space-y-2">
            <textarea
              value={descriptionDraft}
              onChange={(e) => onDraftChange(e.target.value)}
              placeholder="Ej: Repositorios en rama main. / Proyecto mixto: front en main, back en develop."
              rows={3}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={onSave} disabled={savingDescription}>
                {savingDescription ? 'Guardando…' : 'Guardar'}
              </Button>
              <Button size="sm" variant="outline" onClick={onCancelEdit} disabled={savingDescription}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-4">
            <p className="text-sm text-muted-foreground whitespace-pre-wrap min-h-[1.5rem]">
              {description || 'Sin descripción.'}
            </p>
            <Button variant="ghost" size="sm" onClick={onStartEdit} className="shrink-0">
              {description ? 'Editar' : 'Añadir descripción'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Página de detalle de proyecto: nombre, descripción, lista de repos, asociar repo, sync y eliminación.
 * Refactor: AssociateRepoDialog y ProjectDetailDescriptionCard extraídos para reducir anidamiento.
 */
export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [savingDescription, setSavingDescription] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [associateDialogOpen, setAssociateDialogOpen] = useState(false);
  const [allRepos, setAllRepos] = useState<Repository[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [associatingId, setAssociatingId] = useState<string | null>(null);
  const [associateError, setAssociateError] = useState<string | null>(null);
  const [associateSuccess, setAssociateSuccess] = useState<string | null>(null);
  const [deletingProject, setDeletingProject] = useState(false);
  const [regeneratingProjectId, setRegeneratingProjectId] = useState(false);
  const [resyncForProjectRepoId, setResyncForProjectRepoId] = useState<string | null>(null);
  const [roleSavingRepoId, setRoleSavingRepoId] = useState<string | null>(null);

  const fetchProject = useCallback(() => {
    if (!id) return;
    api.getProject(id).then(setProject).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api
      .getProject(id)
      .then(setProject)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (associateDialogOpen && id) {
      setLoadingRepos(true);
      setAssociateError(null);
      setAssociateSuccess(null);
      api
        .getRepositories()
        .then(setAllRepos)
        .catch((e) => setAssociateError(e.message))
        .finally(() => setLoadingRepos(false));
    }
  }, [associateDialogOpen, id]);

  const availableRepos = project
    ? allRepos.filter((r) => !project.repositories.some((pr) => pr.id === r.id))
    : [];

  /** Encola resync del repo en el contexto del proyecto y recarga el proyecto. */
  const resyncForProject = async (repoId: string) => {
    if (!id) return;
    setResyncForProjectRepoId(repoId);
    try {
      await api.resyncForProject(repoId, id);
      fetchProject();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al encolar resync');
    } finally {
      setResyncForProjectRepoId(null);
    }
  };

  /** Persiste `project_repositories.role` (inferencia de alcance en chat multi-root). */
  const saveRepoRole = async (repoId: string, value: string) => {
    if (!id) return;
    const role = value.trim() || null;
    setRoleSavingRepoId(repoId);
    setError(null);
    try {
      await api.setProjectRepositoryRole(id, repoId, role);
      setProject((prev) =>
        prev
          ? {
              ...prev,
              repositories: prev.repositories.map((r) => (r.id === repoId ? { ...r, role } : r)),
            }
          : null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar rol');
    } finally {
      setRoleSavingRepoId(null);
    }
  };

  /** Asocia un repo al proyecto (PATCH projectId), dispara sync y recarga. */
  const associateRepo = async (repoId: string) => {
    if (!id) return;
    setAssociatingId(repoId);
    setAssociateError(null);
    setAssociateSuccess(null);
    try {
      await api.updateRepository(repoId, { projectId: id });
      await api.triggerSync(repoId);
      fetchProject();
      const repo = allRepos.find((r) => r.id === repoId);
      setAssociateSuccess(
        repo
          ? `${repo.projectKey}/${repo.repoSlug} asociado. Se encoló un sync para indexarlo en este proyecto (se conserva también el índice del repo en solitario).`
          : 'Repo asociado. Sync encolado; se conserva el índice standalone y se añade al proyecto.',
      );
    } catch (e) {
      setAssociateError(e instanceof Error ? e.message : 'Error al asociar');
    } finally {
      setAssociatingId(null);
    }
  };

  /** Activa modo edición de descripción con el valor actual. */
  const startEditDescription = () => {
    setDescriptionDraft(project?.description ?? '');
    setEditingDescription(true);
  };

  /** Sale del modo edición de descripción sin guardar. */
  const cancelEditDescription = () => {
    setEditingDescription(false);
    setDescriptionDraft('');
  };

  /** Regenera el ID del proyecto y redirige al nuevo. */
  const regenerateProjectId = async () => {
    if (!id) return;
    if (
      !window.confirm(
        '¿Regenerar el ID del proyecto? Se creará un nuevo UUID. Los repos y el índice se conservan. Serás redirigido al proyecto actualizado.',
      )
    ) {
      return;
    }
    setRegeneratingProjectId(true);
    try {
      const { newProjectId } = await api.regenerateProjectId(id);
      navigate(`/projects/${newProjectId}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al regenerar ID');
    } finally {
      setRegeneratingProjectId(false);
    }
  };

  /** Elimina el proyecto (DELETE /projects/:id) tras confirmar; redirige a /. */
  const deleteProject = async () => {
    if (!id || !project) return;
    const name =
      project.name || project.repositories[0]?.projectKey + '/' + project.repositories[0]?.repoSlug || id.slice(0, 8);
    const n = project.repositories.length;
    const msg =
      n > 0
        ? `¿Eliminar el proyecto "${name}"? Los ${n} repositorio(s) no se borrarán, solo quedarán sin proyecto (podrás asociarlos a otro después).`
        : `¿Eliminar el proyecto "${name}"?`;
    if (!window.confirm(msg)) return;
    setDeletingProject(true);
    try {
      await api.deleteProject(id);
      navigate('/', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al eliminar');
    } finally {
      setDeletingProject(false);
    }
  };

  /** Guarda descripción con PATCH /projects/:id y cierra modo edición. */
  const saveDescription = async () => {
    if (!id || !project) return;
    setSavingDescription(true);
    try {
      await api.updateProject(id, { description: descriptionDraft.trim() || null });
      setProject((prev) => (prev ? { ...prev, description: descriptionDraft.trim() || null } : null));
      setEditingDescription(false);
      setDescriptionDraft('');
    } finally {
      setSavingDescription(false);
    }
  };

  /** Activa modo edición de nombre con valor actual (nombre o primer repo). */
  const startEditName = () => {
    if (!project || !id) return;
    const first = project.repositories[0];
    const current =
      project.name?.trim() ||
      (first ? `${first.projectKey}/${first.repoSlug}` : '') ||
      id.slice(0, 8) ||
      '';
    setNameDraft(current);
    setEditingName(true);
  };

  /** Guarda nombre con PATCH /projects/:id y cierra modo edición. */
  const saveName = async () => {
    if (!id || !project) return;
    const trimmed = nameDraft.trim();
    setSavingName(true);
    try {
      await api.updateProject(id, { name: trimmed || null });
      setProject((prev) => (prev ? { ...prev, name: trimmed || null } : null));
      setEditingName(false);
      setNameDraft('');
    } finally {
      setSavingName(false);
    }
  };

  if (!id) return null;
  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (error || !project) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Proyecto</h1>
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error || 'Proyecto no encontrado'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const displayName = project.name || project.repositories[0]?.projectKey + '/' + project.repositories[0]?.repoSlug || id.slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="flex flex-row items-end justify-between">
        <div>
          <div className="flex items-center gap-2">
            {editingName ? (
              <input
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveName();
                  if (e.key === 'Escape') {
                    setEditingName(false);
                    setNameDraft('');
                  }
                }}
                onBlur={() => saveName()}
                disabled={savingName}
                className="text-2xl font-bold tracking-tight border rounded px-2 py-1 w-full max-w-md focus:outline-none focus:ring-2 focus:ring-ring"
                autoFocus
              />
            ) : (
              <>
                <h1 className="text-2xl font-bold tracking-tight">{displayName}</h1>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 size-8 text-muted-foreground hover:text-foreground"
                  onClick={startEditName}
                  title="Editar nombre del proyecto"
                >
                  <Pencil className="size-4" />
                </Button>
              </>
            )}
          </div>
          <p className="text-muted-foreground mt-1">
            {project.repositories.length} repositorio{project.repositories.length !== 1 ? 's' : ''} en este proyecto
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-xs">ID (MCP):</span>
            <code
              role="button"
              tabIndex={0}
              onClick={() => id && navigator.clipboard.writeText(id)}
              onKeyDown={(e) => e.key === 'Enter' && id && navigator.clipboard.writeText(id)}
              title="Clic para copiar"
              className="select-text cursor-pointer rounded bg-muted px-1.5 py-0.5 text-xs font-mono hover:bg-muted/80"
            >
              {id}
            </code>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={regenerateProjectId}
              disabled={regeneratingProjectId}
              title="Regenerar ID del proyecto (sin perder datos)"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${regeneratingProjectId ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link to={`/projects/${id}/chat`}>Chat (proyecto)</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to={`/repos/new?projectId=${id}`}>Repositorio nuevo</Link>
          </Button>
          <Button variant="outline" onClick={() => setAssociateDialogOpen(true)}>
            Asociar repo existente
          </Button>
          <Button
            variant="destructive"
            onClick={deleteProject}
            disabled={deletingProject}
            title="Eliminar proyecto; los repos quedarán sin proyecto"
          >
            {deletingProject ? 'Eliminando…' : 'Eliminar proyecto'}
          </Button>
        </div>
      </div>

      <AssociateRepoDialog
        open={associateDialogOpen}
        onOpenChange={setAssociateDialogOpen}
        loadingRepos={loadingRepos}
        associateError={associateError}
        associateSuccess={associateSuccess}
        associatingId={associatingId}
        availableRepos={availableRepos}
        onAssociate={associateRepo}
      />

      <ProjectDetailDescriptionCard
        description={project.description}
        editingDescription={editingDescription}
        descriptionDraft={descriptionDraft}
        savingDescription={savingDescription}
        onStartEdit={startEditDescription}
        onCancelEdit={cancelEditDescription}
        onDraftChange={setDescriptionDraft}
        onSave={saveDescription}
      />

      <Card>
        <CardHeader>
          <CardTitle>Repositorios</CardTitle>
          <CardDescription>
            Chat, índice y análisis por repo; grafo común al proyecto. Rol (p. ej. frontend, backend): inferencia
            de alcance en chat multi-root.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {project.repositories.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center gap-3">
              <p className="text-muted-foreground">Sin repositorios. Añade uno nuevo o asocia uno ya registrado.</p>
              <div className="flex gap-2">
                <Button asChild>
                  <Link to={`/repos/new?projectId=${id}`}>Repositorio nuevo</Link>
                </Button>
                <Button variant="outline" onClick={() => setAssociateDialogOpen(true)}>
                  Asociar repo existente
                </Button>
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Repo</TableHead>
                  <TableHead className="min-w-[8rem]">Rol (chat)</TableHead>
                  <TableHead>Rama</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Último sync</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {project.repositories.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link to={`/repos/${r.id}`} className="font-medium hover:underline">
                        {r.projectKey}/{r.repoSlug}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Input
                        key={`${r.id}-${r.role ?? ''}`}
                        className="h-8 max-w-[10rem] text-xs font-mono"
                        placeholder="p. ej. frontend"
                        defaultValue={r.role ?? ''}
                        disabled={roleSavingRepoId === r.id}
                        onBlur={(e) => {
                          const v = e.target.value;
                          if ((v.trim() || '') === (r.role ?? '')) return;
                          void saveRepoRole(r.id, v);
                        }}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {r.defaultBranch || '—'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status as 'pending' | 'syncing' | 'ready' | 'error'} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.lastSyncAt ? new Date(r.lastSyncAt).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => resyncForProject(r.id)}
                        disabled={resyncForProjectRepoId !== null}
                        title="Reindexar este repo solo en este proyecto"
                      >
                        {resyncForProjectRepoId === r.id ? 'Encolando…' : 'Resync (proyecto)'}
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <Link to={`/repos/${r.id}/chat`}>Chat (repo)</Link>
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <Link to={`/repos/${r.id}`}>Detalle</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
