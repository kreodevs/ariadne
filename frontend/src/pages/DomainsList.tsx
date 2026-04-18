/**
 * @fileoverview CRUD de dominios de arquitectura (color, metadata).
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api';
import type { Domain } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export function DomainsList() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [desc, setDesc] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .getDomains()
      .then(setDomains)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.createDomain({ name: name.trim(), color, description: desc.trim() || null });
      setName('');
      setDesc('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('¿Eliminar este dominio? Los proyectos quedarán sin dominio (SET NULL).')) return;
    try {
      await api.deleteDomain(id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dominios</h1>
        <p className="text-muted-foreground mt-1">
          Gobierno de arquitectura C4: agrupa proyectos y colorea diagramas / whitelist entre dominios.
        </p>
        <Button variant="link" className="px-0 h-auto" asChild>
          <Link to="/projects">← Volver a proyectos</Link>
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nuevo dominio</CardTitle>
          <CardDescription>Nombre y color hexadecimal para PlantUML / UI.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4 items-end">
          <div className="space-y-1 min-w-[200px]">
            <Label htmlFor="dn">Nombre</Label>
            <Input id="dn" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Pagos" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dc">Color</Label>
            <Input
              id="dc"
              type="color"
              value={color.length === 7 ? color : '#6366f1'}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-16 p-1"
            />
          </div>
          <div className="space-y-1 flex-1 min-w-[200px]">
            <Label htmlFor="dd">Descripción</Label>
            <Input id="dd" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Opcional" />
          </div>
          <Button type="button" onClick={() => void create()} disabled={saving || !name.trim()}>
            {saving ? 'Guardando…' : 'Crear'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Listado</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : domains.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay dominios.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Color</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="w-[100px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {domains.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-block size-5 rounded border border-border"
                          style={{ backgroundColor: d.color }}
                        />
                        <code className="text-xs">{d.color}</code>
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm max-w-[320px] truncate">
                      {d.description ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Button type="button" variant="destructive" size="sm" onClick={() => void remove(d.id)}>
                        Eliminar
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
