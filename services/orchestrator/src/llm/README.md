# LLM del orchestrator

Capa desacoplada: **OpenAI**, **Google Gemini** o **Kimi (Moonshot)**.

## Variables homologadas (recomendado)

| Variable | Rol |
|----------|-----|
| `LLM_PROVIDER` | `openai` \| `google` \| `kimi` / `moonshot`. Si falta, se infiere por claves legadas (`OPENAI_API_KEY`, `GOOGLE_API_KEY`, `MOONSHOT_API_KEY`/`KIMI_API_KEY`). |
| `LLM_MODEL` | Modelo único para el proveedor activo (p. ej. `gpt-4o-mini`, `gemini-2.0-flash`, `kimi-k2.5`). Si falta, defaults por proveedor. |
| `LLM_API_KEY` | Clave única; se usa para el proveedor elegido (junto con `LLM_PROVIDER` si solo hay esta clave). |
| `LLM_TEMPERATURE` | Opcional (0–2). **Kimi:** si no se define, se envía **1** (requisito de muchos modelos). |
| `LLM_MAX_CONCURRENT` | Máximo de llamadas LLM **en vuelo** a la vez (default **2**). `0` = sin límite de concurrencia. |
| `LLM_MIN_REQUEST_INTERVAL_MS` | Separación mínima entre **inicios** de petición al proveedor (default **250** ms). Con Kimi y 429 TPM, prueba **1500–3000**. `0` = sin espaciado. |
| `MOONSHOT_TPM_RETRY_COOLDOWN_MS` | Tras 429 TPM, espera base entre reintentos (default **58000** ms). Subir si el plan sigue muy justo. |
| `MOONSHOT_RATE_LIMIT_ATTEMPTS` | Reintentos máx. ante **429/503** en Kimi (default **12**, tope **30**). |
| `MOONSHOT_TPM_SHARED_COOLDOWN` | Default **activo**: al detectar 429 TPM, **todas** las llamadas Kimi esperan el mismo cooldown antes del siguiente `fetch` (evita varios hilos reventando el TPM a la vez). `false` / `0` / `no` lo desactiva. |
| `LLM_THROTTLE_DISABLED` | `1` / `true` / `yes` desactiva throttling (tests o depuración). |

## Compatibilidad (sigue funcionando)

`ORCHESTRATOR_LLM_PROVIDER`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `MOONSHOT_API_KEY`, `KIMI_API_KEY`, `CHAT_MODEL`, `ORCHESTRATOR_LLM_MODEL`, `GOOGLE_LLM_MODEL`, `KIMI_LLM_MODEL`, `KIMI_TEMPERATURE`, `MOONSHOT_BASE_URL`.

Prioridad modelo: **`LLM_MODEL`** → variables legacy por proveedor → default (`gpt-4o-mini` / `gemini-2.0-flash` / **`kimi-k2.5`**).

## Throttling (todos los proveedores)

`orchestrator-llm.facade.ts` envuelve **todas** las llamadas (`callOrchestratorLlm`, `callOrchestratorLlmWithTools`, `orchestratorChatSimple`) con `llm-request-throttle.ts`: límite de **concurrencia** + **espaciado** entre inicios. Ajusta con `LLM_MAX_CONCURRENT` y `LLM_MIN_REQUEST_INTERVAL_MS`.

## Kimi / Moonshot (rate limits)

La API puede responder **429** con `rate_limit_reached_error` (**TPM**: tokens por minuto del proyecto). `kimi-llm.adapter.ts` reintenta **429** y **503** (`MOONSHOT_RATE_LIMIT_ATTEMPTS`, default **12**): si el cuerpo indica TPM, espera **máx(base ~58 s + escalonado, alineación al siguiente minuto UTC + margen)** y además **cooldown compartido** entre todas las peticiones Kimi (`MOONSHOT_TPM_SHARED_COOLDOWN`, activo por defecto) para que ningún otro hilo dispare mientras el bucket sigue caliente; si no es TPM, backoff exponencial desde 3 s (tope 90 s). Respeta `Retry-After` si viene. Si tras todos los intentos sigue 429, el error sube al handler: reduce prompts / `max_tokens`, **`LLM_MAX_CONCURRENT=1`**, **`LLM_MIN_REQUEST_INTERVAL_MS`**, o sube cuota en [Moonshot límites](https://platform.moonshot.ai/docs/pricing/limits).

## Archivos

- `llm-unified.ts` — Resolución homologada de proveedor, modelo y claves.
- `orchestrator-llm-config.ts` — Reexporta `resolveLlmProvider`, `orchestratorLlmModel`, `hasOrchestratorLlmConfigured`.
- `moonshot-env.ts` — URL base Kimi + `llmChatTemperature()`.
- `openai-llm.adapter.ts`, `google-llm.adapter.ts`, `kimi-llm.adapter.ts`, `orchestrator-llm.facade.ts`, `llm-request-throttle.ts`.
