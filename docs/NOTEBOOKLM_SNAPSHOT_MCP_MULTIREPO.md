# Ariadne / FalkorSpecs — `get_modification_plan`, multi-root y scope (snapshot para NotebookLM)

**Fecha de referencia:** 2026-03-19 (actualizado: grounding, `scope`, dos fases chat)  
**Proyecto:** ariadne-ai-scout (monorepo: ingest, MCP FalkorSpecs Oracle, frontend de ayuda).

## Resumen ejecutivo

- **`list_known_projects`** devuelve `[{ id, name, roots: [{ id, name, branch? }] }]`: `id` = proyecto Ariadne; cada `roots[].id` = repositorio indexado.
- **`get_modification_plan`** → `POST /projects/:id/modification-plan` con `userDescription` y opcionalmente **`scope`**: `{ repoIds?, includePathPrefixes?, excludePathGlobs? }` (post-filtro de `filesToModify`).
- **`ask_codebase`** (MCP) envía al ingest `message`, `scope?`, `twoPhase?`; el pipeline aplica el mismo `scope` a Cypher, búsqueda semántica y `get_file_content`.
- **Contrato multi-root:** como `projectId` conviene el **`roots[].id` del repositorio objetivo**; si solo pasas el id del proyecto Ariadne, el ingest puede anclar al primer repo asociado.
- **Ingest:** `getModificationPlanByProject` resuelve UUID de repo vs proyecto (`findOptionalById`).

## Cambios de código (referencia)

- `services/ingest/src/chat/chat-scope.util.ts` — filtros multi-root.
- `services/ingest/src/chat/chat.service.ts` — pipeline unificado: scope, `retrieval_summary`, telemetría `pathGroundingRatio`; `getModificationPlan` con `scope`.
- `services/mcp-falkorspec/src/index.ts` — `scope` / `twoPhase` en `ask_codebase` y `scope` en `get_modification_plan`.

## Documentación alineada (no exhaustiva)

- `docs/plan_mcp_grounding_y_retrieval.md`, `docs/MCP_AYUDA.md`, `docs/mcp_server_specs.md`, `docs/CHAT_Y_ANALISIS.md`
- Raíz: `AGENTS.md`; `frontend/public/AGENTS.md`, `frontend/public/mcp_server_specs.md`, `frontend/public/ayuda-mcp.md`
- `.cursor/skills/falkorspecs-mcp/SKILL.md`, `services/mcp-falkorspec/README.md`

## Flujo recomendado para agentes

1. `list_known_projects` → proyecto y **`roots[].id`** del repo donde está el código.
2. `get_modification_plan` con `projectId` = ese **`roots[].id`**, `userDescription`, y si hace falta **`scope`** (p. ej. `repoIds: [<uuid del root>]` o prefijos `src/…`) para no mezclar ERP/frontend.
3. `ask_codebase` con el mismo **`scope`** si las preguntas NL deben ignorar otros roots.
