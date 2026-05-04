/**
 * @fileoverview Controlador de usuarios: CRUD admin, perfil propio, tokens MCP.
 * Endpoints internos (prefijo /internal/users) protegidos por internal-api.guard.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import type { UserRole } from './entities/user.entity';
import type { Request } from 'express';

@Controller()
export class UsersController {
  constructor(private readonly service: UsersService) {}

  // ─── Internos (protegidos por INTERNAL_API_KEY) ───

  /**
   * POST /internal/users/resolve
   * Busca o crea usuario por email. Usado por API (AuthService) tras verify OTP.
   * Body: { email, createIfMissing?: boolean }
   */
  @Post('internal/users/resolve')
  async resolve(
    @Body() body: { email?: string; createIfMissing?: boolean },
  ) {
    if (!body?.email || typeof body.email !== 'string') {
      return { error: 'email requerido' };
    }
    return this.service.resolveByEmail(body.email, body.createIfMissing ?? false);
  }

  /**
   * POST /internal/users/validate-mcp-token
   * Valida un token MCP. Usado por mcp-ariadne para auth por usuario.
   * Body: { token: string }
   */
  @Post('internal/users/validate-mcp-token')
  async validateMcpToken(@Body() body: { token?: string }) {
    if (!body?.token) {
      return { valid: false };
    }
    const user = await this.service.validateMcpToken(body.token);
    if (!user) return { valid: false };
    return { valid: true, user };
  }

  /**
   * POST /internal/users/update-role
   * Actualiza el rol de un usuario (usado por SSO desde API).
   * Body: { id, role }
   */
  @Post('internal/users/update-role')
  async internalUpdateRole(@Body() body: { id?: string; role?: string }) {
    if (!body?.id || !body?.role) {
      return { error: 'id y role requeridos' };
    }
    return this.service.updateRole(body.id, body.role as 'admin' | 'developer');
  }

  // ─── Públicos (protegidos por JWT + roles desde API) ───

  /** GET /users — Listar usuarios (admin-only, validado en API proxy) */
  @Get('users')
  findAll() {
    return this.service.findAll();
  }

  /** GET /users/me — Perfil propio (identificado por header X-User-Id o email) */
  @Get('users/me')
  async me(@Req() req: Request) {
    const userId = req.headers['x-user-id'] as string;
    const email = req.headers['x-user-email'] as string;
    if (userId) return this.service.findOne(userId);
    if (email) {
      const user = await this.service.resolveByEmail(email, false);
      return this.service.findOne(user.id);
    }
    return { error: 'No se pudo identificar al usuario' };
  }

  /** GET /users/:id — Detalle usuario */
  @Get('users/:id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  /** PATCH /users/:id/role — Cambiar rol */
  @Patch('users/:id/role')
  updateRole(@Param('id') id: string, @Body() body: { role?: UserRole }) {
    if (!body?.role) throw new Error('role requerido');
    return this.service.updateRole(id, body.role);
  }

  /** POST /users/:id/regenerate-mcp-token — Regenerar token MCP (admin o propio) */
  @Post('users/:id/regenerate-mcp-token')
  regenerateMcpToken(@Param('id') id: string) {
    return this.service.regenerateMcpToken(id);
  }

  /** POST /users — Crear usuario manualmente */
  @Post('users')
  create(@Body() body: { email?: string; name?: string; role?: UserRole }) {
    if (!body?.email) throw new Error('email requerido');
    return this.service.create(body.email, body.name, body.role);
  }

  /** DELETE /users/:id — Eliminar usuario */
  @Delete('users/:id')
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
