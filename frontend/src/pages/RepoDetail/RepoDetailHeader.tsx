import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

/** Cabecera del detalle de repo: enlace "← Repos". */
export function RepoDetailHeader() {
  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/">← Repos</Link>
      </Button>
    </div>
  );
}
