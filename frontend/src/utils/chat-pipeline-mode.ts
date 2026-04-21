import type { ChatPipelineMode, IngestChatRequestBody } from '../types';

/** Mapea el modo UI a flags del ingest / MCP `ask_codebase`. */
export function ingestOptionsFromChatPipelineMode(
  mode: ChatPipelineMode,
): Pick<IngestChatRequestBody, 'responseMode' | 'deterministicRetriever'> {
  if (mode === 'evidence_first') return { responseMode: 'evidence_first' };
  if (mode === 'raw_evidence_fast') return { responseMode: 'raw_evidence', deterministicRetriever: true };
  return {};
}
