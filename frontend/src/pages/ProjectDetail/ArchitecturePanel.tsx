/**
 * @fileoverview Pestaña Arquitectura: dominio del proyecto, whitelist de dominios, preview C4.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api';
import type { Domain, Project, ProjectDomainDependency } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
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
import { Input } from '@/components/ui/input';
import { C4Previewer } from '@/components/C4Previewer';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export function ArchitecturePanel({
  project,
  projectId,
  onProjectUpdated,
}: {
  project: Project;
  projectId: string;
  onProjectUpdated: () => void;
}) {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [deps, setDeps] = useState<ProjectDomainDependency[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingDomain, setSavingDomain] = useState(false);
  const [addDomainId, setAddDomainId] = useState<string>('');
  const [connType, setConnType] = useState('REST');
  const [depDesc, setDepDesc] = useState('');
  const [adding, setAdding] = useState(false);

  const [c4Level, setC4Level] = useState<1 | 2 | 3>(2);
  const [shadowMode, setShadowMode] = useState(false);
  const [sessionId, setSessionId] = useState('');

  const load = useCallback(() => {
    api
      .getDomains()
      .then(setDomains)
      .catch((e) => setError(e.message));
    api
      .listProjectDomainDependencies(projectId)
      .then(setDeps)
      .catch((e) => setError(e.message));
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const saveProjectDomain = async (domainId: string | null) => {
    setSavingDomain(true);
    setError(null);
    try {
      await api.updateProject(projectId, { domainId });
      onProjectUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingDomain(false);
    }
  };

  const addDep = async () => {
    if (!addDomainId) return;
    setAdding(true);
    setError(null);
    try {
      await api.addProjectDomainDependency(projectId, {
        dependsOnDomainId: addDomainId,
        connectionType: connType,
        description: depDesc.trim() || null,
      });
      setAddDomainId('');
      setDepDesc('');
      load();
      onProjectUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  const removeDep = async (depId: string) => {
    try {
      await api.removeProjectDomainDependency(projectId, depId);
      load();
      onProjectUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const depChoices = domains.filter((d) => d.id !== project.domainId);

  return (
    <div className="space-y-6">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dominio del proyecto</CardTitle>
          <CardDescription>
            Asigna el proyecto a un dominio de gobierno. La whitelist enlaza otros dominios cuyos grafos se
            consideran en MCP (shards extendidos).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4 items-end">
          <div className="space-y-1 min-w-[220px]">
            <Label>Dominio</Label>
            <Select
              value={project.domainId ?? '__none__'}
              onValueChange={(v) => void saveProjectDomain(v === '__none__' ? null : v)}
              disabled={savingDomain || domains.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder={domains.length === 0 ? 'Crea dominios primero' : 'Sin dominio'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">(ninguno)</SelectItem>
                {domains.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-block size-3 rounded border"
                        style={{ backgroundColor: d.color }}
                      />
                      {d.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="link" className="text-xs h-auto p-0" asChild>
            <Link to="/domains">Gestionar dominios</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dependencias entre dominios (whitelist)</CardTitle>
          <CardDescription>
            Define qué otros dominios puede consumir este proyecto (REST, gRPC, eventos…). Amplía la búsqueda en
            grafos Falkor de proyectos en esos dominios.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1 min-w-[200px]">
              <Label>Dominio destino</Label>
              <Select value={addDomainId || undefined} onValueChange={setAddDomainId}>
                <SelectTrigger>
                  <SelectValue placeholder="Elegir dominio" />
                </SelectTrigger>
                <SelectContent>
                  {depChoices.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 w-28">
              <Label>Tipo</Label>
              <Input value={connType} onChange={(e) => setConnType(e.target.value)} placeholder="REST" />
            </div>
            <div className="space-y-1 flex-1 min-w-[160px]">
              <Label>Nota</Label>
              <Input value={depDesc} onChange={(e) => setDepDesc(e.target.value)} placeholder="Opcional" />
            </div>
            <Button type="button" disabled={!addDomainId || adding} onClick={() => void addDep()}>
              {adding ? 'Añadiendo…' : 'Añadir'}
            </Button>
          </div>

          {deps.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin dependencias declaradas.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dominio</TableHead>
                  <TableHead>Conexión</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="w-[90px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {deps.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{d.dependsOnDomainName ?? d.dependsOnDomainId}</TableCell>
                    <TableCell className="font-mono text-xs">{d.connectionType}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{d.description ?? '—'}</TableCell>
                    <TableCell>
                      <Button type="button" variant="outline" size="sm" onClick={() => void removeDep(d.id)}>
                        Quitar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Diagrama C4 (PlantUML + Kroki)</CardTitle>
          <CardDescription>
            Niveles: contexto (dominios), contenedor (repos), componente (grafo). Shadow mode añade diff de
            componentes respecto al grafo principal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <C4Previewer
            projectId={projectId}
            level={c4Level}
            onLevelChange={setC4Level}
            shadowMode={shadowMode}
            onShadowModeChange={setShadowMode}
            sessionId={sessionId}
            onSessionIdChange={setSessionId}
          />
        </CardContent>
      </Card>
    </div>
  );
}
