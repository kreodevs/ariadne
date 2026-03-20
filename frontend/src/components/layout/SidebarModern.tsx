/**
 * Kreo SidebarModern - Navegación lateral premium
 */
import { useState, forwardRef } from "react"
import { Link, useLocation } from "react-router-dom"
import { ChevronLeft, ChevronRight, ChevronDown, LogOut } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useNavigate } from "react-router-dom"
import { Avatar } from "../atoms/Avatar"
import { removeToken } from "../../utils/auth"

export interface SidebarLink {
  label: string
  href: string
  icon: LucideIcon
  badge?: string
  children?: { label: string; href: string }[]
}

export interface SidebarGroup {
  title?: string
  items: SidebarLink[]
}

export interface SidebarModernProps {
  groups: SidebarGroup[]
  activeHref?: string
  collapsible?: boolean
  defaultCollapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  brand?: React.ReactNode
  user?: { name: string; email: string; avatar?: string }
  className?: string
}

export const SidebarModern = forwardRef<HTMLElement, SidebarModernProps>(
  (
    {
      groups,
      activeHref,
      collapsible = true,
      defaultCollapsed = false,
      onCollapsedChange,
      brand,
      user,
      className,
    },
    ref
  ) => {
    const navigate = useNavigate()
    const [collapsed, setCollapsed] = useState(defaultCollapsed)
    const [openMenus, setOpenMenus] = useState<string[]>([])
    const location = useLocation()

    const toggleCollapse = () => {
      const newState = !collapsed
      setCollapsed(newState)
      onCollapsedChange?.(newState)
    }

    const toggleSubmenu = (label: string) => {
      if (collapsed) return
      setOpenMenus((prev) =>
        prev.includes(label) ? prev.filter((i) => i !== label) : [...prev, label]
      )
    }

    const isActive = (href: string) => {
      if (href === "/") return location.pathname === "/"
      if (href === "/ayuda") return location.pathname.startsWith("/ayuda")
      return location.pathname.startsWith(href)
    }

    return (
      <aside
        ref={ref}
        className={cn(
          "flex flex-col h-screen bg-[var(--card)] border-r border-[var(--border)] transition-all duration-300 ease-in-out z-[var(--z-fixed)] relative",
          collapsed ? "w-20" : "w-72",
          className
        )}
      >
        <div className="h-20 flex items-center px-6 mb-4 overflow-hidden shrink-0">
          <Link to="/" className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[var(--primary)] flex items-center justify-center text-[var(--primary-foreground)] font-black text-xl shrink-0">
              A
            </div>
            {!collapsed && (
              <div className="animate-fade-in whitespace-nowrap">
                {brand || (
                  <span className="text-xl font-black text-[var(--foreground)] tracking-tighter">
                    ARIADNE
                  </span>
                )}
              </div>
            )}
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4">
          {groups.map((group, idx) => (
            <div key={idx} className="mb-8">
              {!collapsed && group.title && (
                <h3 className="px-4 mb-4 text-[10px] font-black text-[var(--foreground-subtle)] uppercase tracking-[0.2em]">
                  {group.title}
                </h3>
              )}

              <div className="space-y-1">
                {group.items.map((item, i) => {
                  const active = activeHref
                    ? activeHref === item.href
                    : isActive(item.href)
                  const Icon = item.icon
                  const hasChildren =
                    item.children && item.children.length > 0
                  const isMenuOpen = openMenus.includes(item.label)

                  const NavItemContent = (
                    <div
                      onClick={() =>
                        hasChildren ? toggleSubmenu(item.label) : null
                      }
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius)] cursor-pointer transition-all duration-200 group relative",
                        active
                          ? "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-md"
                          : "text-[var(--foreground-muted)] hover:text-[var(--foreground)] hover:bg-[var(--secondary)]"
                      )}
                    >
                      <Icon
                        className={cn(
                          "w-5 h-5 shrink-0",
                          active ? "text-inherit" : "text-[var(--foreground-subtle)] group-hover:text-[var(--primary)]"
                        )}
                      />
                      {!collapsed && (
                        <>
                          <span className="flex-1 font-semibold text-sm whitespace-nowrap">
                            {item.label}
                          </span>
                          {item.badge && (
                            <span
                              className={cn(
                                "px-1.5 py-0.5 text-[10px] font-black rounded-md",
                                active
                                  ? "bg-black/20 text-white"
                                  : "bg-[var(--primary)]/10 text-[var(--primary)]"
                              )}
                            >
                              {item.badge}
                            </span>
                          )}
                          {hasChildren && (
                            <ChevronDown
                              className={cn(
                                "w-4 h-4 transition-transform duration-300",
                                isMenuOpen && "rotate-180"
                              )}
                            />
                          )}
                        </>
                      )}
                      {collapsed && active && (
                        <div className="absolute left-0 w-1 h-6 bg-[var(--primary-foreground)] rounded-full -translate-x-1" />
                      )}
                    </div>
                  )

                  return (
                    <div key={i}>
                      {hasChildren ? (
                        <div>{NavItemContent}</div>
                      ) : collapsed ? (
                        <Link to={item.href} title={item.label}>
                          {NavItemContent}
                        </Link>
                      ) : (
                        <Link to={item.href}>{NavItemContent}</Link>
                      )}

                      {!collapsed && hasChildren && isMenuOpen && (
                        <div className="mt-1 ml-9 space-y-1">
                          {item.children?.map((child, j) => (
                            <Link
                              key={j}
                              to={child.href}
                              className={cn(
                                "block py-2 px-3 text-sm text-[var(--foreground-muted)] hover:text-[var(--primary)] transition-colors relative",
                                "before:content-[''] before:absolute before:left-[-1.5rem] before:top-1/2 before:w-1.5 before:h-1.5 before:border-l before:border-b before:border-[var(--border)]"
                              )}
                            >
                              {child.label}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 mt-auto border-t border-[var(--border)] shrink-0">
          {user && !collapsed ? (
            <div className="flex items-center gap-3 p-2 rounded-[var(--radius-lg)] hover:bg-[var(--secondary)] transition-colors">
              <Avatar
                src={user.avatar}
                name={user.name}
                size="sm"
              />
              <div className="flex-1 min-w-0 overflow-hidden">
                <p className="text-sm font-bold text-[var(--foreground)] truncate">
                  {user.name}
                </p>
                <p className="text-[10px] text-[var(--foreground-muted)] truncate">
                  {user.email}
                </p>
              </div>
              <button
                onClick={() => {
                  removeToken()
                  navigate('/login', { replace: true })
                }}
                className="p-2 text-[var(--foreground-subtle)] hover:text-[var(--destructive)] transition-colors"
                title="Cerrar sesión"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              {user && (
                <Avatar
                  src={user.avatar}
                  name={user.name}
                  size="sm"
                  className="ring-2 ring-[var(--primary)]"
                />
              )}
              <button
                onClick={() => {
                  removeToken()
                  navigate('/login', { replace: true })
                }}
                className="p-2 text-[var(--foreground-muted)] hover:text-[var(--destructive)] transition-colors"
                title="Cerrar sesión"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>

        {collapsible && (
          <button
            onClick={toggleCollapse}
            className="absolute -right-3 top-24 w-6 h-6 rounded-full border border-[var(--border)] bg-[var(--card)] flex items-center justify-center text-[var(--foreground-muted)] hover:text-[var(--primary)] hover:border-[var(--primary)] transition-all shadow-md z-10"
          >
            {collapsed ? (
              <ChevronRight className="w-3.5 h-3.5" />
            ) : (
              <ChevronLeft className="w-3.5 h-3.5" />
            )}
          </button>
        )}
      </aside>
    )
  }
)
SidebarModern.displayName = "SidebarModern"
