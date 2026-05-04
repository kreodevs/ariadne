/**
 * @fileoverview Middleware RBAC para el proxy a Ingest.
 * Bloquea operaciones según el rol del usuario autenticado.
 */
import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedUser } from './otp.middleware';

/** Path pattern + method → blocked for non-admin. */
const BLOCKED_PATTERNS: Array<{ pattern: RegExp; methods: string[]; reason: string }> = [
  // Credenciales: crear, editar, eliminar
  { pattern: /^\/api\/credentials\/?\w*/ , methods: ['POST', 'PATCH', 'DELETE'], reason: 'Gestión de credenciales requiere admin' },
  // Repositorios: crear y eliminar
  { pattern: /^\/api\/repositories\/?$/, methods: ['POST'], reason: 'Crear repositorios requiere admin' },
  { pattern: /^\/api\/repositories\/[\w-]+\/?$/, methods: ['DELETE'], reason: 'Eliminar repositorios requiere admin' },
  // Proyectos: crear y eliminar
  { pattern: /^\/api\/projects\/?$/, methods: ['POST'], reason: 'Crear proyectos requiere admin' },
  { pattern: /^\/api\/projects\/[\w-]+\/?$/, methods: ['DELETE'], reason: 'Eliminar proyectos requiere admin' },
  // Proveedores: solo lectura (GET OK)
  { pattern: /^\/api\/providers/, methods: ['POST', 'PATCH', 'DELETE'], reason: 'Gestión de proveedores requiere admin' },
];

/**
 * Middleware que verifica que el usuario tenga rol admin para operaciones de escritura
 * sobre recursos sensibles (credenciales, proyectos, repositorios).
 */
export function createRbacMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as Request & { user?: AuthenticatedUser }).user;

    // Si no hay user (path exento), pasar
    if (!user) return next();

    // Admin siempre pasa
    if (user.role === 'admin') return next();

    // Developer: verificar cada patrón bloqueado
    const method = req.method.toUpperCase();
    const path = req.path || req.url?.split('?')[0] || '';

    for (const bp of BLOCKED_PATTERNS) {
      if (bp.methods.includes(method) && bp.pattern.test(path)) {
        res.status(403).json({
          statusCode: 403,
          message: bp.reason,
          error: 'Forbidden',
        });
        return;
      }
    }

    next();
  };
}
