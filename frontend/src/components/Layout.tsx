/**
 * Kreo AppLayout - Shell con Sidebar, Header y contenido principal
 */
import { useState } from "react"
import { useLocation } from "react-router-dom"
import {
  Menu as MenuIcon,
  Search,
  LayoutDashboard,
  FolderGit2,
  Plus,
  Key,
  HelpCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { SidebarModern, type SidebarGroup } from "./layout/SidebarModern"
import { Button } from "@/components/ui/button"

const navigationGroups: SidebarGroup[] = [
  {
    items: [
      { label: "Proyectos", href: "/", icon: LayoutDashboard },
      { label: "Repositorios", href: "/repos", icon: FolderGit2 },
      { label: "+ Nuevo repo", href: "/repos/new", icon: Plus },
      { label: "Credenciales", href: "/credentials", icon: Key },
      { label: "Ayuda", href: "/ayuda", icon: HelpCircle },
    ],
  },
]

export function Layout({ children }: { children: React.ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const location = useLocation()

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
              : path.startsWith("/projects")
                ? "/"
                : "/"

  return (
    <div className="flex h-screen bg-[var(--background)] overflow-hidden">
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
            "relative w-72 h-full transition-transform duration-300",
            mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
          )}
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 lg:h-16 bg-[var(--card)] border-b border-[var(--border)] flex items-center justify-between px-4 lg:px-6 shrink-0 z-20">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden text-[var(--foreground-muted)]"
              onClick={() => setMobileMenuOpen(true)}
            >
              <MenuIcon className="w-5 h-5" />
            </Button>
            <div className="hidden md:flex items-center gap-2 px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-[var(--radius-lg)] w-48 lg:w-72 text-[var(--foreground-subtle)] text-sm">
              <Search className="w-4 h-4" />
              <span>Buscar...</span>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="max-w-[1600px] mx-auto">{children}</div>
        </main>
      </div>
    </div>
  )
}
