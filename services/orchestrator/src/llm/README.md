# LLM del orchestrator

Capa desacoplada del proveedor: **OpenAI** (Chat Completions + tools) o **Google Gemini** (Generative Language API v1beta, function calling).

## Variables

| Variable | Rol |
|----------|-----|
| `ORCHESTRATOR_LLM_PROVIDER` | `openai`, `google` o `kimi`/`moonshot`. Auto: solo `GOOGLE_API_KEY` → google; solo `MOONSHOT_API_KEY`/`KIMI_API_KEY` (sin OpenAI/Google) → kimi. |
| `OPENAI_API_KEY` | Proveedor OpenAI. |
| `GOOGLE_API_KEY` | Proveedor Gemini. |
| `MOONSHOT_API_KEY` o `KIMI_API_KEY` | Kimi Open Platform (`https://api.moonshot.ai/v1/chat/completions`). |
| `MOONSHOT_BASE_URL` | Opcional (default `https://api.moonshot.ai/v1`). |
| `KIMI_TEMPERATURE` | Opcional: fuerza `temperature` en chat (0–2). Si no, modelos con `thinking` en el nombre usan **1** (requisito de la API); el resto 0.1 (o 0.2 en workflow SDD). |
| `ORCHESTRATOR_LLM_MODEL` / `CHAT_MODEL` | Solo **OpenAI** (default `gpt-4o-mini`). Con `google`/`kimi` no aplican (el compose suele fijar `gpt-4o-mini` y rompería Gemini/Kimi). |
| `KIMI_LLM_MODEL` / `MOONSHOT_MODEL` | Kimi (default `kimi-k2.5`). |
| `GOOGLE_LLM_MODEL` | Gemini (default `gemini-2.0-flash`). |

## Archivos

- `orchestrator-llm-config.ts` — Resolución de proveedor, modelo y `hasOrchestratorLlmConfigured()`.
- `moonshot-env.ts` — Base URL y API key Kimi/Moonshot.
- `openai-llm.adapter.ts` — `fetch` a `api.openai.com`.
- `google-llm.adapter.ts` — Gemini (`generativelanguage.googleapis.com`).
- `kimi-llm.adapter.ts` — Kimi (`/v1/chat/completions` compatible OpenAI).
- `orchestrator-llm.facade.ts` — Punto único usado por `OrchestratorLlmService` y `workflow.service.ts` (`orchestratorChatSimple`).
