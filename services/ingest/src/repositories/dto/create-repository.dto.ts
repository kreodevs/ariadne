/**
 * @fileoverview DTO para crear repositorio: provider, projectKey, repoSlug; opcional defaultBranch, credentialsRef, webhookSecret.
 */
/** DTO para crear repositorio (provider, projectKey, repoSlug; opcional projectId para multi-root). */
export class CreateRepositoryDto {
  provider!: string;
  projectKey!: string;
  repoSlug!: string;
  defaultBranch?: string;
  credentialsRef?: string | null;
  /** Secret del webhook Bitbucket (opcional). */
  webhookSecret?: string | null;
  /** ID del proyecto al que pertenece (multi-root). Si no se envía, se crea un proyecto 1:1 para este repo. */
  projectId?: string | null;
}
