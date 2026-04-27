import {
  hasIngestLlmCredentials,
  resolveIngestLlmModel,
  resolveIngestLlmProvider,
} from './llm-unified';

export type IngestChatLlmProvider = 'openrouter';

export function resolveIngestChatLlmProvider(): IngestChatLlmProvider {
  return resolveIngestLlmProvider();
}

export function ingestChatLlmModel(): string {
  return resolveIngestLlmModel(resolveIngestLlmProvider());
}

export function hasIngestLlmConfigured(): boolean {
  return hasIngestLlmCredentials(resolveIngestLlmProvider());
}
