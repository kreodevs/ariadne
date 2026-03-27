import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

/**
 * Protege rutas /internal/* — requiere header X-Internal-API-Key igual a INTERNAL_API_KEY.
 */
@Injectable()
export class InternalApiGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.INTERNAL_API_KEY?.trim();
    if (!expected) {
      throw new UnauthorizedException('INTERNAL_API_KEY no configurado en ingest');
    }
    const req = context.switchToHttp().getRequest<{ headers?: Record<string, string | string[] | undefined> }>();
    const raw = req.headers?.['x-internal-api-key'];
    const got = Array.isArray(raw) ? raw[0] : raw;
    if (got !== expected) {
      throw new UnauthorizedException('Clave interna inválida');
    }
    return true;
  }
}
