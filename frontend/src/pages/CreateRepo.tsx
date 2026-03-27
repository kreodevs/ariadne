/**
 * @fileoverview Formulario para crear un repositorio. Flujo: Provider → Credencial → Workspace/Owner → Proyecto/Repo → Branch.
 * Workspace, proyecto y branch son selects poblados desde la API con la credencial.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import type { CreateRepositoryDto, Credential } from '../types';
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

/** Etiqueta del primer selector según provider (Bitbucket: Workspace, GitHub: Owner). */
const workspaceLabel = (provider: string) => (provider === 'github' ? 'Owner' : 'Workspace');
/** Etiqueta del selector de repo (GitHub: Repositorio, Bitbucket: Proyecto). */
const projectLabel = (provider: string) => (provider === 'github' ? 'Repositorio' : 'Proyecto');

type CredentialsFormFieldsProps = {
  dto: CreateRepositoryDto;
  setDto: React.Dispatch<React.SetStateAction<CreateRepositoryDto>>;
  provider: 'bitbucket' | 'github';
  workspaces: Array<{ slug: string; name?: string }>;
  owners: Array<{ login: string }>;
  repositories: Array<{ slug?: string; name?: string; default_branch?: string }>;
  branches: string[];
  loadingDiscovery: boolean;
};

/** Bloques de formulario cuando hay credencial: workspace/owner, proyecto/repo, branch, webhook (Bitbucket). */
function CredentialsFormFields({
  dto,
  setDto,
  provider,
  workspaces,
  owners,
  repositories,
  branches,
  loadingDiscovery,
}: CredentialsFormFieldsProps) {
  const wLabel = workspaceLabel(provider);
  const pLabel = projectLabel(provider);
  return (
    <>
      <div className="space-y-2">
        <Label>{wLabel}</Label>
        <Select
          value={dto.projectKey}
          onValueChange={(v) =>
            setDto((x) => ({ ...x, projectKey: v, repoSlug: '', defaultBranch: 'main' }))
          }
          disabled={loadingDiscovery}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={loadingDiscovery ? 'Cargando…' : 'Seleccionar'} />
          </SelectTrigger>
          <SelectContent>
            {provider === 'bitbucket'
              ? workspaces.map((w) => (
                  <SelectItem key={w.slug} value={w.slug}>
                    {w.name ?? w.slug}
                  </SelectItem>
                ))
              : owners.map((o) => (
                  <SelectItem key={o.login} value={o.login}>
                    {o.login}
                  </SelectItem>
                ))}
          </SelectContent>
        </Select>
      </div>
      {dto.projectKey && (
        <div className="space-y-2">
          <Label>{pLabel}</Label>
          <Select
            value={dto.repoSlug}
            onValueChange={(v) => setDto((x) => ({ ...x, repoSlug: v }))}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Seleccionar" />
            </SelectTrigger>
            <SelectContent>
              {repositories.map((r) => {
                const val = r.slug ?? r.name ?? '';
                return (
                  <SelectItem key={val} value={val}>
                    {r.name ?? r.slug ?? val}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-2">
        <Label>Repo slug (editable)</Label>
        <Input
          required
          value={dto.repoSlug}
          onChange={(e) => setDto((x) => ({ ...x, repoSlug: e.target.value }))}
          placeholder="my-repo"
        />
      </div>
      <div className="space-y-2">
        <Label>Branch por defecto</Label>
        <Select
          value={dto.defaultBranch ?? 'main'}
          onValueChange={(v) => setDto((x) => ({ ...x, defaultBranch: v }))}
          disabled={branches.length === 0}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {branches.map((b) => (
              <SelectItem key={b} value={b}>
                {b}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {provider === 'bitbucket' && (
        <div className="space-y-2">
          <Label>Webhook secret (opcional)</Label>
          <p className="text-xs text-muted-foreground">
            Si configuras un webhook en Bitbucket, usa el mismo secret aquí para validar las
            peticiones.
          </p>
          <Input
            type="password"
            value={dto.webhookSecret ?? ''}
            onChange={(e) =>
              setDto((x) => ({ ...x, webhookSecret: e.target.value || null }))
            }
            placeholder="Opcional. El mismo valor que en Bitbucket → Webhooks"
          />
        </div>
      )}
    </>
  );
}

/** Carga workspaces/owners, repos y branches según credencial y dto. Reduce anidamiento en CreateRepo. */
function useCreateRepoDiscovery(
  dto: CreateRepositoryDto,
  setDto: React.Dispatch<React.SetStateAction<CreateRepositoryDto>>,
  credentialsRef: string | null,
  setError: (msg: string | null) => void,
) {
  const [workspaces, setWorkspaces] = useState<Array<{ slug: string; name?: string }>>([]);
  const [owners, setOwners] = useState<Array<{ login: string }>>([]);
  const [repositories, setRepositories] = useState<
    Array<{ slug?: string; name?: string; default_branch?: string }>
  >([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [loadingDiscovery, setLoadingDiscovery] = useState(false);

  useEffect(() => {
    if (!credentialsRef) {
      setWorkspaces([]);
      setOwners([]);
      setRepositories([]);
      setBranches([]);
      return;
    }
    setLoadingDiscovery(true);
    setError(null);
    if (dto.provider === 'bitbucket') {
      api
        .listBitbucketWorkspaces(credentialsRef)
        .then(setWorkspaces)
        .catch((e) => {
          setWorkspaces([]);
          setError(e.message);
        })
        .finally(() => setLoadingDiscovery(false));
    } else {
      api
        .listGitHubOwners(credentialsRef)
        .then(setOwners)
        .catch((e) => {
          setOwners([]);
          setError(e.message);
        })
        .finally(() => setLoadingDiscovery(false));
    }
  }, [dto.provider, credentialsRef, setError]);

  useEffect(() => {
    if (!credentialsRef) return;
    if (dto.provider === 'bitbucket' && dto.projectKey) {
      api
        .listBitbucketRepositories(dto.projectKey, credentialsRef)
        .then(setRepositories)
        .catch(() => setRepositories([]));
    } else if (dto.provider === 'github' && dto.projectKey) {
      api
        .listGitHubRepositories(dto.projectKey, credentialsRef)
        .then(setRepositories)
        .catch(() => setRepositories([]));
    } else {
      setRepositories([]);
    }
  }, [dto.provider, credentialsRef, dto.projectKey]);

  useEffect(() => {
    if (repositories.length === 0) return;
    const suggested =
      dto.provider === 'bitbucket'
        ? repositories.find((r) => r.slug)?.slug ?? repositories[0]?.name
        : repositories[0]?.name;
    if (suggested && !dto.repoSlug) {
      setDto((x) => ({ ...x, repoSlug: suggested }));
    }
  }, [dto.provider, repositories, dto.repoSlug, setDto]);

  useEffect(() => {
    if (!credentialsRef || !dto.projectKey || !dto.repoSlug) {
      setBranches([]);
      return;
    }
    if (dto.provider === 'bitbucket') {
      api
        .listBitbucketBranches(dto.projectKey, dto.repoSlug, credentialsRef)
        .then((r) => {
          setBranches(r.branches);
          setDto((x) => ({
            ...x,
            defaultBranch:
              r.branches.includes('main') ? 'main' : r.branches.includes('master') ? 'master' : r.branches[0] ?? 'main',
          }));
        })
        .catch(() => setBranches([]));
    } else {
      api
        .listGitHubBranches(dto.projectKey, dto.repoSlug, credentialsRef)
        .then((r) => {
          setBranches(r.branches);
          const def =
            repositories.find((re) => (re.slug ?? re.name) === dto.repoSlug)?.default_branch ?? 'main';
          setDto((x) => ({
            ...x,
            defaultBranch: r.branches.includes(def) ? def : r.branches[0] ?? 'main',
          }));
        })
        .catch(() => setBranches([]));
    }
  }, [dto.provider, credentialsRef, dto.projectKey, dto.repoSlug, repositories, setDto]);

  return { workspaces, owners, repositories, branches, loadingDiscovery };
}

function CreateRepoProviderSelect({
  provider,
  onProviderChange,
  onCredentialReset,
}: {
  provider: string;
  onProviderChange: (v: 'bitbucket' | 'github') => void;
  onCredentialReset: () => void;
}) {
  const handleChange = (v: string) => {
    onProviderChange(v as 'bitbucket' | 'github');
    onCredentialReset();
  };
  return (
    <div className="space-y-2">
      <Label>Provider</Label>
      <Select value={provider} onValueChange={handleChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="bitbucket">Bitbucket</SelectItem>
          <SelectItem value="github">GitHub</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function CreateRepoCredentialSelect({
  credentialsRef,
  credentials,
  onCredentialChange,
  onDtoReset,
}: {
  credentialsRef: string | null;
  credentials: Credential[];
  onCredentialChange: (id: string | null) => void;
  onDtoReset: () => void;
}) {
  const handleChange = (v: string) => {
    onCredentialChange(v === '__none__' ? null : v);
    onDtoReset();
  };
  return (
    <div className="space-y-2">
      <Label>Credencial (requerida)</Label>
      <p className="text-xs text-muted-foreground">
        Crea una en{' '}
        <Link to="/credentials/new" className="underline hover:text-foreground">
          Credenciales → Nueva
        </Link>{' '}
        si no tienes ninguna. Sin credencial no se pueden listar workspaces ni repos.
      </p>
      <Select value={credentialsRef ?? '__none__'} onValueChange={handleChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Selecciona una credencial" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">— Seleccionar —</SelectItem>
          {credentials.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name ?? `${c.provider} / ${c.kind}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {credentials.length === 0 && (
        <Button type="button" variant="outline" size="sm" className="mt-1" asChild>
          <Link to="/credentials/new">+ Añadir credencial (token/PAT)</Link>
        </Button>
      )}
    </div>
  );
}

/**
 * Página de alta de repositorio. Flujo: Provider → Credencial → Workspace/Owner → Proyecto/Repo → Branch.
 * POST /repositories con selects en cascada. Query ?projectId= para añadir a proyecto existente (multi-root).
 * Refactor: useCreateRepoDiscovery + CreateRepoProviderSelect + CreateRepoCredentialSelect reducen nesting.
 */
export function CreateRepo() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectIdFromUrl = searchParams.get('projectId') || undefined;
  const [dto, setDto] = useState<CreateRepositoryDto>({
    provider: 'bitbucket',
    projectKey: '',
    repoSlug: '',
    defaultBranch: 'main',
    webhookSecret: null,
  });
  const [credentialsRef, setCredentialsRef] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getCredentials(dto.provider).then(setCredentials).catch(() => setCredentials([]));
  }, [dto.provider]);

  const discovery = useCreateRepoDiscovery(dto, setDto, credentialsRef, setError);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!credentialsRef) {
      setError('Selecciona una credencial para continuar.');
      return;
    }
    setSubmitting(true);
    api
      .createRepository({
        ...dto,
        credentialsRef,
        webhookSecret: dto.webhookSecret?.trim() || null,
        projectId: projectIdFromUrl ?? null,
      })
      .then((r) => navigate(projectIdFromUrl ? `/projects/${projectIdFromUrl}` : `/repos/${r.id}`))
      .catch((e) => {
        setError(e.message);
        setSubmitting(false);
      });
  };

  const resetDtoKeys = () =>
    setDto((x) => ({ ...x, projectKey: '', repoSlug: '', defaultBranch: 'main' }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/repos">← Repos</Link>
        </Button>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Alta de repositorio</CardTitle>
          <CardDescription>
            Configura un nuevo repositorio para sincronizar con el grafo. Selecciona la credencial y
            luego elige workspace, proyecto y branch.
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
            <CreateRepoProviderSelect
              provider={dto.provider}
              onProviderChange={(v) =>
                setDto((x) => ({ ...x, provider: v, projectKey: '', repoSlug: '', defaultBranch: 'main' }))
              }
              onCredentialReset={() => setCredentialsRef(null)}
            />
            <CreateRepoCredentialSelect
              credentialsRef={credentialsRef}
              credentials={credentials}
              onCredentialChange={setCredentialsRef}
              onDtoReset={resetDtoKeys}
            />
            {credentialsRef && (
              <CredentialsFormFields
                dto={dto}
                setDto={setDto}
                provider={dto.provider}
                workspaces={discovery.workspaces}
                owners={discovery.owners}
                repositories={discovery.repositories}
                branches={discovery.branches}
                loadingDiscovery={discovery.loadingDiscovery}
              />
            )}
            <div className="flex gap-2 pt-2">
              <Button
                type="submit"
                disabled={submitting || !credentialsRef || !dto.projectKey || !dto.repoSlug}
              >
                {submitting ? 'Creando...' : 'Crear'}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link to="/">Cancelar</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
