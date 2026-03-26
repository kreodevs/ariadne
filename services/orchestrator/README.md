# AriadneSpec Orchestrator (NestJS + LangGraph)

Orquestación de agentes y flujos SDD (constitution §2.C).

## Flujo LangGraph

- **Base:** `validate_impact` → `fetch_contracts` → **`contract_verifier`** (props grafo vs `proposedProps`).
- **Completo (`POST /workflow/refactor/full`):** … → `weaver` → **`shadow_index`** → condicional:
  - OK → `compare_graphs` → **`generate_tests`** → END.
  - Fallo indexación (error API/Cypher/Falkor en body) → **`revise_code_llm`** → vuelve a `shadow_index` (hasta `maxRevisions`, default 3) si hay `OPENAI_API_KEY`; si no, END.

## HTTP

- **GET /workflow/refactor/:nodeId** — Impacto + contrato + verificador.
- **POST /workflow/refactor/validate** — Igual con `proposedProps` en body.
- **POST /workflow/refactor/full** — Pipeline con shadow, bucle LLM y tests sugeridos.

## Variables de entorno

- `PORT` — Default 3001.
- `ARIADNESPEC_API_URL` — API Ariadne (default `http://api:3000`).
- `OPENAI_API_KEY` — Opcional; habilita revisión automática del código ante fallo de shadow y generación de tests.
- `ORCHESTRATOR_LLM_MODEL` — Default `gpt-4o-mini`.

## Redis

Estado de sesión: módulo `redis-state` (cuando se use persistencia de flujo).
