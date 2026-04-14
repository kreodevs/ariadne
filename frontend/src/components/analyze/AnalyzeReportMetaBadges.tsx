/**
 * Badges a partir de `reportMeta` del analyze (caché, alcance, huella degradada).
 */
import { Badge } from '@/components/ui/badge';
import type { AnalyzeReportMeta } from '@/types';

export function AnalyzeReportMetaBadges({ meta }: { meta?: AnalyzeReportMeta | null }) {
  if (!meta) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {meta.fromCache ? (
        <Badge variant="secondary" title="Respuesta servida desde caché de análisis">
          Caché
        </Badge>
      ) : null}
      {meta.scopeApplied ? (
        <Badge variant="outline" title="El informe aplica un foco de rutas (scope)">
          Alcance activo
        </Badge>
      ) : null}
      {meta.cacheFingerprintMode === 'degraded' ? (
        <Badge variant="outline" className="border-amber-600/40 text-amber-800 dark:text-amber-200">
          Huella degradada
        </Badge>
      ) : null}
      {meta.extrinsicCallsLayerCacheHit || meta.extrinsicCallsLayerRedisHit ? (
        <Badge variant="outline" title="Capa extrínseca CALL (LRU/Redis)">
          Capa CALL cache
        </Badge>
      ) : null}
    </div>
  );
}
