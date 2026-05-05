# LLM del orchestrator

Todo el tráfico sale por **OpenRouter** (API compatible OpenAI), alineado con **The Forge**.

## Variables

| Variable | Rol |
|----------|-----|
| `LLM_API_KEY` | Clave (obligatoria). |
| `LLM_BASE_URL` | Default `https://openrouter.ai/api/v1`. |
| `LLM_CHAT_MODEL` | Default `nousresearch/hermes-3-llama-3.1-405b`. |
| `LLM_HTTP_REFERER` / `LLM_APP_TITLE` | Cabeceras opcionales de OpenRouter. |
| `LLM_MODEL` | Si está definida, tiene prioridad sobre `LLM_CHAT_MODEL`. |
| `ORCHESTRATOR_LLM_MODEL` | Modelo específico para el orquestador (prioridad sobre `LLM_MODEL`). |
| `LLM_TEMPERATURE` | Temperatura en requests (default 0.1 en completions con tools). |
| `LLM_MAX_CONCURRENT` | Máximo de llamadas LLM en vuelo (default **1**). `0` = sin límite. |
| `LLM_MIN_REQUEST_INTERVAL_MS` | Separación mínima entre inicios de petición (default **2000** ms). `0` = sin espaciado. |
| `LLM_THROTTLE_DISABLED` | `1` / `true` desactiva throttling (tests o depuración). |

`orchestrator-llm.facade.ts` envuelve las llamadas con `llm-request-throttle.ts`.

## Archivos

- `llm-config.ts` — Base URL, clave, cabeceras OpenRouter.
- `llm-unified.ts` — Resolución de modelo (solo runtime OpenRouter).
- `orchestrator-llm-config.ts` — `hasOrchestratorLlmConfigured`, `orchestratorLlmModel()`.
- `llm.adapter.ts` — Cliente HTTP a `/v1/chat/completions` en la base configurada (formato OpenAI).
- `orchestrator-llm.facade.ts`, `llm-request-throttle.ts`, `llm-token-estimate.ts`, `moonshot-rate-limit.error.ts` (nombre histórico; rate limit del proveedor).
