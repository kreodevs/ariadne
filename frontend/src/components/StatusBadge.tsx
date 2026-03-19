/**
 * @fileoverview Badge de estado para jobs y repos (pending, running, completed, error, etc.).
 */
import { Badge } from '@/components/ui/badge';

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'secondary',
  queued: 'secondary',
  syncing: 'default',
  running: 'default',
  ready: 'default',
  completed: 'default',
  error: 'destructive',
  failed: 'destructive',
};

const statusLabel: Record<string, string> = {
  queued: 'En cola',
  running: 'Procesando',
  completed: 'Completado',
  failed: 'Error',
};

/**
 * Badge de estado para jobs/repos: muestra etiqueta según status (queued, running, completed, failed, etc.) con variante de estilo (secondary, default, destructive).
 */
export function StatusBadge({ status }: { status: string }) {
  const label = statusLabel[status] ?? status;
  return (
    <Badge variant={statusVariant[status] ?? 'outline'} className="capitalize">
      {label}
    </Badge>
  );
}
