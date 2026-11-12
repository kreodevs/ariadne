# AGENTS.md — Ariadne Codebase Intelligence

You have access to **Ariadne MCP** — a knowledge graph of this codebase powered by FalkorDB. It knows every component, function, route, model, import, and prop contract. Use it **before** writing code, not after.

## First steps (every session)

```
list_known_projects()
```

This gives you project IDs, repo names, and branches. Use the `roots[].id` (repo ID) as `projectId` in multi-root projects, not the project UUID. If you're editing a file, pass `currentFilePath` instead — the server infers the project.

## Core workflow

```
1. list_known_projects() → get_sync_status(projectId)  [STOP if stale before large refactors]
2. semantic_search("what you're looking for") → find relevant code
3. get_file_context(filePath) or get_file_content(path) → read the file
4. validate_before_edit(nodeName) → check impact + contract
5. Edit the code
6. detect_changes() → pre-commit blast radius check
```

## Planned change workflow (multi-file / refactors)

```
1. get_sync_status → resync if stale
2. Gate 1: get_modification_plan(userDescription) → filesToModify + changePlanTemplate
3. Build ChangePlan JSON (include referencePlan from Gate 1)
4. Gate 2: validate_change_plan → STOP if verdict === BLOCKED
5. Per symbol: validate_before_edit + get_references
6. Edit → detect_changes before commit
```

## Tool catalog

### Discovery (find things)
- **`semantic_search`** — Hybrid vector+keyword search. Most common entry point. Automatically returns 1-hop **Ego-Graphs** & TypeScript type contracts for top nodes to eliminate hallucinations and save Cursor prompt tokens. Pass `query` + optional `projectId`/`limit`.
- **`sync_local_file`** — Real-time live delta sync from IDE buffer/disk to FalkorDB without requiring commit/push to remote.
- **`query_graph`** — Read-only Cypher against FalkorDB (no LLM). Fast structural queries (dead code, CALLS, IMPORTS). Blocks writes; auto-scopes by `projectId` when sharding.
- **`find_similar_implementations`** — Before writing a new function, check if something similar already exists.
- **`ask_codebase`** — Natural language Q&A over the codebase. Requires `question`. Pass `responseMode: "raw_evidence"` for structured JSON. **Route to cheaper tools** (get_file_content, get_definitions) when you already know the path/symbol.
- **`list_known_projects`** — All indexed projects with IDs and branches.

### Read code
- **`get_file_content`** — Fetch file contents from Bitbucket/GitHub. Requires `path`. Optional: `projectId`, `ref` (branch).
- **`get_file_context`** — File contents + its imports + exports. Use as step 2 after finding a file.
- **`get_definitions`** — Where a symbol is defined (file, line numbers). Avoids hallucinating locations.
- **`get_references`** — Every place that uses a symbol. Critical before renaming.
- **`get_implementation_details`** — Props, signatures, descriptions, endpoints for a component/function.
- **`get_functions_in_file`** — List all functions/components inside a specific file.

### Graphs & architecture
- **`get_component_graph`** — Dependency tree (RENDERS, IMPORTS, USES_HOOK). Uses Nest API with auth forwarding.
- **`get_legacy_impact`** — Dependents of a node (who calls/renders it).
- **`get_import_graph`** — What a file imports and exports.
- **`generate_navigation_map`** — Full frontend route map with components, forms, and API endpoints. Supports diff mode.
- **`extract_design_tokens`** — Parse Tailwind/CSS tokens into structured JSON.

### Impact analysis (before editing)
- **`validate_before_edit`** — **MANDATORY** before touching any component/function. Returns dependents + prop contract.
- **`get_affected_scopes`** — Full blast radius: which files/nodes break if you modify X.
- **`check_breaking_changes`** — Alerts if you're about to remove a parameter still in use.
- **`get_contract_specs`** — Real prop names and types from the graph. Force the AI to use correct names.

### Code health
- **`trace_reachability`** — Find dead code (unreachable from entry points like routes/index/main).
- **`check_export_usage`** — Exports with no imports anywhere in the monorepo.
- **`get_debt_report`** — Orphan nodes dead code + structural complexity report.
- **`find_duplicates`** — Identical files by content hash.
- **`get_project_analysis`** — Full analysis: `diagnostico`, `duplicados`, `reingenieria`, `codigo_muerto`, `seguridad`.

### Planning & review
- **`get_modification_plan`** — Returns `filesToModify` + business questions. Multi-root: pass `roots[].id`.
- **`validate_change_plan`** — Gate 2: audit structured ChangePlan JSON; returns `APPROVED` | `APPROVED_WITH_WARNINGS` | `BLOCKED`. **Mandatory** before multi-file edits.
- **`export_brownfield_project_parity_pack`** — **Forge multi-root:** MDD fusionado + seeds + scaffold (`projectId` = UUID proyecto Ariadne).
- **`generate_merged_project_mdd`** — MDD fusionado multi-root sin parity pack completo.
- **`export_brownfield_parity_pack`** — Parity pack mono-repo (`repositoryId` = `roots[].id`).
- **`generate_legacy_documentation`** — MDD de un repo / scope acotado.
- **`generate_scaffold_from_mdd`** — Nest/React/Prisma skeleton files from persisted MDD (no business logic).
- **`detect_changes`** — Pre-commit blast radius: `mode` staged|unstaged|all, returns JSON (`changedFiles`, `affectedSymbols`, risk summary).
- **`analyze_local_changes`** — Deprecated alias of `detect_changes` (Markdown output, default `mode=staged`).
- **`review_diff`** — Review any diff or PR URL with legacy context enrichment.
- **`get_sync_status`** — Is the graph up to date? Check before trusting results.
- **`get_project_standards`** — Prettier, ESLint, tsconfig snippets. Make new code indistinguishable.

## Rules

1. **Always validate before editing** — `validate_before_edit` on the node you're about to touch. No exceptions.
2. **Resolve projectId early** — Cache it. Every tool that accepts `projectId` works better with it.
3. **Multi-root projects** — Pass `roots[].id` (repo ID) as `projectId`, not the project UUID. Use `currentFilePath` to let the server resolve it.
4. **Route to cheap tools** — If you know the symbol/path, use `get_file_content`/`get_definitions`/`get_references` instead of `ask_codebase`. Less latency, fewer tokens.
5. **Check for duplicates before writing** — `find_similar_implementations` before implementing anything new.
6. **Pre-commit review** — `detect_changes()` (or legacy `analyze_local_changes()`) before every commit to catch broken dependencies.
7. **Graph freshness** — Call `get_sync_status` before Gate 1/2; if `stale: true`, resync first.
8. **Two gates for refactors** — `get_modification_plan` then `validate_change_plan`; never skip Gate 2 on multi-file work.
9. **Live Local Sync** — When editing files without committing, use `sync_local_file(filePath, content)` or run `pnpm --filter ariadne-mcp daemon` so FalkorDB always reflects your working tree. Commits made outside the IDE (agents, terminal) are synced by the `post-commit` git hook that `ariadne link` installs (idempotent; see `scripts/git-hooks/README.md`).
