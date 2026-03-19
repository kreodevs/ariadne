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
}
