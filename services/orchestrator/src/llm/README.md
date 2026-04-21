# LLM del orchestrator

Capa desacoplada: **OpenAI**, **Google Gemini** o **Kimi (Moonshot)**.

## Variables homologadas (recomendado)

| Variable | Rol |
|----------|-----|
| `LLM_PROVIDER` | `openai` \| `google` \| `kimi` / `moonshot`. Si falta, se infiere por claves legadas (`OPENAI_API_KEY`, `GOOGLE_API_KEY`, `MOONSHOT_API_KEY`/`KIMI_API_KEY`). |
| `LLM_MODEL` | Modelo único para el proveedor activo (p. ej. `gpt-4o-mini`, `gemini-2.0-flash`, `kimi-k2.5`). Si falta, defaults por proveedor. |
| `LLM_API_KEY` | Clave única; se usa para el proveedor elegido (junto con `LLM_PROVIDER` si solo hay esta clave). |
| `LLM_TEMPERATURE` | Opcional (0–2). **Kimi:** si no se define, se envía **1** (requisito de muchos modelos). |
| `LLM_MAX_CONCURRENT` | Máximo de llamadas LLM **en vuelo** a la vez (default **1**, más seguro con Kimi TPM). `0` = sin límite de concurrencia. |
| `LLM_MIN_REQUEST_INTERVAL_MS` | Separación mínima entre **inicios** de petición al proveedor (default **2000** ms). Con Kimi y 429 TPM, puedes subir a **3000–5000**. `0` = sin espaciado. |
| `LLM_KIMI_TPM_BUDGET` | TPM estimado **máximo por proceso** en ventana **60s** antes de lanzar otra llamada Kimi (default **22000**, pensado en varias réplicas vs límite típico **64000** proyecto). Subir si solo hay **un** pod (p. ej. **55000**). `0` / `false` / `off` desactiva esta cola (siguen concurrencia + reintentos 429). |
| `MOONSHOT_TPM_RETRY_COOLDOWN_MS` | Tras 429 TPM, espera base entre reintentos (default **58000** ms). Subir si el plan sigue muy justo. |
| `MOONSHOT_RATE_LIMIT_ATTEMPTS` | Reintentos máx. ante **429/503** en Kimi (default **12**, tope **30**). |
| `MOONSHOT_TPM_SHARED_COOLDOWN` | Default **activo**: al detectar 429 TPM, **todas** las llamadas Kimi esperan el mismo cooldown antes del siguiente `fetch` (evita varios hilos reventando el TPM a la vez). `false` / `0` / `no` lo desactiva. |
| `LLM_THROTTLE_DISABLED` | `1` / `true` / `yes` desactiva throttling (tests o depuración). |

## Compatibilidad (sigue funcionando)

`ORCHESTRATOR_LLM_PROVIDER`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `MOONSHOT_API_KEY`, `KIMI_API_KEY`, `CHAT_MODEL`, `ORCHESTRATOR_LLM_MODEL`, `GOOGLE_LLM_MODEL`, `KIMI_LLM_MODEL`, `KIMI_TEMPERATURE`, `MOONSHOT_BASE_URL`.

Prioridad modelo: **`LLM_MODEL`** → variables legacy por proveedor → default (`gpt-4o-mini` / `gemini-2.0-flash` / **`kimi-k2.5`**).

## Throttling (todos los proveedores)

`orchestrator-llm.facade.ts` envuelve **todas** las llamadas (`callOrchestratorLlm`, `callOrchestratorLlmWithTools`, `orchestratorChatSimple`) con `llm-request-throttle.ts`: límite de **concurrencia** + **espaciado** entre inicios. Defaults conservadores (**1** en vuelo, **2000** ms) para no reventar **TPM** de Moonshot; con OpenAI/Gemini agresivos puedes subir `LLM_MAX_CONCURRENT`. Con **`LLM_PROVIDER=kimi`**, además se usa ventana **`LLM_KIMI_TPM_BUDGET`** (ver `moonshot-env.ts`) para reservar TPM estimado antes del `fetch`.

### HTTP 429 (rate limit Kimi)

Si Moonshot devuelve **429** tras agotar reintentos en `kimi-llm.adapter.ts`, el orchestrator lanza **`HttpException` 429** en **`POST /codebase/chat/*`** (no un 500 genérico). El **ingest** con `ORCHESTRATOR_URL` **repropaga** ese status hacia el cliente/MCP (`ORCHESTRATOR_RATE_LIMIT` en el body JSON), para distinguirlo de timeout MCP o de `answer: "Error: …"` con HTTP 200.

Con proveedor **Kimi**, además se aplica una **ventana deslizante 60s** sobre el coste **estimado** (`llm-token-estimate.ts`: mensajes + tools + `max_tokens`) respecto a `LLM_KIMI_TPM_BUDGET`. Es **por proceso** (no coordina varios pods): si despliegas N réplicas, deja `LLM_KIMI_TPM_BUDGET ≈ floor(límite_proyecto × 0,85 / N)` o sube cuota en Moonshot.

## Kimi / Moonshot (rate limits)

La API puede responder **429** con `rate_limit_reached_error` (**TPM**: tokens por minuto del proyecto). `kimi-llm.adapter.ts` reintenta **429** y **503** (`MOONSHOT_RATE_LIMIT_ATTEMPTS`, default **12**): si el cuerpo indica TPM, espera **máx(base ~58 s + escalonado, alineación al siguiente minuto UTC + margen)** y además **cooldown compartido** entre todas las peticiones Kimi (`MOONSHOT_TPM_SHARED_COOLDOWN`, activo por defecto) para que ningún otro hilo dispare mientras el bucket sigue caliente; si no es TPM, backoff exponencial desde 3 s (tope 90 s). Respeta `Retry-After` si viene. Si tras todos los intentos sigue 429, el error sube al handler: reduce prompts / `max_tokens`, **`LLM_MAX_CONCURRENT=1`**, **`LLM_MIN_REQUEST_INTERVAL_MS`**, o sube cuota en [Moonshot límites](https://platform.moonshot.ai/docs/pricing/limits).

## Archivos

- `llm-unified.ts` — Resolución homologada de proveedor, modelo y claves.
- `orchestrator-llm-config.ts` — Reexporta `resolveLlmProvider`, `orchestratorLlmModel`, `hasOrchestratorLlmConfigured`.
- `moonshot-env.ts` — URL base Kimi + `llmChatTemperature()`.
- `openai-llm.adapter.ts`, `google-llm.adapter.ts`, `kimi-llm.adapter.ts`, `orchestrator-llm.facade.ts`, `llm-request-throttle.ts`, `llm-token-estimate.ts`.
