/**
 * @fileoverview DTO para actualizar repositorio: campos opcionales defaultBranch, credentialsRef, webhookSecret.
 */
/** DTO para actualizar repositorio (defaultBranch?, credentialsRef?, webhookSecret?, projectId?). */
export class UpdateRepositoryDto {
  defaultBranch?: string;
  credentialsRef?: string | null;
  /** Secret del webhook Bitbucket. Vacío para borrar, undefined para no cambiar. */
  webhookSecret?: string | null;
  /** Mover repo a otro proyecto (multi-root). */
  projectId?: string | null;

  /** UUID embedding_spaces: búsqueda RAG y query embedding del MCP. Null explícito desvincula. */
  readEmbeddingSpaceId?: string | null;
  /** UUID embedding_spaces: destino de POST embed-index durante migración de modelo. */
  writeEmbeddingSpaceId?: string | null;
}
