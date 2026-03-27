/**
 * Kreo AppLayout - Shell con Sidebar, Header y contenido principal
 */
import { useEffect, useState } from "react"
import { useLocation } from "react-router-dom"
import {
  Menu as MenuIcon,
  LayoutDashboard,
  FolderGit2,
  Plus,
  Key,
  HelpCircle,
  Share2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { SidebarModern, type SidebarGroup } from "./layout/SidebarModern"
import { Button } from "@/components/ui/button"
import { HeaderSearch } from "./HeaderSearch"

const navigationGroups: SidebarGroup[] = [
  {
    items: [
      { label: "Proyectos", href: "/", icon: LayoutDashboard },
      { label: "Repositorios", href: "/repos", icon: FolderGit2 },
      { label: "+ Nuevo repo", href: "/repos/new", icon: Plus },
      { label: "Credenciales", href: "/credentials", icon: Key },
      { label: "Grafo", href: "/graph-explorer", icon: Share2 },
      { label: "Ayuda", href: "/ayuda", icon: HelpCircle },
    ],
  },
]

export function Layout({ children }: { children: React.ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  const path = location.pathname
  const activeHref =
    path === "/"
      ? "/"
      : path.startsWith("/ayuda")
        ? "/ayuda"
        : path.startsWith("/repos/new")
          ? "/repos/new"
          : path.startsWith("/credentials")
            ? "/credentials"
            : path.startsWith("/repos")
              ? "/repos"
              : path.startsWith("/graph-explorer")
                ? "/graph-explorer"
                : path.startsWith("/projects")
                  ? "/"
                  : "/"

  return (
    <div className="flex h-[100dvh] min-h-0 bg-[var(--background)] overflow-hidden">
      <SidebarModern
        groups={navigationGroups}
        activeHref={activeHref}
        brand={<span className="text-xl font-black tracking-tighter">ARIADNE</span>}
        className="hidden lg:flex shrink-0"
      />

      <div
        className={cn(
          "fixed inset-0 z-[var(--z-modal)] lg:hidden transition-opacity duration-300",
          mobileMenuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
      >
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={() => setMobileMenuOpen(false)}
        />
        <SidebarModern
          groups={navigationGroups}
          activeHref={activeHref}
          collapsible={false}
          className={cn(
            "relative w-[min(18rem,88vw)] max-w-[18rem] h-full transition-transform duration-300 shadow-xl max-lg:pt-[env(safe-area-inset-top,0px)]",
            mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
          )}
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="min-h-14 lg:min-h-16 pt-[env(safe-area-inset-top,0px)] bg-[var(--card)]/95 backdrop-blur-md border-b border-[var(--border)] flex flex-col shrink-0 z-20">
          <div className="flex items-center justify-between gap-3 px-3 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-0 lg:h-16 min-h-14">
            <div className="flex flex-1 min-w-0 items-center gap-2 sm:gap-4">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden shrink-0 h-11 w-11 text-[var(--foreground-muted)] touch-manipulation"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Abrir menú"
              >
                <MenuIcon className="w-5 h-5" />
              </Button>
              <HeaderSearch />
            </div>
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3 sm:p-4 lg:p-6 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
          <div className="max-w-[1600px] mx-auto w-full min-w-0">{children}</div>
        </main>
      </div>
    </div>
  )
}
