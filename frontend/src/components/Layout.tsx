/**
 * @fileoverview Layout con header (nav) y main. Enlaces: Repositorios, + Nuevo, Credenciales.
 * Con SSO: muestra botón Cerrar sesión.
 */
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { removeToken, redirectToSSO, isSSOEnabled } from '../utils/sso';

const navItems = [
  { to: '/', label: 'Proyectos' },
  { to: '/repos', label: 'Repositorios' },
  { to: '/repos/new', label: '+ Nuevo repo' },
  { to: '/credentials', label: 'Credenciales' },
  { to: '/ayuda', label: 'Ayuda' },
] as const;

/**
 * Layout principal: header sticky con enlaces (Proyectos, Repositorios, + Nuevo repo, Credenciales, Ayuda) y Cerrar sesión si SSO está activo; main con children.
 */
export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-14 flex-1 items-center justify-between gap-6 px-[30px]">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2 font-semibold text-lg">
              Ariadne
            </Link>
            <nav className="flex items-center gap-2">
              {navItems.map((item) => {
              const isActive =
                item.to === '/'
                  ? location.pathname === '/'
                  : item.to === '/ayuda'
                    ? location.pathname.startsWith('/ayuda')
                    : location.pathname.startsWith(item.to);
              return (
                <Button key={item.to} variant={isActive ? 'secondary' : 'ghost'} size="sm" asChild>
                  <Link to={item.to}>{item.label}</Link>
                </Button>
              );
            })}
            </nav>
          </div>
          {isSSOEnabled() && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                removeToken();
                redirectToSSO();
              }}
            >
              Cerrar sesión
            </Button>
          )}
        </div>
      </header>
      <main className="px-[30px] pt-6 pb-[30px]">{children}</main>
    </div>
  );
}
