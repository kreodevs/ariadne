/**
 * Barra superior: breadcrumbs y búsqueda global.
 */
import { useLocation } from 'react-router-dom';
import { AppBreadcrumbs } from '@/components/AppBreadcrumbs';
import { HeaderSearch } from '@/components/HeaderSearch';

export function AppShellHeader() {
  const { pathname } = useLocation();

  return (
    <div className="flex w-full min-w-0 flex-col gap-3 border-b border-[var(--border)]/80 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-4 lg:px-6 lg:py-3">
      <div className="min-w-0 flex-1">
        <AppBreadcrumbs pathname={pathname} />
      </div>
      <div className="flex shrink-0 items-center justify-end">
        <HeaderSearch />
      </div>
    </div>
  );
}
