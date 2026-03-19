/**
 * @fileoverview Lista de credenciales con tabla y acciones Editar/Eliminar.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Credential } from '../types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

/** Lista credenciales con GET /credentials, link a /credentials/new y /credentials/:id/edit. */
export function CredentialsList() {
  const [creds, setCreds] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Carga GET /credentials y actualiza estado. */
  const load = () => {
    api
      .getCredentials()
      .then(setCreds)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), []);

  /** Elimina credencial con DELETE /credentials/:id tras confirmar; recarga la lista. */
  const onDelete = (id: string) => {
    if (!confirm('¿Eliminar esta credencial?')) return;
    api
      .deleteCredential(id)
      .then(load)
      .catch((e) => setError(e.message));
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-64 mt-2" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Credenciales</h1>
        <p className="text-muted-foreground mt-1">
          Tokens y secrets cifrados en BD. Se usan en repos cuando se asigna credentialsRef.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle>Listado</CardTitle>
            <CardDescription>{creds.length} credencial{creds.length !== 1 ? 'es' : ''}</CardDescription>
          </div>
          <Button asChild>
            <Link to="/credentials/new">Nueva credencial</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {creds.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-muted-foreground mb-2">No hay credenciales.</p>
              <Button asChild>
                <Link to="/credentials/new">Crear una</Link>
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Creado</TableHead>
                  <TableHead className="w-[180px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {creds.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.provider}</TableCell>
                    <TableCell>{c.kind}</TableCell>
                    <TableCell>{c.name ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(c.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="outline" size="sm" asChild>
                          <Link to={`/credentials/${c.id}/edit`}>Editar</Link>
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => onDelete(c.id)}
                        >
                          Eliminar
                        </Button>
                      </div>
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
