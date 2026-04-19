/**
 * Modal para ver rutas indexadas en un job de sync full (payload.paths).
 */
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface IndexedFilesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payload: Record<string, unknown> | null | undefined;
}

export function IndexedFilesModal({
  open,
  onOpenChange,
  payload,
}: IndexedFilesModalProps) {
  const indexed = (payload?.indexed as number) ?? 0;
  const total = (payload?.total as number) ?? 0;
  const rawPaths = payload?.paths;
  const paths = Array.isArray(rawPaths) ? rawPaths.filter((p): p is string => typeof p === 'string') : [];
  const commitSha = typeof payload?.commitSha === 'string' ? payload.commitSha : null;
  const capped = indexed > 0 && paths.length > 0 && indexed > paths.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Archivos indexados — {indexed} de {total || '—'} en el árbol
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {commitSha && (
            <p className="text-muted-foreground font-mono text-xs">
              Commit: {commitSha}
            </p>
          )}
          {paths.length === 0 ? (
            <p className="text-muted-foreground">
              {indexed > 0
                ? 'Este job no guardó la lista de rutas en el historial (sync anterior o payload recortado). Vuelve a ejecutar un sync completo para ver el detalle.'
                : 'No hay rutas indexadas registradas en este job.'}
            </p>
          ) : (
            <>
              {capped && (
                <p className="text-muted-foreground text-xs">
                  Se listan las primeras {paths.length} rutas guardadas en el job; el total indexado fue{' '}
                  <strong>{indexed}</strong>.
                </p>
              )}
              <ul className="max-h-[60vh] overflow-y-auto rounded border bg-muted/30 p-2 font-mono text-xs space-y-0.5">
                {paths.map((p, i) => (
                  <li key={`${p}-${i}`} className="truncate py-0.5" title={p}>
                    {p}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
