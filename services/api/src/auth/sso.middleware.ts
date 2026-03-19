/**
 * Middleware SSO: valida JWT (usuarios) o M2M (machine-to-machine).
 * JWT: JWKS + rol admin. M2M: validate remoto, sin roles.
 * Protege /api/* excepto health y openapi.
 */
import { Request, Response, NextFunction } from 'express';
import {
  isSSOEnabled,
  isM2MToken,
  validateM2MToken,
  verifyJwt,
  hasAppAccess,
  hasAdminRole,
  getApplicationId,
} from './jwks-validator';
import type { JwtPayload } from './jwks-validator';

export interface SsoUser {
  id: string;
  email?: string;
  username?: string;
  isSystemAdmin?: boolean;
  type?: 'user' | 'm2m';
  application?: {
    applicationId: string;
    applicationName: string;
    roles: string[];
    permissions: string[];
    externalId?: string | null;
    externalMetadata?: Record<string, unknown>;
  };
}

declare global {
  namespace Express {
    interface Request {
      ssoUser?: SsoUser;
    }
  }
}

const SKIP_PATHS = ['/api/health', '/api/openapi.json'];

/** Extrae token de X-M2M-Token o Authorization: Bearer. */
function getToken(req: Request): string | null {
  const m2m = req.headers['x-m2m-token'];
  if (typeof m2m === 'string' && m2m.trim()) return m2m.trim();
  const auth = req.headers.authorization;
  return auth?.startsWith('Bearer ') ? auth.slice(7) : null;
}

type AuthResult = { ok: true; user: SsoUser } | { ok: false; status: number; message: string };

/** Comprueba acceso a la app y rol admin. Desacoplado de authenticate para pruebas y reutilización. */
export function checkUserAccess(payload: JwtPayload): boolean {
  return hasAppAccess(payload) && hasAdminRole(payload);
}

/** Construye SsoUser desde el payload JWT. Desacoplado para pruebas y reutilización. */
export function buildUserFromPayload(payload: JwtPayload): SsoUser {
  const app = payload.applications?.find((a) => a.applicationId === getApplicationId());
  return {
    id: payload.sub,
    email: payload.email,
    username: payload.username,
    isSystemAdmin: payload.isSystemAdmin,
    type: 'user',
    application: app,
  };
}

/**
 * Valida el token y devuelve el usuario SSO o un error. Usa checkUserAccess y buildUserFromPayload.
 */
async function authenticate(token: string): Promise<AuthResult> {
  if (isM2MToken(token)) {
    const valid = await validateM2MToken(token).catch(() => false);
    if (!valid) return { ok: false, status: 401, message: 'Token M2M inválido' };
    return { ok: true, user: { id: 'm2m', type: 'm2m' } };
  }
  const payload = await verifyJwt(token);
  if (!checkUserAccess(payload)) {
    return { ok: false, status: 403, message: 'Se requiere rol admin para esta aplicación' };
  }
  return { ok: true, user: buildUserFromPayload(payload) };
}

/** Middleware Express: valida token (JWT o M2M), asigna req.ssoUser y llama next(); si no hay token o es inválido responde 401/403. */
export function ssoAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!isSSOEnabled()) return next();

  const path = req.path || req.url?.split('?')[0] || '';
  if (SKIP_PATHS.some((p) => path === p)) return next();

  const token = getToken(req);
  if (!token) {
    res.status(401).json({ statusCode: 401, message: 'Token no proporcionado' });
    return;
  }

  authenticate(token)
    .then((result) => {
      if (result.ok) {
        req.ssoUser = result.user;
        next();
      } else {
        res.status(result.status).json({ statusCode: result.status, message: result.message });
      }
    })
    .catch((err) => {
      const status = err?.name === 'TokenExpiredError' ? 401 : 401;
      res.status(status).json({ statusCode: status, message: err?.message || 'Token inválido' });
    });
}
