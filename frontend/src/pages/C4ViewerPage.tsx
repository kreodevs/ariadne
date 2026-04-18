/**
 * @fileoverview Visor dedicado C4: selector de proyecto + diagrama + panel DSL (misma API que Arquitectura).
 */
import { useEffect, useState } from 'react';
import { api } from '@/api';
import type { Project } from '@/types';
import { C4Previewer } from '@/components/C4Previewer';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export function C4ViewerPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string>('');
  const [level, setLevel] = useState<1 | 2 | 3>(2);
  const [shadowMode, setShadowMode] = useState(false);
  const [sessionId, setSessionId] = useState('');

  useEffect(() => {
    api
      .getProjects()
      .then((list) => {
        setProjects(list);
        if (list.length > 0) setProjectId((id) => id || list[0].id);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-semibold tracking-tight">C4 Viewer</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--foreground-muted)]">
          Mismos endpoints que la pestaña Arquitectura del proyecto: niveles PlantUML vía ingest y render Kroki.
          Shadow mode (Visual SDD) requiere <span className="font-mono">sessionId</span> cuando aplica.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : projects.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-[var(--foreground-muted)]">
            Crea un proyecto primero; el visor C4 opera sobre <span className="font-mono">projectId</span>.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden border-[var(--border)]">
          <CardHeader className="border-b border-[var(--border)] bg-[var(--secondary)]/30">
            <CardTitle className="text-lg">Proyecto</CardTitle>
            <CardDescription className="text-sm">Elige el alcance del modelo C4 generado por el ingest.</CardDescription>
            <div className="pt-2">
              <Label htmlFor="c4-project" className="sr-only">
                Proyecto
              </Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger id="c4-project" className="max-w-md">
                  <SelectValue placeholder="Proyecto" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name || p.id.slice(0, 8)} · {p.id.slice(0, 8)}…
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            {projectId ? (
              <C4Previewer
                projectId={projectId}
                level={level}
                onLevelChange={setLevel}
                shadowMode={shadowMode}
                onShadowModeChange={setShadowMode}
                sessionId={sessionId}
                onSessionIdChange={setSessionId}
                layout="split"
              />
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
