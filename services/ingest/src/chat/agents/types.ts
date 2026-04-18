/**
 * Tipos para la arquitectura de agentes.
 * @see Architecting Agentic Systems — Supervisor/Coordinator + Worker Agents
 * @see docs/notebooklm/mcp_server_specs.md, docs/notebooklm/CHAT_Y_ANALISIS.md
 */

/** Tipo de respuesta esperada: código/estructura vs lógica en lenguaje natural. */
export type AgentRoute =
  | 'code_analysis'      // Paths, funciones, Cypher, métricas, diagnóstico técnico
  | 'knowledge_extraction'  // Extraer conocimiento del código y presentar en lenguaje natural
  | 'explorer';          // Exploración abierta con ReAct (Cypher, semantic_search, get_file_content)

/** Contexto que el coordinador pasa a los agentes especialistas. */
export interface AgentContext {
  repositoryId: string;
  projectId: string;
  message: string;
  historyContent?: string;
}

/** Respuesta de un agente especialista. */
export interface AgentResponse {
  answer: string;
  cypher?: string;
  result?: unknown[];
}
