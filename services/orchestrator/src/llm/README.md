# LLM del orchestrator

Capa desacoplada: **OpenAI**, **Google Gemini** o **Kimi (Moonshot)**.

## Variables homologadas (recomendado)

| Variable | Rol |
|----------|-----|
| `LLM_PROVIDER` | `openai` \| `google` \| `kimi` / `moonshot`. Si falta, se infiere por claves legadas (`OPENAI_API_KEY`, `GOOGLE_API_KEY`, `MOONSHOT_API_KEY`/`KIMI_API_KEY`). |
| `LLM_MODEL` | Modelo único para el proveedor activo (p. ej. `gpt-4o-mini`, `gemini-2.0-flash`, `kimi-k2.5`). Si falta, defaults por proveedor. |
| `LLM_API_KEY` | Clave única; se usa para el proveedor elegido (junto con `LLM_PROVIDER` si solo hay esta clave). |
| `LLM_TEMPERATURE` | Opcional (0–2); si no, 0.1 en chat/tools y 0.2 en workflow SDD (simple). |

## Compatibilidad (sigue funcionando)

`ORCHESTRATOR_LLM_PROVIDER`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `MOONSHOT_API_KEY`, `KIMI_API_KEY`, `CHAT_MODEL`, `ORCHESTRATOR_LLM_MODEL`, `GOOGLE_LLM_MODEL`, `KIMI_LLM_MODEL`, `KIMI_TEMPERATURE`, `MOONSHOT_BASE_URL`.

Prioridad modelo: **`LLM_MODEL`** → variables legacy por proveedor → default (`gpt-4o-mini` / `gemini-2.0-flash` / **`kimi-k2.5`**).

## Archivos

- `llm-unified.ts` — Resolución homologada de proveedor, modelo y claves.
- `orchestrator-llm-config.ts` — Reexporta `resolveLlmProvider`, `orchestratorLlmModel`, `hasOrchestratorLlmConfigured`.
- `moonshot-env.ts` — URL base Kimi + `llmChatTemperature()`.
- `openai-llm.adapter.ts`, `google-llm.adapter.ts`, `kimi-llm.adapter.ts`, `orchestrator-llm.facade.ts`.
