/**
 * Modal para ver archivos omitidos en un job de sync, con motivo (fetch, parse, index).
 */
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

interface SkippedByReason {
  fetch?: number;
  parse?: number;
  index?: number;
}

interface SkippedPathsByReason {
  fetch?: string[];
  parse?: string[];
  index?: string[];
}

interface SkippedFilesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payload: Record<string, unknown> | null | undefined;
}

const REASON_LABELS: Record<string, { label: string; desc: string }> = {
  fetch: {
    label: 'Sin contenido (fetch)',
    desc: 'No se pudo obtener el archivo vía API, no existe en la rama o error de red.',
  },
  parse: {
    label: 'Error de parse',
    desc: 'El parser no pudo analizar el archivo (sintaxis, lenguaje no soportado, archivo muy grande >~60KB). Para archivos grandes: Ayuda → Manual → Parse progresivo.',
  },
  index: {
    label: 'Error de indexación',
    desc: 'Fallo al generar o ejecutar Cypher en FalkorDB.',
  },
};

/** Extrae paths por motivo; soporta camelCase y snake_case por compatibilidad. */
function getPathsByReason(payload: Record<string, unknown> | null | undefined): SkippedPathsByReason {
  const raw =
    (payload?.skippedPathsByReason as SkippedPathsByReason) ??
    (payload?.skipped_paths_by_reason as SkippedPathsByReason) ??
    {};
  return raw;
}

export function SkippedFilesModal({
  open,
  onOpenChange,
  payload,
}: SkippedFilesModalProps) {
  const navigate = useNavigate();
  const goToParseRefactor = () => {
    onOpenChange(false);
    navigate('/ayuda/manual/parse-refactor');
  };
  const skipped = (payload?.skipped as number) ?? 0;
  const total = (payload?.total as number) ?? 0;
  const indexed = (payload?.indexed as number) ?? 0;
  const byReason = (payload?.skippedByReason as SkippedByReason) ?? (payload?.skipped_by_reason as SkippedByReason) ?? {};
  const pathsByReason = getPathsByReason(payload);
  const flatPaths = (payload?.skippedPaths as string[]) ?? (payload?.skipped_paths as string[]) ?? [];
  const reasons = (['fetch', 'parse', 'index'] as const).filter((r) => (byReason[r] ?? 0) > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Archivos omitidos — {skipped} de {total} no indexados</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            {indexed} archivos indexados correctamente. {skipped} no se incluyeron en el grafo.
          </p>
          {reasons.length === 0 ? (
            flatPaths.length > 0 ? (
              <section className="space-y-2">
                <p className="text-muted-foreground">
                  Lista de archivos omitidos (job anterior sin desglose por motivo):
                </p>
                <ul className="max-h-64 overflow-y-auto rounded border bg-muted/30 p-2 font-mono text-xs">
                  {flatPaths.map((p, i) => (
                    <li key={i} className="truncate py-0.5" title={p}>
                      {p}
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <p className="text-muted-foreground">No hay desglose por motivo en este job.</p>
            )
          ) : (
            <div className="space-y-4">
              {reasons.map((reason) => {
                const info = REASON_LABELS[reason];
                const count = byReason[reason] ?? 0;
                const rawPaths = pathsByReason[reason];
                const paths = Array.isArray(rawPaths) ? rawPaths : [];
                return (
                  <section key={reason} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{info.label}</Badge>
                      <span className="text-muted-foreground">{count} archivo{count !== 1 ? 's' : ''}</span>
                    </div>
                    <p className="text-muted-foreground text-xs">{info.desc}</p>
                    {reason === 'parse' && (
                      <button
                        type="button"
                        onClick={goToParseRefactor}
                        className="text-xs text-primary hover:underline text-left"
                      >
                        → Guía: Parse progresivo (archivos grandes)
                      </button>
                    )}
                    {paths.length > 0 ? (
                      <ul className="max-h-64 overflow-y-auto rounded border bg-muted/30 p-2 font-mono text-xs space-y-1">
                        {paths.map((p, i) => (
                          <li key={`${reason}-${i}`} className="truncate" title={p}>
                            {p}
                          </li>
                        ))}
                        {count > paths.length && (
                          <li className="text-muted-foreground pt-1">
                            … y {count - paths.length} más
                          </li>
                        )}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground text-xs italic">
                        Rutas no disponibles (job anterior). Ejecuta un nuevo sync para ver el detalle.
                      </p>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
