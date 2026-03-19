/**
 * Modal de análisis de job incremental: impacto, seguridad, resumen ejecutivo.
 */
import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { JobAnalysisResult } from '../../types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

interface JobAnalysisModalProps {
  repoId: string | null;
  jobId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SEVERITY_COLOR: Record<string, string> = {
  critica: 'bg-red-500/20 text-red-700 dark:text-red-400',
  alta: 'bg-orange-500/20 text-orange-700 dark:text-orange-400',
  media: 'bg-amber-500/20 text-amber-700 dark:text-amber-400',
};

export function JobAnalysisModal({
  repoId,
  jobId,
  open,
  onOpenChange,
}: JobAnalysisModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<JobAnalysisResult | null>(null);

  useEffect(() => {
    if (!open || !repoId || !jobId) {
      setData(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .getJobAnalysis(repoId, jobId)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, repoId, jobId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Análisis de cambios — push incremental</DialogTitle>
        </DialogHeader>

        {loading && (
          <p className="text-muted-foreground py-8 text-center">Analizando…</p>
        )}
        {error && (
          <p className="py-4 text-destructive">{error}</p>
        )}
        {data && !loading && (
          <div className="space-y-6 text-sm">
            <section>
              <h3 className="font-semibold mb-2">Resumen ejecutivo</h3>
              <p className="text-muted-foreground">{data.resumenEjecutivo}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant={data.summary.riskScore >= 7 ? 'destructive' : 'secondary'}>
                  Riesgo: {data.summary.riskScore}/10
                </Badge>
                <Badge variant="outline">{data.summary.totalPaths} archivos</Badge>
                <Badge variant="outline">{data.summary.dependentModules} dependientes</Badge>
                {data.summary.securityFindings > 0 && (
                  <Badge variant="destructive">{data.summary.securityFindings} seguridad</Badge>
                )}
              </div>
            </section>

            <section>
              <h3 className="font-semibold mb-2">Archivos modificados</h3>
              <ul className="text-muted-foreground list-disc list-inside space-y-0.5 max-h-24 overflow-y-auto">
                {data.paths.slice(0, 20).map((p) => (
                  <li key={p} className="font-mono text-xs">{p}</li>
                ))}
                {data.paths.length > 20 && (
                  <li className="italic">+{data.paths.length - 20} más</li>
                )}
              </ul>
            </section>

            <section>
              <h3 className="font-semibold mb-2">Impacto (módulos dependientes)</h3>
              {data.impacto.dependents.some((d) => d.dependents.length > 0) ? (
                <div className="space-y-2">
                  {data.impacto.dependents
                    .filter((d) => d.dependents.length > 0)
                    .slice(0, 10)
                    .map((d) => (
                      <div key={d.path} className="rounded border p-2">
                        <span className="font-mono text-xs text-muted-foreground">{d.path}</span>
                        <p className="mt-1 text-xs">
                          → {d.dependents.slice(0, 5).join(', ')}
                          {d.dependents.length > 5 && ` (+${d.dependents.length - 5})`}
                        </p>
                      </div>
                    ))}
                </div>
              ) : (
                <p className="text-muted-foreground">Ningún módulo importa los archivos modificados.</p>
              )}
            </section>

            {data.seguridad.findings.length > 0 && (
              <section>
                <h3 className="font-semibold mb-2 text-destructive">Auditoría de seguridad</h3>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-1">Archivo</th>
                      <th className="text-left py-1">Gravedad</th>
                      <th className="text-left py-1">Patrón</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.seguridad.findings.slice(0, 10).map((f, i) => (
                      <tr key={i} className="border-b border-dashed">
                        <td className="py-1 font-mono">{f.path}</td>
                        <td className="py-1">
                          <Badge className={SEVERITY_COLOR[f.severity] ?? ''}>
                            {f.severity}
                          </Badge>
                        </td>
                        <td className="py-1 font-mono truncate max-w-[200px]">{f.pattern}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.seguridad.findings.length > 10 && (
                  <p className="text-muted-foreground mt-1">
                    +{data.seguridad.findings.length - 10} hallazgos más
                  </p>
                )}
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
