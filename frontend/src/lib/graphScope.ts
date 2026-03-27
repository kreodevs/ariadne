/**
 * Alcance del grafo (multi-root vs repo suelto) y utilidades para listar componentes vía graph-summary.
 * Compartido entre ComponentGraph y HeaderSearch.
 */
import type { Project, Repository } from '@/types'

export type ScopeOption = {
  key: string
  /** UUID para GET /graph/component?projectId= */
  graphProjectId: string
  label: string
  detail: string
  repoIdsForSummary: string[]
  group: 'project' | 'standalone' | 'project_repo'
  /** Si true, GET graph-summary?repoScoped=1 para listar solo nodos de ese repositorio. */
  repoScoped?: boolean
}

export function buildScopeOptions(projects: Project[], repos: Repository[]): ScopeOption[] {
  const repoIdsInProjects = new Set<string>()
  for (const p of projects) {
    for (const r of p.repositories) repoIdsInProjects.add(r.id)
  }

  const out: ScopeOption[] = []

  for (const p of projects) {
    const repoIds = p.repositories.map((r) => r.id)
    if (repoIds.length === 0) continue
    const projectLabel = p.name?.trim() || `Proyecto ${p.id.slice(0, 8)}…`
    out.push({
      key: `project:${p.id}`,
      graphProjectId: p.id,
      label: projectLabel,
      detail: p.repositories.map((r) => `${r.projectKey}/${r.repoSlug}`).join(', '),
      repoIdsForSummary: repoIds,
      group: 'project',
      repoScoped: false,
    })
    for (const r of p.repositories) {
      out.push({
        key: `projectRepo:${p.id}:${r.id}`,
        graphProjectId: p.id,
        label: `${r.projectKey}/${r.repoSlug}`,
        detail: `Dentro de «${projectLabel}» (solo este repo)`,
        repoIdsForSummary: [r.id],
        group: 'project_repo',
        repoScoped: true,
      })
    }
  }

  for (const r of repos) {
    if (repoIdsInProjects.has(r.id)) continue
    out.push({
      key: `repo:${r.id}`,
      graphProjectId: r.id,
      label: `${r.projectKey}/${r.repoSlug}`,
      detail: 'Repositorio sin proyecto',
      repoIdsForSummary: [r.id],
      group: 'standalone',
      repoScoped: false,
    })
  }

  const rank: Record<ScopeOption['group'], number> = {
    project: 0,
    project_repo: 1,
    standalone: 2,
  }
  return out.sort((a, b) => {
    const gr = rank[a.group] - rank[b.group]
    if (gr !== 0) return gr
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
  })
}

export function extractComponentNames(samples: Record<string, unknown[]> | undefined): string[] {
  const rows = (samples?.Component ?? []) as Array<{ name?: unknown }>
  const names = new Set<string>()
  for (const row of rows) {
    const n = row?.name
    if (typeof n === 'string' && n.trim()) names.add(n.trim())
  }
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

/** Navegación al explorador con nombre de componente preseleccionado (hidrata igual que la propia página). */
export function hrefGraphExplorer(opts: {
  scopeKey: string
  graphProjectId: string
  componentName: string
  depth?: string
}): string {
  const p = new URLSearchParams()
  p.set('scope', opts.scopeKey)
  p.set('projectId', opts.graphProjectId)
  p.set('name', opts.componentName)
  if (opts.depth) p.set('depth', opts.depth)
  return `/graph-explorer?${p.toString()}`
}
