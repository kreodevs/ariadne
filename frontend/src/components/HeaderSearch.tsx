/**
 * Búsqueda global: proyectos, repos y atajos de navegación. Cmd/Ctrl+K para abrir.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { FolderGit2, LayoutDashboard, Search, Share2, Key, HelpCircle, Plus } from "lucide-react"
import { api } from "@/api"
import type { Project, Repository } from "@/types"
import { cn } from "@/lib/utils"
import { buildScopeOptions, extractComponentNames, hrefGraphExplorer } from "@/lib/graphScope"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

type ResultKind = "shortcut" | "project" | "repo" | "component"

type SearchResult = {
  id: string
  kind: ResultKind
  label: string
  detail?: string
  to: string
  icon: typeof LayoutDashboard
}

const SHORTCUTS: Omit<SearchResult, "id">[] = [
  { kind: "shortcut", label: "Proyectos", detail: "Lista multi-root", to: "/projects", icon: LayoutDashboard },
  { kind: "shortcut", label: "Repositorios", detail: "Índice y sync", to: "/repos", icon: FolderGit2 },
  { kind: "shortcut", label: "Explorador de grafo", detail: "Componentes y dependencias", to: "/graph-explorer", icon: Share2 },
  { kind: "shortcut", label: "Credenciales", detail: "GitHub / Bitbucket", to: "/credentials", icon: Key },
  { kind: "shortcut", label: "Ayuda", detail: "Documentación", to: "/ayuda", icon: HelpCircle },
  { kind: "shortcut", label: "Nuevo repositorio", detail: "Alta y webhook", to: "/repos/new", icon: Plus },
]

function norm(s: string): string {
  return s.toLowerCase().trim()
}

function projectDisplayName(p: Project): string {
  if (p.name?.trim()) return p.name.trim()
  const r0 = p.repositories[0]
  if (r0) return `${r0.projectKey}/${r0.repoSlug}`
  return p.id.slice(0, 8) + "…"
}

function matchesQuery(q: string, ...parts: (string | null | undefined)[]): boolean {
  if (!q) return true
  const n = norm(q)
  return parts.some((p) => p && norm(String(p)).includes(n))
}

type GraphComponentRow = {
  name: string
  scopeKey: string
  graphProjectId: string
  scopeLabel: string
}

export function HeaderSearch({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [graphLoading, setGraphLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [graphError, setGraphError] = useState<string | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [repos, setRepos] = useState<Repository[]>([])
  const [graphComponents, setGraphComponents] = useState<GraphComponentRow[]>([])
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const loadData = useCallback(async () => {
    setLoadError(null)
    setGraphError(null)
    setGraphComponents([])
    setLoading(true)
    setGraphLoading(false)

    let p: Project[] = []
    let r: Repository[] = []

    try {
      ;[p, r] = await Promise.all([api.getProjects(), api.getRepositories()])
      setProjects(p)
      setRepos(r)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
      setProjects([])
      setRepos([])
      return
    } finally {
      setLoading(false)
    }

    const scopes = buildScopeOptions(p, r)
    if (scopes.length === 0) return

    setGraphLoading(true)
    try {
      const cache = new Map<string, Awaited<ReturnType<typeof api.getGraphSummary>> | null>()
      const fetchSummary = async (repoId: string, scoped: boolean) => {
        const k = `${repoId}:${scoped ? '1' : '0'}`
        if (cache.has(k)) return cache.get(k) ?? null
        const data = await api.getGraphSummary(repoId, true, scoped).catch(() => null)
        cache.set(k, data)
        return data
      }

      const rows: GraphComponentRow[] = []
      for (const scope of scopes) {
        const rid = scope.repoIdsForSummary[0]
        if (!rid) continue
        const data = await fetchSummary(rid, !!scope.repoScoped)
        if (!data) continue
        for (const name of extractComponentNames(data.samples)) {
          rows.push({
            name,
            scopeKey: scope.key,
            graphProjectId: scope.graphProjectId,
            scopeLabel: scope.label,
          })
        }
      }
      rows.sort(
        (a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
          a.scopeLabel.localeCompare(b.scopeLabel, undefined, { sensitivity: "base" }),
      )
      setGraphComponents(rows)
    } catch (e) {
      setGraphError(e instanceof Error ? e.message : String(e))
    } finally {
      setGraphLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void loadData()
  }, [open, loadData])

  useEffect(() => {
    if (!open) {
      setQuery("")
      setSelected(0)
      setLoadError(null)
      setGraphError(null)
      setGraphComponents([])
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const t = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(t)
  }, [open])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  const results = useMemo((): SearchResult[] => {
    const q = query
    const out: SearchResult[] = []

    for (let i = 0; i < SHORTCUTS.length; i++) {
      const s = SHORTCUTS[i]
      if (matchesQuery(q, s.label, s.detail)) {
        out.push({ ...s, id: `shortcut-${i}` })
      }
    }

    for (const p of projects) {
      const label = projectDisplayName(p)
      const detail = p.description?.trim() || `${p.repositories.length} repo(s)`
      if (
        matchesQuery(
          q,
          label,
          p.id,
          p.description,
          p.repositories.map((r) => `${r.projectKey}/${r.repoSlug}`).join(" "),
        )
      ) {
        out.push({
          id: `project-${p.id}`,
          kind: "project",
          label,
          detail,
          to: `/projects/${p.id}`,
          icon: LayoutDashboard,
        })
      }
    }

    for (const r of repos) {
      const label = `${r.projectKey}/${r.repoSlug}`
      if (matchesQuery(q, label, r.id, r.provider, r.defaultBranch)) {
        out.push({
          id: `repo-${r.id}`,
          kind: "repo",
          label,
          detail: `${r.provider} · ${r.status}`,
          to: `/repos/${r.id}`,
          icon: FolderGit2,
        })
      }
    }

    if (norm(q).length > 0) {
      const cap = 35
      let nComp = 0
      for (const c of graphComponents) {
        if (nComp >= cap) break
        if (!matchesQuery(q, c.name, c.scopeLabel)) continue
        const safeId = `${c.scopeKey}:${c.name}`.replace(/[^\w-:.]/g, "_")
        out.push({
          id: `component-${safeId}`,
          kind: "component",
          label: c.name,
          detail: c.scopeLabel,
          to: hrefGraphExplorer({
            scopeKey: c.scopeKey,
            graphProjectId: c.graphProjectId,
            componentName: c.name,
          }),
          icon: Share2,
        })
        nComp += 1
      }
    }

    return out.slice(0, 55)
  }, [query, projects, repos, graphComponents])

  useEffect(() => {
    setSelected(0)
  }, [query])

  useEffect(() => {
    setSelected((i) => (results.length === 0 ? 0 : Math.min(i, results.length - 1)))
  }, [results.length])

  const go = useCallback(
    (to: string) => {
      navigate(to)
      setOpen(false)
    },
    [navigate],
  )

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelected((i) => (results.length ? (i + 1) % results.length : 0))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelected((i) =>
        results.length ? (i - 1 + results.length) % results.length : 0,
      )
    } else if (e.key === "Enter" && results[selected]) {
      e.preventDefault()
      go(results[selected].to)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center gap-2 px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-[var(--radius-lg)] text-[var(--foreground-subtle)] text-sm text-left transition-colors hover:border-[var(--border-hover)] hover:text-[var(--foreground-muted)] touch-manipulation",
          "hidden md:flex w-48 lg:w-72 shrink-0",
          className,
        )}
        aria-haspopup="dialog"
        aria-label="Abrir búsqueda (Cmd o Ctrl + K)"
      >
        <Search className="w-4 h-4 shrink-0" />
        <span className="truncate">Buscar…</span>
        <kbd className="ml-auto hidden lg:inline pointer-events-none rounded border border-[var(--border)] bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--foreground-muted)]">
          ⌘K
        </kbd>
      </button>

      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex md:hidden flex-1 min-w-0 items-center gap-2 px-3 py-2.5 bg-[var(--background)] border border-[var(--border)] rounded-[var(--radius-lg)] text-[var(--foreground-subtle)] text-sm touch-manipulation text-left",
          className,
        )}
        aria-haspopup="dialog"
        aria-label="Abrir búsqueda"
      >
        <Search className="w-4 h-4 shrink-0 opacity-70" />
        <span className="truncate">Buscar…</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="sm:max-w-lg gap-0 p-0 overflow-hidden max-h-[min(85dvh,560px)] flex flex-col"
          showCloseButton
        >
          <DialogHeader className="px-4 pt-4 pb-2 space-y-1 text-left">
            <DialogTitle className="text-base">Buscar en Ariadne</DialogTitle>
            <DialogDescription className="text-xs">
              Proyectos, repos, componentes del grafo (tras indexar) y atajos. Escribe para filtrar
              componentes. <span className="whitespace-nowrap">⌘K / Ctrl+K</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="px-4 pb-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--foreground-subtle)] pointer-events-none" />
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder="Proyecto, repo, componente…"
                className="pl-9 h-10"
                autoComplete="off"
                aria-autocomplete="list"
                aria-controls="header-search-results"
              />
            </div>
            {loading && (
              <p className="text-xs text-[var(--foreground-muted)] mt-2">Cargando proyectos y repos…</p>
            )}
            {!loading && graphLoading && (
              <p className="text-xs text-[var(--foreground-muted)] mt-2">
                Indexando componentes del grafo (graph-summary)…
              </p>
            )}
            {graphError && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-2" role="status">
                Componentes no disponibles: {graphError}
              </p>
            )}
            {loadError && (
              <p className="text-xs text-destructive mt-2" role="alert">
                {loadError}
              </p>
            )}
          </div>

          <div
            id="header-search-results"
            className="flex-1 min-h-0 overflow-y-auto border-t border-[var(--border)] py-2"
            role="listbox"
          >
            {results.length === 0 && !loading && !graphLoading && (
              <p className="px-4 py-6 text-sm text-[var(--foreground-muted)] text-center">
                Sin coincidencias. Prueba otro término; los componentes del grafo aparecen al escribir
                (índice cargado).
              </p>
            )}
            <ul className="space-y-0.5 px-2">
              {results.map((r, idx) => {
                const Icon = r.icon
                const active = idx === selected
                return (
                  <li key={r.id} role="option" aria-selected={active}>
                    <button
                      type="button"
                      onMouseEnter={() => setSelected(idx)}
                      onClick={() => go(r.to)}
                      className={cn(
                        "w-full flex items-start gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors touch-manipulation",
                        active
                          ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                          : "hover:bg-[var(--secondary)] text-[var(--foreground)]",
                      )}
                    >
                      <Icon
                        className={cn(
                          "w-4 h-4 shrink-0 mt-0.5",
                          active ? "text-[var(--primary-foreground)]" : "text-[var(--foreground-subtle)]",
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium block truncate">{r.label}</span>
                        {r.detail && (
                          <span
                            className={cn(
                              "text-xs block truncate",
                              active ? "opacity-90" : "text-[var(--foreground-muted)]",
                            )}
                          >
                            {r.kind === "project"
                              ? "Proyecto · "
                              : r.kind === "repo"
                                ? "Repo · "
                                : r.kind === "component"
                                  ? "Grafo · "
                                  : ""}
                            {r.detail}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
