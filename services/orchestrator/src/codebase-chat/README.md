# Codebase chat / análisis / modification-plan

- **`POST /codebase/chat/repository/:repositoryId`** — ask_codebase (LangGraph: retrieve → synthesize).
- **`POST /codebase/chat/project/:projectId`** — Igual, alcance proyecto multi-repo. El ingest, en **`execute_cypher`**, usa los **cypherShardContexts** del proyecto (whitelist de dominios) para unir resultados de varios grafos Falkor con el `projectId` correcto por nodo.
- **`POST /codebase/analyze/repository/:repositoryId`** — Body `{ mode }`. Llama a ingest `internal/.../analyze-prep` (sin LLM en ingest salvo recopilar datos) y ejecuta la síntesis LLM aquí si `kind === 'llm'`.
- **`POST /codebase/analyze/project/:projectId`** — Body `{ mode: 'agents' | 'skill' }` para AGENTS.md / SKILL.md vía prep por proyecto.
- **`POST /codebase/modification-plan/repository/:repositoryId`** — Body `{ userDescription, scope? }`. Lista de archivos desde ingest (`modification-plan-files`); preguntas de afinación generadas con LLM en orchestrator.
- **`POST /codebase/modification-plan/project/:projectId`** — Igual; `projectId` puede ser proyecto Ariadne o `roots[].id` (repo).

Variables: `INGEST_URL`, `INTERNAL_API_KEY`, y credenciales LLM según `ORCHESTRATOR_LLM_PROVIDER` (`OPENAI_API_KEY` o `GOOGLE_API_KEY`) — preguntas de modification-plan y síntesis de analyze/chat. Ver [../llm/README.md](../llm/README.md).
