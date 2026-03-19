/**
 * Página de error (ej. fallo SSO). Lee message de query y permite volver a inicio.
 */
import { useSearchParams, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

/** Página de error: muestra message de query (ej. fallo SSO) y enlace a inicio. */
export function ErrorPage() {
  const [searchParams] = useSearchParams();
  const message = searchParams.get('message') || 'Ha ocurrido un error.';

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-6">
      <h2 className="text-destructive text-xl font-semibold">Error</h2>
      <p className="text-muted-foreground max-w-md text-center">{message}</p>
      <Button asChild variant="default">
        <Link to="/">Volver al inicio</Link>
      </Button>
    </div>
  );
}
