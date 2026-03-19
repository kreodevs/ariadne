/**
 * @fileoverview DTO para actualizar credencial: value, name, extra opcionales (value no enviado = mantener actual).
 */
export class UpdateCredentialDto {
  /** Nuevo valor (token/password). Si no se envía, se mantiene el actual. */
  value?: string;
  name?: string | null;
  /** Para app_password: { username } */
  extra?: Record<string, unknown> | null;
}
