/**
 * Error explícito cuando Moonshot/Kimi responde 429 tras agotar reintentos.
 * El orchestrator lo mapea a HTTP 429 para que ingest/MCP no lo confundan con timeout genérico.
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
