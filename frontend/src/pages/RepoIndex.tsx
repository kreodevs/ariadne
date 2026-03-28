/**
 * @fileoverview Índice FalkorDB: izquierda = todos los ítems (File, Component, Function, Hook…), derecha = código al hacer click.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import type { Repository } from '../types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';

/** Etiquetas de nodos en el grafo FalkorDB. */
type IndexLabel = 'File' | 'Component' | 'Function' | 'Model' | 'Route' | 'Hook' | 'DomainConcept' | 'Prop' | 'NestController' | 'NestService' | 'NestModule';

/** Fila de muestra del índice (path, name, componentName, category, endpointCalls). */
interface IndexRow {
  path?: string;
  name?: string;
  componentName?: string;
  category?: string;
  endpointCalls?: Array<{ method: string; line: number }>;
}

const LABEL_ORDER: IndexLabel[] = ['File', 'Component', 'Function', 'Model', 'Route', 'Hook', 'DomainConcept', 'Prop', 'NestController', 'NestService', 'NestModule'];

/** Etiqueta amigable para UI (dominios de problema) */
const LABEL_DISPLAY: Partial<Record<IndexLabel, string>> = {
  DomainConcept: 'Dominio',
};

/**
 * Página de índice del grafo: panel izquierdo con pestañas por tipo (File, Component, Function, etc.) y búsqueda;
 * panel derecho muestra el contenido del archivo al hacer click en un ítem con path.
 */
export function RepoIndex() {
  const { id } = useParams<{ id: string }>();
  const [repo, setRepo] = useState<Repository | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [samples, setSamples] = useState<Record<string, IndexRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [activeLabel, setActiveLabel] = useState<IndexLabel>('File');
  const [searchByLabel, setSearchByLabel] = useState<Partial<Record<IndexLabel, string>>>({});

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    api
      .getRepository(id)
      .then(setRepo)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const loadFullIndex = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    // Multi-root: varios repos comparten projectId en Falkor; acotar al repo de la ruta.
    api
      .getGraphSummary(id, true, true)
      .then((res) => {
        setCounts(res.counts);
        setSamples(res.samples as Record<string, IndexRow[]>);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (id && repo) loadFullIndex();
  }, [id, repo?.id]);

  const loadFile = useCallback(
    (path: string) => {
      if (!id || !path) return;
      setSelectedPath(path);
      setLoadingFile(true);
      setFileContent(null);
      api
        .getFileContent(id, path)
        .then((r) => setFileContent(r.content))
        .catch(() => setFileContent(null))
        .finally(() => setLoadingFile(false));
    },
    [id],
  );

  const searchTerm = (searchByLabel[activeLabel] ?? '').trim().toLowerCase();
  const filteredRows = (samples[activeLabel] ?? []).filter((row) => {
    if (!searchTerm) return true;
    const path = (row.path ?? '').toLowerCase();
    const name = ((row.name ?? row.componentName) ?? '').toLowerCase();
    const category = (row.category ?? '').toLowerCase();
    return path.includes(searchTerm) || name.includes(searchTerm) || category.includes(searchTerm);
  });

  /** Parsea endpointCalls (puede venir como string JSON desde el grafo). */
  const parseEndpointCalls = (row: IndexRow): Array<{ method: string; line: number }> | undefined => {
    if (typeof row.endpointCalls !== 'string') return row.endpointCalls;
    try {
      return JSON.parse(row.endpointCalls);
    } catch {
      return undefined;
    }
  };

  /** Renderiza una fila del índice (path/name, click para cargar archivo si aplica). */
  const renderRow = (label: IndexLabel, row: IndexRow, i: number) => {
    const path = row.path;
    const name = row.name ?? row.componentName;
    const clickableLabels: IndexLabel[] = ['File', 'Component', 'Function', 'Model', 'Hook', 'DomainConcept', 'NestController', 'NestService', 'NestModule'];
    const isClickable = !!path && clickableLabels.includes(label);
    const endpointCalls = parseEndpointCalls(row);
    const endpointBadge = label === 'Function' && endpointCalls?.length ? ` (${endpointCalls.map((e) => e.method).join(', ')})` : '';
    const categorySuffix = label === 'DomainConcept' && row.category ? ` · ${row.category}` : '';
    const display = label === 'File' ? path : name ? (path ? `${path} · ${name}${categorySuffix}` : `${name}${categorySuffix}`) : path ?? JSON.stringify(row);

    return (
      <li
        key={i}
        className={`text-xs cursor-pointer px-2 py-1 rounded hover:bg-muted whitespace-nowrap min-w-max ${selectedPath === path ? 'bg-muted' : ''}`}
        onClick={() => isClickable && path && loadFile(path)}
        title={endpointBadge ? `${path ?? display}${endpointBadge}` : path ?? display}
        role={isClickable ? 'button' : undefined}
      >
        {display}
      </li>
    );
  };

  /** Contenido del panel izquierdo: loading, lista filtrada, o mensaje vacío. */
  const renderListContent = () => {
    if (loading) return <p className="text-sm text-muted-foreground">Cargando índice…</p>;
    if (filteredRows.length) {
      return (
        <ul className="space-y-0.5 w-max min-w-full">
          {filteredRows.map((row, i) => renderRow(activeLabel, row, i))}
        </ul>
      );
    }
    if (samples[activeLabel]?.length) {
      return (
        <p className="text-sm text-muted-foreground">
          No hay resultados para &quot;{searchTerm}&quot;. Prueba otro término.
        </p>
      );
    }
    return (
      <p className="text-sm text-muted-foreground">
        {counts[activeLabel] === 0 ? 'No hay datos.' : 'Cargando…'}
      </p>
    );
  };

  /** Contenido del panel derecho: loading, pre con código, o mensaje. */
  const renderCodeContent = () => {
    if (loadingFile) return <p className="text-sm text-muted-foreground">Cargando código…</p>;
    if (fileContent != null) {
      return (
        <pre className="text-xs font-mono whitespace-pre-wrap break-words overflow-x-auto">
          {fileContent}
        </pre>
      );
    }
    if (selectedPath) return <p className="text-sm text-muted-foreground">No se pudo cargar el archivo.</p>;
    return <p className="text-sm text-muted-foreground">Haz click en un archivo, componente o función de la lista.</p>;
  };

  if (!id) return null;
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
  if (!repo) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/repos">← Repos</Link>
        </Button>
        <Card>
          <CardHeader>
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-48 mt-2" />
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="flex shrink-0 items-center gap-2 pb-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/repos">← Repos</Link>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/repos/${id}`}>Detalle</Link>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/repos/${id}/chat`}>Chat</Link>
        </Button>
        <span className="text-muted-foreground">
          Índice — {repo.projectKey}/{repo.repoSlug}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Izquierda: índice */}
        <aside className="flex w-[min(400px,40%)] shrink-0 flex-col overflow-hidden border-r pr-4">
          <div className="flex flex-wrap gap-1 pb-2">
            {LABEL_ORDER.filter((l) => (counts[l] ?? 0) > 0).map((label) => (
              <Button
                key={label}
                variant={activeLabel === label ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setActiveLabel(label)}
              >
                {LABEL_DISPLAY[label] ?? label} ({counts[label] ?? 0})
              </Button>
            ))}
          </div>
          <Card className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <CardHeader className="pb-2 shrink-0 space-y-2">
              <CardTitle className="text-base">{LABEL_DISPLAY[activeLabel] ?? activeLabel} ({counts[activeLabel] ?? 0})</CardTitle>
              <Input
                placeholder={`Buscar en ${LABEL_DISPLAY[activeLabel] ?? activeLabel}…`}
                value={searchByLabel[activeLabel] ?? ''}
                onChange={(e) =>
                  setSearchByLabel((prev) => ({ ...prev, [activeLabel]: e.target.value }))
                }
                className="h-8 text-sm"
              />
              <p className="text-xs text-muted-foreground">Click en un ítem con path para ver el código</p>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto p-2">
              {renderListContent()}
            </CardContent>
          </Card>
        </aside>

        {/* Derecha: código */}
        <Card className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <CardHeader className="shrink-0 pb-2">
            <CardTitle className="text-base truncate">{selectedPath ?? 'Selecciona un archivo'}</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-auto p-4 bg-muted/30">
            {renderCodeContent()}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
