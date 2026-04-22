/**
 * @fileoverview Formulario para editar repositorio. Alineado con CreateRepo: credencial, branch, webhook secret.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import type { Credential, IndexIncludeEntry, Repository, UpdateRepositoryDto } from '../types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/** Página de edición de repositorio. PATCH /repositories/:id con defaultBranch, credentialsRef y webhookSecret. */
export function EditRepo() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [repo, setRepo] = useState<Repository | null>(null);
  const [dto, setDto] = useState<UpdateRepositoryDto>({
    defaultBranch: 'main',
    credentialsRef: null,
  });
  const [webhookSecret, setWebhookSecret] = useState('');
  const [webhookSecretTouched, setWebhookSecretTouched] = useState(false);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** full = columna null en servidor; scoped = indexIncludeRules */
  const [indexScopeMode, setIndexScopeMode] = useState<'full' | 'scoped'>('full');
  const [indexEntries, setIndexEntries] = useState<IndexIncludeEntry[]>([]);

  const newEmptyEntry = (): IndexIncludeEntry => ({ kind: 'path_prefix', path: '' });

  useEffect(() => {
    if (!id) return;
    api
      .getRepository(id)
      .then((r) => {
        setRepo(r);
        setDto({ defaultBranch: r.defaultBranch ?? 'main', credentialsRef: r.credentialsRef ?? null });
        if (r.indexIncludeRules != null) {
          setIndexScopeMode('scoped');
          setIndexEntries(
            r.indexIncludeRules.entries?.length
              ? r.indexIncludeRules.entries.map((e) => ({ ...e }))
              : [],
          );
        } else {
          setIndexScopeMode('full');
          setIndexEntries([]);
        }
        api.getCredentials(r.provider).then(setCredentials).catch(() => setCredentials([]));
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const credentialsRef = dto.credentialsRef ?? repo?.credentialsRef ?? null;
  useEffect(() => {
    if (!id) return;
    setBranchesLoading(true);
    api.getBranches(id, credentialsRef).then(({ branches: b }) => setBranches(b)).catch(() => setBranches([])).finally(() => setBranchesLoading(false));
  }, [id, credentialsRef]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setError(null);
    setSubmitting(true);
    try {
      const payload: UpdateRepositoryDto = {
        defaultBranch: dto.defaultBranch ?? 'main',
        credentialsRef: dto.credentialsRef ?? null,
      };
      if (webhookSecretTouched) payload.webhookSecret = webhookSecret.trim() ? webhookSecret.trim() : null;
      if (indexScopeMode === 'full') {
        payload.indexIncludeRules = null;
      } else {
        const cleaned = indexEntries
          .map((e) => ({
            kind: e.kind,
            path: e.path.replace(/\\/g, '/').trim(),
          }))
          .filter((e) => e.path.length > 0);
        payload.indexIncludeRules = { entries: cleaned };
      }
      await api.updateRepository(id, payload);
      navigate(`/repos/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (error && !repo) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/repos">← Repos</Link>
        </Button>
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!repo) return null;

  const workspaceLabel = repo.provider === 'github' ? 'Owner' : 'Workspace';
  const projectLabel = repo.provider === 'github' ? 'Repositorio' : 'Proyecto';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/repos/${id}`}>← Detalle</Link>
        </Button>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Editar repositorio</CardTitle>
          <CardDescription>
            Credencial, branch, webhook secret y opcionalmente qué rutas indexa el sync. Provider y
            repositorio no se pueden cambiar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label>Provider</Label>
              <Input value={repo.provider} disabled className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label>{workspaceLabel}</Label>
              <Input value={repo.projectKey} disabled className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label>{projectLabel}</Label>
              <Input value={repo.repoSlug} disabled className="bg-muted" />
            </div>

            <div className="space-y-2">
              <Label>Credencial (opcional)</Label>
              <Select
                value={dto.credentialsRef ?? '__none__'}
                onValueChange={(v) =>
                  setDto((x) => ({ ...x, credentialsRef: v === '__none__' ? null : v }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Usar variables de entorno" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Usar variables de entorno —</SelectItem>
                  {credentials.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name ?? `${c.provider} / ${c.kind}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Branch por defecto</Label>
              <Select
                value={dto.defaultBranch ?? 'main'}
                onValueChange={(v) =>
                  setDto((x) => ({ ...x, defaultBranch: v || 'main' }))
                }
                disabled={branchesLoading}
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={branchesLoading ? 'Cargando branches...' : 'Seleccionar'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {[...new Set([dto.defaultBranch ?? 'main', ...branches])].map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Alcance del índice (sync / grafo)</Label>
              <Select
                value={indexScopeMode}
                onValueChange={(v) => setIndexScopeMode(v as 'full' | 'scoped')}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Todo el repositorio</SelectItem>
                  <SelectItem value="scoped">Restringido (prefijos y/o archivos)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Si eliges restringido, además de lo que añadas abajo siempre entran en el índice{' '}
                <span className="font-mono text-[11px]">package.json</span> en la raíz del repo y
                los archivos en raíz con extensión{' '}
                <span className="font-mono text-[11px]">.json</span>,{' '}
                <span className="font-mono text-[11px]">.js</span>,{' '}
                <span className="font-mono text-[11px]">.ts</span>,{' '}
                <span className="font-mono text-[11px]">.jsx</span>,{' '}
                <span className="font-mono text-[11px]">.tsx</span> (sin dotfiles). Una entrada{' '}
                <em>Carpeta / prefijo</em> indexa todo lo que ya califique para el índice bajo esa
                ruta. Tras guardar, vuelve a sincronizar el repo.
              </p>
              {indexScopeMode === 'scoped' && (
                <div className="space-y-3 rounded-md border p-3">
                  {indexEntries.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Sin entradas = solo manifiestos/código en la raíz del proyecto. Usa «Añadir
                      entrada» para carpetas o archivos concretos.
                    </p>
                  )}
                  {indexEntries.map((row, i) => (
                    <div key={i} className="flex flex-wrap items-end gap-2">
                      <div className="min-w-[140px] flex-1 space-y-1">
                        <Label className="text-xs">Tipo</Label>
                        <Select
                          value={row.kind}
                          onValueChange={(v) =>
                            setIndexEntries((rows) =>
                              rows.map((r, j) =>
                                j === i ? { ...r, kind: v as IndexIncludeEntry['kind'] } : r,
                              ),
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="path_prefix">Carpeta / prefijo</SelectItem>
                            <SelectItem value="file">Archivo</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="min-w-[200px] flex-[2] space-y-1">
                        <Label className="text-xs">Ruta relativa al repo</Label>
                        <Input
                          value={row.path}
                          onChange={(e) =>
                            setIndexEntries((rows) =>
                              rows.map((r, j) => (j === i ? { ...r, path: e.target.value } : r)),
                            )
                          }
                          placeholder={
                            row.kind === 'path_prefix'
                              ? 'ej. apps/web o services/ingest'
                              : 'ej. prisma/schema.prisma'
                          }
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="shrink-0"
                        onClick={() => setIndexEntries((rows) => rows.filter((_, j) => j !== i))}
                      >
                        Quitar
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIndexEntries((rows) => [...rows, newEmptyEntry()])}
                  >
                    Añadir entrada
                  </Button>
                </div>
              )}
            </div>

            {repo.provider === 'bitbucket' && (
              <div className="space-y-2">
                <Label>Webhook secret</Label>
                <p className="text-xs text-muted-foreground">
                  El mismo valor que en Bitbucket → Webhooks. Vacío para borrar. No modificar para
                  mantener el actual.
                </p>
                <Input
                  type="password"
                  value={webhookSecret}
                  onChange={(e) => {
                    setWebhookSecret(e.target.value);
                    setWebhookSecretTouched(true);
                  }}
                  placeholder="Solo si quieres cambiar: nuevo valor o vacío para borrar"
                />
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Guardando...' : 'Guardar'}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link to={`/repos/${id}`}>Cancelar</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
