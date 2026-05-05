# LLM del orchestrator

Todo el tráfico sale por **OpenRouter** (API compatible OpenAI), alineado con **The Forge**.

## Variables

| Variable | Rol |
|----------|-----|
| `LLM_API_KEY` | Clave (obligatoria). |
| `LLM_BASE_URL` | Default `https://openrouter.ai/api/v1`. |
| `LLM_CHAT_MODEL` | Modelo global. Default `google/gemini-2.0-flash-001`. |
| `ORCHESTRATOR_LLM_MODEL` | Modelo específico para el orquestador (prioridad sobre `LLM_CHAT_MODEL`). |
| `LLM_HTTP_REFERER` / `LLM_APP_TITLE` | Cabeceras opcionales de OpenRouter. |
| `LLM_TEMPERATURE` | Temperatura (default 0.1). |
| `LLM_MAX_CONCURRENT` | Máximo de llamadas LLM concurrentes (default 1). |
| `LLM_MIN_REQUEST_INTERVAL_MS` | Intervalo mínimo entre requests (default 2000 ms). |
| `LLM_THROTTLE_DISABLED` | `1` / `true` desactiva throttling. |

`orchestrator-llm.facade.ts` envuelve las llamadas con `llm-request-throttle.ts`.

## Archivos

- `llm-config.ts` — Base URL, clave, cabeceras OpenRouter.
- `llm-unified.ts` — Resolución de modelo (runtime). Variables: `LLM_CHAT_MODEL` (global), `ORCHESTRATOR_LLM_MODEL` (específico).
- `orchestrator-llm-config.ts` — `hasOrchestratorLlmConfigured`, `orchestratorLlmModel()`.
- `llm.adapter.ts` — Cliente HTTP a `/v1/chat/completions` en la base configurada (formato OpenAI).
- `orchestrator-llm.facade.ts`, `llm-request-throttle.ts`, `llm-token-estimate.ts`, `moonshot-rate-limit.error.ts` (nombre histórico; rate limit del proveedor).
