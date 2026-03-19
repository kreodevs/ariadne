/**
 * @fileoverview Validador JWT usando JWKS del SSO. Incluye cache de llaves públicas y validación M2M.
 */
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

const JWKS_URI =
  process.env.SSO_JWKS_URI || 'https://apisso.grupowib.com.mx/api/v1/auth/jwks';
const APP_ID = process.env.SSO_APPLICATION_ID || '';
const SSO_BASE = JWKS_URI.replace(/\/auth\/jwks\/?$/, '');

/**
 * Indica si la autenticación SSO está configurada (JWKS_URI y APPLICATION_ID definidos).
 * @returns {boolean} True si SSO está habilitado.
 */
export const isSSOEnabled = (): boolean =>
  !!JWKS_URI && !!APP_ID;

const VALIDATE_URL = `${SSO_BASE}/auth/validate`;

/**
 * Indica si el token tiene formato M2M (prefijo m2m_).
 * @param {string} token - Token a comprobar.
 * @returns {boolean} True si el token es M2M.
 */
export const isM2MToken = (token: string): boolean =>
  typeof token === 'string' && token.startsWith('m2m_');

interface M2MValidateResponse {
  valid?: boolean;
  type?: string;
  application?: Record<string, unknown>;
  data?: { valid?: boolean; type?: string; application?: Record<string, unknown> };
}

/**
 * Valida un token M2M llamando al endpoint de validación del SSO. Los tokens M2M no llevan roles.
 * @param {string} token - Token M2M (prefijo m2m_).
 * @returns {Promise<boolean>} True si el SSO responde que el token es válido y de tipo m2m.
 */
export async function validateM2MToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(VALIDATE_URL, {
      headers: {
        'X-M2M-Token': token,
        ...(APP_ID ? { 'X-Application-Id': APP_ID } : {}),
      },
    });
    const json = (await res.json()) as M2MValidateResponse;
    const data = json?.data ?? json;
    return data?.valid === true && data?.type === 'm2m';
  } catch {
    return false;
  }
}

const client = jwksClient({
  jwksUri: JWKS_URI,
  cache: true,
  cacheMaxAge: 600_000, // 10 min
  rateLimit: true,
  jwksRequestsPerMinute: 5,
});

function getKey(
  header: jwt.JwtHeader,
  callback: (err: Error | null, key?: jwt.Secret) => void,
) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key?.getPublicKey());
  });
}

/**
 * Payload decodificado de un JWT emitido por el SSO.
 * @typedef {Object} JwtPayload
 * @property {string} sub - Subject (identificador del usuario).
 * @property {string} [email] - Email del usuario.
 * @property {string} [username] - Nombre de usuario.
 * @property {boolean} [isSystemAdmin] - Si es administrador del sistema.
 * @property {Array<{applicationId: string; applicationName: string; roles: string[]; permissions: string[]}>} [applications] - Aplicaciones y roles.
 * @property {number} [iat] - Issued at (timestamp).
 * @property {number} [exp] - Expiration (timestamp).
 */
export interface JwtPayload {
  sub: string;
  email?: string;
  username?: string;
  isSystemAdmin?: boolean;
  applications?: Array<{
    applicationId: string;
    applicationName: string;
    roles: string[];
    permissions: string[];
    externalId?: string | null;
    externalMetadata?: Record<string, unknown>;
  }>;
  iat?: number;
  exp?: number;
}

/**
 * Verifica la firma del JWT con las llaves JWKS y decodifica el payload. Lanza si el token es inválido o está expirado.
 * @param {string} token - JWT en formato Bearer (solo el valor del token).
 * @returns {Promise<JwtPayload>} Payload decodificado.
 */
export async function verifyJwt(token: string): Promise<JwtPayload> {
  return new Promise((resolve, reject) => {
    jwt.verify(token, getKey, { algorithms: ['RS256'] }, (err, decoded) => {
      if (err) reject(err);
      else resolve(decoded as JwtPayload);
    });
  });
}

/**
 * Devuelve el ID de aplicación configurado (SSO_APPLICATION_ID).
 * @returns {string} ID de la aplicación en el SSO.
 */
export const getApplicationId = (): string => APP_ID;

/**
 * Valida que el payload del JWT incluya acceso a la aplicación configurada (APP_ID). Los system admins siempre tienen acceso.
 * @param {JwtPayload} payload - Payload decodificado del JWT.
 * @returns {boolean} True si el usuario tiene acceso a la aplicación.
 */
export function hasAppAccess(payload: JwtPayload): boolean {
  if (payload.isSystemAdmin) return true;
  if (!payload.applications?.length || !APP_ID) return false;
  return payload.applications.some((a) => a.applicationId === APP_ID);
}

/**
 * Valida que el usuario tenga el rol "admin" para la aplicación configurada. Los system admins siempre son considerados admin.
 * @param {JwtPayload} payload - Payload decodificado del JWT.
 * @returns {boolean} True si el usuario tiene rol admin.
 */
export function hasAdminRole(payload: JwtPayload): boolean {
  if (payload.isSystemAdmin) return true;
  const app = payload.applications?.find((a) => a.applicationId === APP_ID);
  return Boolean(app?.roles?.includes('admin'));
}
