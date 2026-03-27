import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface RepoDetailErrorProps {
  error: string;
}

/** Muestra error de carga del repo con enlace a lista de repos. */
export function RepoDetailError({ error }: RepoDetailErrorProps) {
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
