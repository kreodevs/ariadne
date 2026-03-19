/**
 * @fileoverview Formulario para crear credencial (token, app_password, webhook_secret).
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, API_BASE } from '../api';
import type { CreateCredentialDto } from '../types';
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

/** Página de alta de credencial. POST /credentials con provider, kind, value. */
export function CreateCredential() {
  const navigate = useNavigate();
  const [dto, setDto] = useState<CreateCredentialDto>({
    provider: 'bitbucket',
    kind: 'token',
    value: '',
    name: '',
  });
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kinds: CreateCredentialDto['kind'][] =
    dto.provider === 'github'
      ? ['token']
      : ['token', 'app_password', 'webhook_secret'];
  const showUsername = dto.kind === 'app_password';
  const showTokenEmail = dto.provider === 'bitbucket' && dto.kind === 'token';
  const showWebhookHelp = dto.provider === 'bitbucket' && dto.kind === 'webhook_secret';
  const showAppPasswordHelp = dto.provider === 'bitbucket' && dto.kind === 'app_password';
  const showTokenHelp = dto.kind === 'token';

  const webhookUrl = `${API_BASE}/webhooks/bitbucket`;

  /** Envía POST /credentials con dto y extra (username/email según kind); redirige a /credentials. */
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const payload: CreateCredentialDto = {
      ...dto,
      name: dto.name || null,
      extra:
        showUsername && username
          ? { username }
          : showTokenEmail && email
            ? { email: email.trim() }
            : null,
    };
    api
      .createCredential(payload)
      .then(() => navigate('/credentials'))
      .catch((e) => {
        setError(e.message);
        setSubmitting(false);
      });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/credentials">← Credenciales</Link>
        </Button>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Nueva credencial</CardTitle>
          <CardDescription>
            Almacena tokens o secrets cifrados para conectar con repositorios.
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
              <Select
                value={dto.provider}
                onValueChange={(v) =>
                  setDto((x) => ({
                    ...x,
                    provider: v as 'bitbucket' | 'github',
                    kind: v === 'github' ? 'token' : x.kind,
                  }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bitbucket">Bitbucket</SelectItem>
                  <SelectItem value="github">GitHub</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select
                value={dto.kind}
                onValueChange={(v) =>
                  setDto((x) => ({ ...x, kind: v as CreateCredentialDto['kind'] }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kinds.includes('token') && (
                    <SelectItem value="token">Token (OAuth/PAT)</SelectItem>
                  )}
                  {kinds.includes('app_password') && (
                    <SelectItem value="app_password">App Password</SelectItem>
                  )}
                  {kinds.includes('webhook_secret') && (
                    <SelectItem value="webhook_secret">Webhook Secret</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            {showWebhookHelp && (
              <Alert>
                <AlertTitle>Configurar webhook en Bitbucket</AlertTitle>
                <AlertDescription>
                  <ol className="mt-2 list-inside list-decimal space-y-1">
                    <li>
                      Repo → <strong>Repository settings</strong> → <strong>Webhooks</strong> → Add webhook
                    </li>
                    <li>
                      <strong>URL:</strong>{' '}
                      <code className="break-all rounded bg-muted px-1 py-0.5">
                        {webhookUrl}/webhooks/bitbucket
                      </code>
                    </li>
                    <li>
                      <strong>Triggers:</strong> Push (o Repository push)
                    </li>
                    <li>
                      Pega aquí el <strong>Secret</strong> que definas en Bitbucket (debe coincidir)
                    </li>
                  </ol>
                </AlertDescription>
              </Alert>
            )}
            {showAppPasswordHelp && (
              <Alert>
                <AlertTitle>App Password de Bitbucket</AlertTitle>
                <AlertDescription>
                  <ol className="mt-2 list-inside list-decimal space-y-1">
                    <li>
                      Bitbucket → <strong>Personal settings</strong> (engranaje) → <strong>App passwords</strong>
                    </li>
                    <li>
                      <strong>Create app password</strong> → marcar: <strong>Account: Read</strong>, <strong>Workspace membership: Read</strong>, <strong>Repositories: Read</strong>, <strong>Projects: Read</strong> (opcional)
                    </li>
                    <li>
                      Usuario = tu email de Bitbucket / Atlassian
                    </li>
                    <li>
                      Valor = la contraseña generada (solo se muestra una vez)
                    </li>
                  </ol>
                </AlertDescription>
              </Alert>
            )}
            {showTokenHelp && (
              <Alert>
                <AlertTitle>
                  {dto.provider === 'bitbucket'
                    ? 'Token (API Token) de Bitbucket'
                    : 'Personal Access Token de GitHub'}
                </AlertTitle>
                <AlertDescription>
                  {dto.provider === 'bitbucket' ? (
                    <ol className="mt-2 list-inside list-decimal space-y-1">
                      <li>
                        Perfil (esquina superior derecha) → <strong>Account settings</strong> → <strong>Security</strong>
                      </li>
                      <li>
                        <strong>Create and manage API tokens</strong> → Create API token with scopes
                      </li>
                      <li>
                        App: Bitbucket → Permisos: <strong>Account: Read</strong>, <strong>Workspace membership: Read</strong>, <strong>Repositories: Read</strong>, <strong>Projects: Read</strong> (opcional)
                      </li>
                      <li>
                        <strong>Email Atlassian:</strong> el mismo que usas para iniciar sesión (necesario para Basic auth)
                      </li>
                      <li>
                        Copia el token y pégalo aquí (solo se muestra una vez)
                      </li>
                    </ol>
                  ) : (
                    <ol className="mt-2 list-inside list-decimal space-y-1">
                      <li>
                        GitHub → <strong>Settings</strong> → <strong>Developer settings</strong> → Personal access tokens
                      </li>
                      <li>
                        Generate new token (classic o fine-grained)
                      </li>
                      <li>
                        Scope: <strong>repo</strong> (o permisos de lectura de repositorios)
                      </li>
                      <li>
                        Copia el token y pégalo aquí (solo se muestra una vez)
                      </li>
                    </ol>
                  )}
                </AlertDescription>
              </Alert>
            )}
            {showUsername && (
              <div className="space-y-2">
                <Label>Usuario Bitbucket</Label>
                <Input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="email@ejemplo.com"
                />
              </div>
            )}
            {showTokenEmail && (
              <div className="space-y-2">
                <Label>Email Atlassian</Label>
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@email.com"
                />
                <p className="text-xs text-muted-foreground">
                  El email de tu cuenta Atlassian. Los API tokens usan Basic auth (email:token).
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label>Valor (token/password/secret)</Label>
              <Input
                type="password"
                required
                value={dto.value}
                onChange={(e) => setDto((x) => ({ ...x, value: e.target.value }))}
                placeholder="********"
              />
            </div>
            <div className="space-y-2">
              <Label>Nombre (opcional)</Label>
              <Input
                type="text"
                value={dto.name ?? ''}
                onChange={(e) =>
                  setDto((x) => ({ ...x, name: e.target.value || null }))
                }
                placeholder="Mi workspace token"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Creando...' : 'Crear'}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link to="/credentials">Cancelar</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
