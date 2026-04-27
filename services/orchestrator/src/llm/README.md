# LLM del orchestrator

Todo el tráfico sale por **OpenRouter** (API compatible OpenAI), alineado con **The Forge**.

## Variables

| Variable | Rol |
|----------|-----|
| `OPENROUTER_API_KEY` | Clave (obligatoria). Alias: `AI_API_KEY`, `OPENAI_API_KEY`. |
| `OPENROUTER_BASE_URL` | Default `https://openrouter.ai/api/v1`. |
| `OPENROUTER_CHAT_MODEL` | Default `nousresearch/hermes-3-llama-3.1-405b` (mismo default que The Forge). |
| `OPENROUTER_HTTP_REFERER` / `OPENROUTER_APP_TITLE` | Cabeceras opcionales de OpenRouter. |
| `LLM_MODEL` | Si está definida, tiene prioridad sobre `OPENROUTER_*` de modelo (homologado). |
| `ORCHESTRATOR_LLM_MODEL` / `CHAT_MODEL` | Compatibilidad: se usan si `LLM_MODEL` y `OPENROUTER_CHAT_MODEL` no fijan modelo. |
| `LLM_API_KEY` | Alias de clave (misma prioridad que en The Forge: preferir `OPENROUTER_API_KEY`). |
| `LLM_TEMPERATURE` | Temperatura en requests (default 0.1 en completions con tools). |
| `LLM_MAX_CONCURRENT` | Máximo de llamadas LLM en vuelo (default **1**). `0` = sin límite. |
| `LLM_MIN_REQUEST_INTERVAL_MS` | Separación mínima entre inicios de petición (default **2000** ms). `0` = sin espaciado. |
| `LLM_THROTTLE_DISABLED` | `1` / `true` desactiva throttling (tests o depuración). |

`orchestrator-llm.facade.ts` envuelve las llamadas con `llm-request-throttle.ts`.

## Archivos

- `llm-config.ts` — Base URL, clave, cabeceras OpenRouter.
- `llm-unified.ts` — Resolución de modelo (solo runtime OpenRouter).
- `orchestrator-llm-config.ts` — `hasOrchestratorLlmConfigured`, `orchestratorLlmModel()`.
- `openai-llm.adapter.ts` — Cliente HTTP a `/v1/chat/completions` en la base OpenRouter (formato OpenAI).
- `orchestrator-llm.facade.ts`, `llm-request-throttle.ts`, `llm-token-estimate.ts`, `moonshot-rate-limit.error.ts` (nombre histórico; rate limit del proveedor).
