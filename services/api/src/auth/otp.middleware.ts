/**
 * @fileoverview Middleware OTP: valida JWT emitido por verify. Protege /api/* excepto health, openapi y auth.
 */
import { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service';

const SKIP_PATHS = [
  '/api/health',
  '/api/openapi.json',
  '/api/auth/otp/request',
  '/api/auth/otp/verify',
];

function getToken(req: Request): string | null {
  const auth = req.headers.authorization;
  return auth?.startsWith('Bearer ') ? auth.slice(7) : null;
}

/** Middleware: valida JWT OTP, asigna req.user y llama next(); si no hay token o es inválido responde 401. */
export function createOtpAuthMiddleware(authService: AuthService) {
  return (req: Request, res: Response, next: NextFunction) => {
    const path = req.path || req.url?.split('?')[0] || '';
    if (SKIP_PATHS.some((p) => path === p)) return next();

    const token = getToken(req);
    if (!token) {
      res.status(401).json({ statusCode: 401, message: 'Token no proporcionado' });
      return;
    }

    const user = authService.verifyToken(token);
    if (!user) {
      res.status(401).json({ statusCode: 401, message: 'Token inválido o expirado' });
      return;
    }

    (req as Request & { user?: { sub: string; email?: string } }).user = user;
    next();
  };
}
