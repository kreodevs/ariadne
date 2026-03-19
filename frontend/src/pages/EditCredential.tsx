/**
 * @fileoverview Formulario para editar credencial existente (nombre, valor).
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import type { Credential, UpdateCredentialDto } from '../types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/** Página de edición de credencial. PATCH /credentials/:id con name y opcional value. */
export function EditCredential() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [cred, setCred] = useState<Credential | null>(null);
  const [dto, setDto] = useState<UpdateCredentialDto>({ name: null });
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .getCredential(id)
      .then((c) => {
        setCred(c);
        setDto({ name: c.name ?? null });
        if (c.kind === 'app_password' && c.extra?.username) setUsername(String(c.extra.username));
        if (c.kind === 'token' && c.provider === 'bitbucket' && c.extra?.email) setEmail(String(c.extra.email));
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const buildExtra = (): UpdateCredentialDto['extra'] => {
    if (cred?.kind === 'app_password' && username) return { username };
    if (cred?.kind === 'token' && cred?.provider === 'bitbucket') return { email: email.trim() };
    return undefined;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setError(null);
    setSubmitting(true);
    try {
      const payload: UpdateCredentialDto = {
        name: dto.name || null,
        extra: buildExtra(),
      };
      if (dto.value != null && dto.value.trim() !== '') payload.value = dto.value.trim();
      await api.updateCredential(id, payload);
      navigate('/credentials');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (error && !cred) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/credentials">← Credenciales</Link>
        </Button>
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!cred) return null;

  const showUsername = cred.kind === 'app_password';
  const showTokenEmail = cred.kind === 'token' && cred.provider === 'bitbucket';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/credentials">← Credenciales</Link>
        </Button>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Editar credencial</CardTitle>
          <CardDescription>
            {cred.provider} / {cred.kind}
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
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@email.com"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Nuevo valor (token/password)</Label>
              <p className="text-xs text-muted-foreground">
                Dejar vacío para mantener el actual. Si el token expiró o falló (401), pega aquí un token nuevo.
                Tokens de hasta 300+ caracteres se guardan completos.
              </p>
              <Input
                type="password"
                value={dto.value ?? ''}
                onChange={(e) => setDto((x) => ({ ...x, value: e.target.value || undefined }))}
                placeholder="Dejar vacío = no cambiar"
                autoComplete="off"
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
                {submitting ? 'Guardando...' : 'Guardar'}
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
