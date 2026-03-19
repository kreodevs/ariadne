---
name: falkorspecs-mcp
description: Protocol for using MCP FalkorSpecs Oracle tools when maintaining legacy code. Use when: diagnóstico de archivo/componente/hook (e.g. "diagnóstico de usePauta.tsx"), FalkorSpecs MCP, technical debt, validate_before_edit, get_project_analysis, semantic search, refactoring legacy components, or user mentions Ariadne, FalkorDB, or project analysis. Always invoke MCP tools (get_component_graph, get_legacy_impact, get_definitions, get_references) when user asks for file/component diagnostics—do NOT rely only on Read/Grep.
---

# FalkorSpecs MCP Protocol

Protocol for using the MCP FalkorSpecs Oracle tools (get_component_graph, validate_before_edit, get_project_analysis, etc.) when maintaining indexed codebases.

## Session Start

1. **Run `list_known_projects`** to map project names to IDs.
2. If `.ariadne-project` exists in workspace root, read its `projectId` and use it in all MCP calls.
3. If user mentions project by name (e.g. "oohbp2"), use `list_known_projects` → find matching `id` → pass as `projectId`.

## Tools by Intent

| User Intent | Tool | Flow |
|-------------|------|------|
| **Diagnóstico de archivo/componente/hook** ("diagnóstico de usePauta.tsx", "analiza Board") | `get_component_graph`, `get_legacy_impact`, `get_definitions`, `get_references` | **Use MCP first**, not just Read/Grep. list_known_projects → projectId → get_component_graph + get_legacy_impact + get_definitions/get_references. |
| Diagnóstico proyecto, duplicados, reingeniería, código muerto | `get_project_analysis` | list_known_projects → projectId → get_project_analysis(projectId, mode). **Código muerto:** presentar el resultado tal cual, sin reformatear. No reorganizar en "Eliminar sin riesgo" / "Candidatos" / etc. No sugerir `rg`. El backend es la fuente de verdad. |
| "¿Cómo funciona X?", explicar flujo | `ask_codebase` | Pass projectId + question |
| Búsqueda por término | `semantic_search`, `find_similar_implementations` | Direct query |
| Antes de editar componente/función | `validate_before_edit` | Required — returns impact + contract |

**Never invent props or assume IDs.** Use what the graph returns.

## Before Editing (SDD)

**OBLIGATORY** before modifying a component or function:

1. Call `validate_before_edit(nodeName, projectId?)`.
2. If `[NOT_FOUND_IN_GRAPH]` → do not proceed; suggest reindex.
3. Use props/signatures from the response — do not invent.
4. Use `get_file_content` for current code.

## Refactoring Flow

1. **Find** → semantic_search / find_similar_implementations
2. **Context** → get_file_context / get_definitions + get_references
3. **Validate** → validate_before_edit + check_breaking_changes
4. **Edit** → apply change
5. **Imports** → see "Imports when creating new files"

Before renaming: `get_references`. Before new code: `find_similar_implementations` + `get_project_standards`.

## Imports when creating new files

**REQUIRED** when extracting code to a new file (hook, util, component):

- **Do NOT assume folder structure.** e.g. `contexts` may be in `src/contexts` or `src/components/contexts` — the relative path depends on actual location.
- **Derive paths from the file being refactored.** Use the original file's import paths as reference. If it imports `../../contexts/usePauta`, the module is 2 levels up from the original. From the new file's folder, compute the equivalent path.
- **Verify actual location** of each imported module: `get_definitions` (node path) or list repo. Never invent paths.
- **Include in refactoring plan:**
  - Step: "After creating the new file, verify import paths are correct from its location."
  - Step: "Run `npm run build` or `npm run dev` and fix import resolution errors until everything compiles."
- Import paths in the new file must resolve **from the new file's folder**, not from the source file.
