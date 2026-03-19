/**
 * @fileoverview DTO para crear credencial: provider (bitbucket|github), kind (token|app_password|webhook_secret), value; opcional name, extra.
 */
/** DTO para crear credencial (provider, kind, value, name?, extra?). */
export class CreateCredentialDto {
  provider!: 'bitbucket' | 'github';
  kind!: 'token' | 'app_password' | 'webhook_secret';
  value!: string;
  name?: string | null;
  extra?: Record<string, unknown> | null;
}
