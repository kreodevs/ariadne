import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/** Estado "repo no encontrado" con enlace a lista. */
export function RepoDetailNotFound() {
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/">← Repos</Link>
      </Button>
      <Alert>
        <AlertTitle>No encontrado</AlertTitle>
        <AlertDescription>El repositorio no existe.</AlertDescription>
      </Alert>
    </div>
  );
}
