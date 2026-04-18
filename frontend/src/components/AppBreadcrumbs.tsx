/**
 * Migas de navegación para el shell SaaS (jerarquía clara).
 */
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { breadcrumbsForPath } from '@/lib/nav';

export function AppBreadcrumbs({ pathname }: { pathname: string }) {
  const crumbs = breadcrumbsForPath(pathname);
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
      {crumbs.map((c, i) => (
        <span key={`${c.to}-${i}`} className="flex min-w-0 items-center gap-1.5">
          {i > 0 ? (
            <ChevronRight className="size-3.5 shrink-0 text-[var(--foreground-subtle)] opacity-70" aria-hidden />
          ) : null}
          {i === crumbs.length - 1 ? (
            <span className="truncate font-medium text-[var(--foreground)]">{c.label}</span>
          ) : (
            <Link
              to={c.to}
              className={cn(
                'truncate text-[var(--foreground-muted)] transition-colors hover:text-[var(--primary)]',
              )}
            >
              {c.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
