/**
 * Shell SaaS: sidenav colapsable, header con breadcrumbs / búsqueda / workspace, contenido principal.
 * Muestra/oculta elementos del sidebar según el rol del usuario.
 */
import { useEffect, useState } from 'react';
import { useLocation, Outlet } from 'react-router-dom';
import {
  Menu as MenuIcon,
  LayoutDashboard,
  FolderKanban,
  Layers,
  FolderGit2,
  ListOrdered,
  FolderPlus,
  Boxes,
  Share2,
  Key,
  HelpCircle,
  User,
  Shield,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SidebarModern, type SidebarGroup } from './layout/SidebarModern';
import { Button } from '@/components/ui/button';
import { AppShellHeader } from '@/components/AppShellHeader';
import { getActiveNavHref } from '@/lib/nav';
import { getUser } from '@/utils/auth';
import type { UserInfo } from '@/utils/auth';

/** Construye los grupos del sidebar según el rol. */
function buildNavigationGroups(user: UserInfo | null): SidebarGroup[] {
  const isAdmin = user?.role === 'admin';

  return [
    {
      title: 'Gobierno',
      items: [
        { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
        { label: 'Dominios', href: '/domains', icon: Layers },
        { label: 'Proyectos', href: '/projects', icon: FolderKanban },
        ...(isAdmin ? [{ label: 'Usuarios', href: '/users', icon: Shield }] : []),
      ],
    },
    {
      title: 'Ingeniería',
      items: [
        { label: 'Repositorios', href: '/repos', icon: FolderGit2 },
        { label: 'Cola de Sync', href: '/jobs', icon: ListOrdered },
        ...(isAdmin ? [{ label: 'Nuevo Repo', href: '/repos/new', icon: FolderPlus }] : []),
        ...(isAdmin ? [{ label: 'Credenciales', href: '/credentials', icon: Key }] : []),
        { label: 'C4 Viewer', href: '/c4', icon: Boxes },
      ],
    },
    {
      title: 'Plataforma',
      items: [
        { label: 'Grafo', href: '/graph-explorer', icon: Share2 },
        ...(isAdmin ? [{ label: 'Credenciales', href: '/credentials', icon: Key }] : []),
        { label: 'Perfil', href: '/profile', icon: User },
        { label: 'Ayuda', href: '/ayuda', icon: HelpCircle },
      ],
    },
  ];
}

export function Layout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [user, setUser] = useState<UserInfo | null>(null);
  const location = useLocation();

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    setUser(getUser());
  }, [location.pathname]);

  const activeHref = getActiveNavHref(location.pathname);
  const navigationGroups = buildNavigationGroups(user);

  return (
    <div className="flex h-[100dvh] min-h-0 overflow-hidden bg-[var(--background)]">
      <SidebarModern
        groups={navigationGroups}
        activeHref={activeHref}
        brand={<span className="text-xl font-black tracking-tighter text-[var(--foreground)]">ARIADNE</span>}
        brandHref="/dashboard"
        user={user ? { name: user.email, email: `Rol: ${user.role}` } : undefined}
        className="hidden lg:flex shrink-0"
      />

      <div
        className={cn(
          'fixed inset-0 z-[var(--z-modal)] lg:hidden transition-opacity duration-300',
          mobileMenuOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
        <SidebarModern
          groups={navigationGroups}
          activeHref={activeHref}
          brandHref="/dashboard"
          collapsible={false}
          className={cn(
            'relative h-full max-w-[18rem] w-[min(18rem,88vw)] max-lg:pt-[env(safe-area-inset-top,0px)] shadow-xl transition-transform duration-300',
            mobileMenuOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="z-20 shrink-0 bg-[var(--card)]/90 pt-[env(safe-area-inset-top,0px)] backdrop-blur-md">
          <div className="flex min-h-14 items-start gap-2 px-2 sm:min-h-16 sm:items-center sm:px-3 lg:px-4">
            <Button
              variant="ghost"
              size="icon"
              className="mt-2 shrink-0 touch-manipulation text-[var(--foreground-muted)] lg:hidden"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Abrir menú"
            >
              <MenuIcon className="size-5" />
            </Button>
            <div className="min-w-0 flex-1 py-2 sm:py-0">
              <AppShellHeader />
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:p-4 lg:p-8">
          <div className="mx-auto w-full min-w-0 max-w-[1600px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
