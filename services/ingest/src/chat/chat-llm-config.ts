import {
  hasIngestLlmCredentials,
  resolveIngestLlmModel,
  resolveIngestLlmProvider,
} from './llm-unified';

/** @deprecated usar resolveIngestLlmProvider */
export type IngestChatLlmProvider = 'openai' | 'kimi';

export function resolveIngestChatLlmProvider(): IngestChatLlmProvider {
  return resolveIngestLlmProvider();
}

export function ingestChatLlmModel(): string {
  return resolveIngestLlmModel(resolveIngestLlmProvider());
}

export function hasIngestLlmConfigured(): boolean {
  return hasIngestLlmCredentials(resolveIngestLlmProvider());
}
