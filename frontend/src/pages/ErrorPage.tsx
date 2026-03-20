/**
 * Página de error. Lee message de query y permite volver al login.
 */
import { useSearchParams, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

/** Página de error: muestra message de query y enlace al login. */
export function ErrorPage() {
  const [searchParams] = useSearchParams();
  const message = searchParams.get('message') || 'Ha ocurrido un error.';

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-6">
      <h2 className="text-destructive text-xl font-semibold">Error</h2>
      <p className="text-muted-foreground max-w-md text-center">{message}</p>
      <Button asChild variant="default">
        <Link to="/login">Volver al login</Link>
      </Button>
    </div>
  );
}
