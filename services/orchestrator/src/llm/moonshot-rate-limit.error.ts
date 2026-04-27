/**
 * Error explícito cuando el LLM (vía OpenRouter) devuelve 429 / rate limit.
 * El orchestrator lo mapea a HTTP 429 para que ingest/MCP no lo confundan con timeout genérico.
 * Nombre de clase conservado por compatibilidad con clientes que buscan `MoonshotRateLimit`.
 */
export class MoonshotRateLimitError extends Error {
  override readonly name = 'MoonshotRateLimitError';

  constructor(message: string) {
    super(message);
  }
}

export function isMoonshotRateLimitError(err: unknown): err is MoonshotRateLimitError {
  return err instanceof MoonshotRateLimitError;
}
