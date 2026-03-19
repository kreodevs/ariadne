import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/** Estado de carga del detalle de repo: esqueleto y enlace a lista. */
export function RepoDetailLoading() {
  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/">← Repos</Link>
      </Button>
      <Card>
        <CardHeader>
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-48 mt-2" />
        </CardHeader>
      </Card>
    </div>
  );
}
