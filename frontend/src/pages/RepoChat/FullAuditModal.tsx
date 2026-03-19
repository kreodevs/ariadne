/**
 * Modal de Full Repo Audit: resumen ejecutivo, hallazgos críticos, plan de acción.
 */
import type { FullAuditResult } from '../../types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

interface FullAuditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: FullAuditResult | null;
  loading: boolean;
  error: string | null;
}

const PRIORITY_COLOR: Record<string, string> = {
  critica: 'bg-red-500/20 text-red-700 dark:text-red-400',
  alta: 'bg-orange-500/20 text-orange-700 dark:text-orange-400',
  media: 'bg-amber-500/20 text-amber-700 dark:text-amber-400',
  baja: 'bg-green-500/20 text-green-700 dark:text-green-600',
};

export function FullAuditModal({
  open,
  onOpenChange,
  data,
  loading,
  error,
}: FullAuditModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Full Repo Audit — Auditoría de Estado Cero</DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex flex-col items-center gap-4 py-12">
            <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent" />
            <p className="text-muted-foreground text-sm">
              Analizando arquitectura, seguridad, deuda técnica… puede tardar 1-2 minutos.
            </p>
          </div>
        )}

        {error && (
          <p className="py-4 text-destructive">{error}</p>
        )}

        {data && !loading && (
          <div className="space-y-6 text-sm">
            <section>
              <h3 className="font-semibold mb-2">Executive Summary</h3>
              <p className="text-muted-foreground">{data.executiveSummary}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant={data.healthScore >= 70 ? 'secondary' : data.healthScore >= 40 ? 'outline' : 'destructive'}>
                  Salud: {data.healthScore}/100
                </Badge>
                <Badge variant="outline">
                  Deuda: ~{data.techDebtEstimateHours}h
                </Badge>
                {data.topRisks.slice(0, 2).map((r, i) => (
                  <Badge key={i} variant="outline" className="max-w-[200px] truncate" title={r}>
                    {r}
                  </Badge>
                ))}
              </div>
            </section>

            <section>
              <h3 className="font-semibold mb-2">Critical Findings</h3>
              <div className="space-y-3">
                {data.criticalFindings.slice(0, 20).map((f, i) => (
                  <div
                    key={i}
                    className="rounded border p-3 space-y-1 bg-muted/30"
                  >
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <span className="font-medium">{f.hallazgo}</span>
                      <Badge className={PRIORITY_COLOR[f.prioridad] ?? ''}>
                        {f.prioridad}
                      </Badge>
                    </div>
                    {(f.path || f.name) && (
                      <div className="font-mono text-xs text-muted-foreground break-all">
                        {f.path}
                        {f.line != null && (
                          <span className="text-destructive/80 ml-1">— línea {f.line}</span>
                        )}
                        {f.name && !f.path?.includes(f.name) && (
                          <span className="ml-1">::{f.name}</span>
                        )}
                      </div>
                    )}
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span><strong className="text-foreground">Impacto:</strong> {f.impacto}</span>
                      <span><strong className="text-foreground">Esfuerzo:</strong> {f.esfuerzo}</span>
                    </div>
                  </div>
                ))}
                {data.criticalFindings.length > 20 && (
                  <p className="text-muted-foreground text-xs">+{data.criticalFindings.length - 20} más</p>
                )}
              </div>
            </section>

            <section>
              <h3 className="font-semibold mb-2">Action Plan (próximas 2 semanas)</h3>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                {data.actionPlan.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </section>

            <section className="space-y-6">
              <div>
                <h3 className="font-semibold mb-2 text-destructive">Seguridad — Secretos expuestos</h3>
                {data.seguridad.leakedSecrets.length > 0 ? (
                  <ul className="space-y-2 text-xs">
                    {data.seguridad.leakedSecrets.map((s, i) => (
                      <li key={i} className="font-mono p-2 rounded bg-muted/50 break-all">
                        <span className="text-foreground font-medium">{s.path}</span>
                        {s.line != null && (
                          <span className="text-destructive/80 ml-1">línea {s.line}</span>
                        )}
                        {s.pattern && (
                          <span className="block text-muted-foreground mt-0.5 truncate max-w-full" title={s.pattern}>
                            Patrón: {s.pattern}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-xs">Sin hallazgos de secretos expuestos.</p>
                )}
              </div>
              <div>
                <h3 className="font-semibold mb-2">Arquitectura</h3>
                <p className="text-xs text-muted-foreground mb-2">
                  God objects: {data.arquitectura.godObjects.length} · Import circulares: {data.arquitectura.circularImports.length} · Alta complejidad: {data.arquitectura.highComplexityFunctions.length}
                </p>
                {data.arquitectura.godObjects.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs font-medium mb-1">God objects:</p>
                    <ul className="space-y-0.5 text-xs font-mono break-all">
                      {data.arquitectura.godObjects.map((g, i) => (
                        <li key={i}>
                          {g.path.replace(/^[^/]+\//, '')}
                          {g.lineCount != null && ` (${g.lineCount} LOC)`}
                          {g.dependencyCount != null && ` · ${g.dependencyCount} deps`}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {data.arquitectura.highComplexityFunctions.length > 0 && (
                  <ul className="space-y-1.5 text-xs font-mono">
                    {data.arquitectura.highComplexityFunctions.map((f, i) => (
                      <li key={i} className="p-2 rounded bg-muted/50 break-all">
                        <span className="text-foreground">{f.path.replace(/^[^/]+\//, '')}</span>
                        <span className="text-muted-foreground">::{f.name}</span>
                        <span className="ml-1">(complejidad ciclomática: {f.complexity})</span>
                      </li>
                    ))}
                  </ul>
                )}
                {data.arquitectura.circularImports.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-medium mb-1">Imports circulares:</p>
                    <ul className="space-y-0.5 text-xs font-mono">
                      {data.arquitectura.circularImports.map(([a, b], i) => (
                        <li key={i} className="break-all">
                          {a.replace(/^[^/]+\//, '')} ↔ {b.replace(/^[^/]+\//, '')}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>

            <section>
              <h3 className="font-semibold mb-2">Salud del código</h3>
              <p className="text-xs text-muted-foreground mb-2">
                Código muerto: {data.saludCodigo.codigoMuerto.length} · Duplicados: {data.saludCodigo.duplicados.length}
              </p>
              {data.saludCodigo.codigoMuerto.length > 0 && (
                <ul className="space-y-0.5 text-xs font-mono break-all">
                  {data.saludCodigo.codigoMuerto.slice(0, 10).map((c, i) => (
                    <li key={i}>{c.path.replace(/^[^/]+\//, '')}</li>
                  ))}
                  {data.saludCodigo.codigoMuerto.length > 10 && (
                    <li className="italic">+{data.saludCodigo.codigoMuerto.length - 10} más</li>
                  )}
                </ul>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
