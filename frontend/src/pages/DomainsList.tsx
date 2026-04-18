/**
 * @fileoverview CRUD de dominios de arquitectura (color, metadata, recuento de proyectos, visibilidad C4).
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api';
import type { Domain, DomainVisibilityEdge } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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

  const [projectsDialogDomain, setProjectsDialogDomain] = useState<Domain | null>(null);
  const [projectsInDomain, setProjectsInDomain] = useState<Array<{ id: string; name: string | null }>>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);

  const [visDialogDomain, setVisDialogDomain] = useState<Domain | null>(null);
  const [visEdges, setVisEdges] = useState<DomainVisibilityEdge[]>([]);
  const [loadingVis, setLoadingVis] = useState(false);
  const [addVisTargetId, setAddVisTargetId] = useState('');
  const [addVisDesc, setAddVisDesc] = useState('');
  const [addingVis, setAddingVis] = useState(false);

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

  const openProjectsDialog = (d: Domain) => {
    setProjectsDialogDomain(d);
    setLoadingProjects(true);
    setProjectsInDomain([]);
    api
      .getDomainProjects(d.id)
      .then(setProjectsInDomain)
      .catch((e) => setError(e.message))
      .finally(() => setLoadingProjects(false));
  };

  const openVisDialog = (d: Domain) => {
    setVisDialogDomain(d);
    setAddVisTargetId('');
    setAddVisDesc('');
    setLoadingVis(true);
    setVisEdges([]);
    api
      .listDomainVisibility(d.id)
      .then(setVisEdges)
      .catch((e) => setError(e.message))
      .finally(() => setLoadingVis(false));
  };

  const refreshVis = (fromId: string) => {
    api.listDomainVisibility(fromId).then(setVisEdges).catch((e) => setError(e.message));
  };

  const addVisibilityEdge = async () => {
    if (!visDialogDomain || !addVisTargetId) return;
    setAddingVis(true);
    setError(null);
    try {
      await api.addDomainVisibility(visDialogDomain.id, {
        toDomainId: addVisTargetId,
        description: addVisDesc.trim() || null,
      });
      setAddVisTargetId('');
      setAddVisDesc('');
      await refreshVis(visDialogDomain.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAddingVis(false);
    }
  };

  const removeVisibilityEdge = async (edgeId: string) => {
    if (!visDialogDomain) return;
    try {
      await api.removeDomainVisibility(visDialogDomain.id, edgeId);
      await refreshVis(visDialogDomain.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

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

  const visTargetChoices = visDialogDomain
    ? domains.filter((x) => x.id !== visDialogDomain.id)
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dominios</h1>
        <p className="text-muted-foreground mt-1">
          Gobierno de arquitectura C4: agrupa proyectos (FK), visibilidad dirigida entre dominios para el visor C4 /
          shards Falkor, y whitelist proyecto→dominio en la pestaña Arquitectura del proyecto.
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
          <CardDescription>
            <strong>Proyectos asignados</strong> cuenta filas en <code className="text-xs">projects.domain_id</code>.
            <strong className="ml-2">Visibilidad</strong> edita la tabla <code className="text-xs">domain_domain_visibility</code>{' '}
            (desde este dominio hacia otros).
          </CardDescription>
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
                  <TableHead className="text-right">Proyectos</TableHead>
                  <TableHead className="w-[200px]" />
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
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => openProjectsDialog(d)}
                      >
                        {d.assignedProjectCount ?? 0}
                      </Button>
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => openVisDialog(d)}>
                        Visibilidad C4
                      </Button>
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

      <Dialog open={projectsDialogDomain !== null} onOpenChange={(o) => !o && setProjectsDialogDomain(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Proyectos en «{projectsDialogDomain?.name}»</DialogTitle>
            <DialogDescription>
              Proyectos con <code className="text-xs">domain_id</code> apuntando a este dominio.
            </DialogDescription>
          </DialogHeader>
          {loadingProjects ? (
            <p className="text-sm text-muted-foreground py-4">Cargando…</p>
          ) : projectsInDomain.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">Ningún proyecto asignado.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto space-y-2 rounded-md border p-2">
              {projectsInDomain.map((p) => (
                <li key={p.id}>
                  <Link to={`/projects/${p.id}`} className="text-sm font-medium hover:underline">
                    {p.name?.trim() || p.id.slice(0, 8)}
                  </Link>
                  <code className="ml-2 text-xs text-muted-foreground">{p.id}</code>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>

      <Dialog open={visDialogDomain !== null} onOpenChange={(o) => !o && setVisDialogDomain(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Visibilidad desde «{visDialogDomain?.name}»</DialogTitle>
            <DialogDescription>
              Aristas <code className="text-xs">domain_domain_visibility</code>: otros dominios cuyos proyectos se
              incluyen en el contexto de grafos (junto con la whitelist por proyecto). Dirección: desde este dominio →
              destino.
            </DialogDescription>
          </DialogHeader>
          {loadingVis ? (
            <p className="text-sm text-muted-foreground py-4">Cargando…</p>
          ) : (
            <div className="space-y-4">
              {visEdges.length > 0 ? (
                <ul className="space-y-2 max-h-48 overflow-y-auto rounded border p-2">
                  {visEdges.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2 text-sm">
                      <span>
                        → <strong>{e.toDomainName ?? e.toDomainId}</strong>
                        {e.description ? (
                          <span className="text-muted-foreground ml-1">({e.description})</span>
                        ) : null}
                      </span>
                      <Button type="button" variant="ghost" size="sm" onClick={() => void removeVisibilityEdge(e.id)}>
                        Quitar
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Sin aristas salientes.</p>
              )}
              <div className="flex flex-wrap gap-2 items-end">
                <div className="space-y-1 min-w-[180px] flex-1">
                  <Label>Destino</Label>
                  <Select value={addVisTargetId || undefined} onValueChange={setAddVisTargetId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Dominio destino" />
                    </SelectTrigger>
                    <SelectContent>
                      {visTargetChoices.map((x) => (
                        <SelectItem key={x.id} value={x.id}>
                          {x.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 flex-1 min-w-[120px]">
                  <Label>Nota</Label>
                  <Input value={addVisDesc} onChange={(e) => setAddVisDesc(e.target.value)} placeholder="Opcional" />
                </div>
                <Button type="button" disabled={!addVisTargetId || addingVis} onClick={() => void addVisibilityEdge()}>
                  {addingVis ? 'Añadiendo…' : 'Añadir'}
                </Button>
              </div>
            </div>
          )}
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </div>
  );
}
