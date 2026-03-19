---
name: skills-legacy
description: Skills y protocolos obligatorios para desarrolladores en código legacy. Usar cuando: onboarding, revisión de código, refactorización, diagnósticos, o como referencia de flujos FalkorSpecs MCP.
---

# Skills para desarrollo en código legacy

Referencia de skills y protocolos que **todos los devs** deben seguir al trabajar con código legacy indexado en FalkorSpecs.

---

## Skills obligatorios

| Skill | Cuándo usar | Ubicación |
|-------|-------------|-----------|
| **falkorspecs-mcp** | Siempre en código legacy: diagnósticos, refactors, análisis de impacto, validación antes de editar | `.cursor/skills/falkorspecs-mcp/` |

---

## Protocolo de sesión (antes de tocar código)

1. **`list_known_projects`** — mapear IDs a nombres (Legacy, Moderno, etc.)
2. **Leer `.ariadne-project`** si existe — usar su `projectId` en todas las llamadas MCP
3. **Nunca inventar ni asumir `projectId`** — si no hay `.ariadne-project`, usar `list_known_projects` para obtenerlo
4. **`get_modification_plan`** (varios repos en un proyecto) — pasar `projectId` = **`roots[].id` del repo objetivo** (p. ej. frontend), no solo el id del proyecto Ariadne, salvo que quieras el comportamiento por defecto (primer repo)

---

## Checklist por intención

### Diagnóstico de archivo/componente/hook

**No usar solo Read/Grep.** Usar el grafo:

1. `list_known_projects` → projectId
2. `get_component_graph(componentName/hookName)`
3. `get_legacy_impact(nodeName)` — qué se rompe si modificas
4. `get_definitions` + `get_references` — definición y usos

### Diagnóstico a nivel proyecto

- Deuda técnica, duplicados, reingeniería, código muerto → `get_project_analysis(projectId, mode)`
- Modos: `diagnostico` | `duplicados` | `reingenieria` | `codigo_muerto`

### Antes de editar (SDD — Spec-Driven Development)

**OBLIGATORIO** antes de modificar componente o función:

1. `validate_before_edit(nodeName)`
2. Si devuelve `[NOT_FOUND_IN_GRAPH]` → no proceder; verificar nombre o reindexar
3. Usar props/firmas del contrato devuelto — no inventar
4. `get_legacy_impact` para ver impacto

### Refactorización

| Paso | Acción |
|------|--------|
| 1 | `semantic_search` / `find_similar_implementations` |
| 2 | `get_file_context` / `get_definitions` + `get_references` |
| 3 | `validate_before_edit` + `check_breaking_changes` |
| 4 | Aplicar cambio |
| 5 | Verificar imports (ver abajo) |

**Antes de renombrar:** `get_references`. **Antes de crear código nuevo:** `find_similar_implementations` + `get_project_standards`.

### Imports al crear archivos nuevos

Al extraer a hook, utilidad o componente:

1. **No asumir estructura de carpetas** — verificar con `get_definitions` o listar el repo
2. **Derivar rutas desde el archivo que refactorizas** — la ruta relativa se resuelve desde el archivo nuevo, no desde el origen
3. **Incluir en el plan:** verificar imports + `npm run build` / `npm run dev` hasta que compile

---

## Referencias

- **AGENTS.md** — protocolo completo para agentes (MCP FalkorSpecs Oracle)
- **.cursor/rules/mcp-diagnostico.mdc** — reglas para diagnósticos de proyecto
