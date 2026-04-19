# LLM del orchestrator

Capa desacoplada del proveedor: **OpenAI** (Chat Completions + tools) o **Google Gemini** (Generative Language API v1beta, function calling).

## Variables

| Variable | Rol |
|----------|-----|
| `ORCHESTRATOR_LLM_PROVIDER` | `openai` (default si hay `OPENAI_API_KEY`) o `google`. Si **no** está definido y solo existe `GOOGLE_API_KEY`, se usa **google**. |
| `OPENAI_API_KEY` | Proveedor OpenAI. |
| `GOOGLE_API_KEY` | Proveedor Google (misma convención que ingest para embeddings). |
| `ORCHESTRATOR_LLM_MODEL` / `CHAT_MODEL` | Modelo: OpenAI (`gpt-4o-mini`, …) o nombre Gemini (`gemini-2.0-flash`, `gemini-1.5-flash`, …). |
| `GOOGLE_LLM_MODEL` | Opcional: modelo solo para Gemini (sobrescribe el fallback de `ORCHESTRATOR_LLM_MODEL` cuando el proveedor es Google). |

## Archivos

- `orchestrator-llm-config.ts` — Resolución de proveedor, modelo y `hasOrchestratorLlmConfigured()`.
- `openai-llm.adapter.ts` — `fetch` a `api.openai.com`.
- `google-llm.adapter.ts` — `fetch` a `generativelanguage.googleapis.com` + conversión de mensajes/tools al formato Gemini.
- `orchestrator-llm.facade.ts` — Punto único usado por `OrchestratorLlmService` y `workflow.service.ts` (`orchestratorChatSimple`).
