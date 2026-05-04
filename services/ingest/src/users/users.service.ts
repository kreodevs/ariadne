/**
 * @fileoverview Servicio de usuarios: CRUD, resolución SSO/OTP, tokens MCP.
 */
import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { UserEntity, type UserRole } from './entities/user.entity';

const TOKEN_BYTE_LENGTH = 32; // 256 bits → 64 hex chars
const TOKEN_PREFIX_LENGTH = 8;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly repo: Repository<UserEntity>,
  ) {}

  /** Busca un usuario por email. Si no existe y createIfMissing=true, lo crea con rol 'developer'. */
  async resolveByEmail(
    email: string,
    createIfMissing = false,
  ): Promise<{ id: string; email: string; role: UserRole; name: string | null; isNew: boolean }> {
    const normalized = email.trim().toLowerCase();
    let user = await this.repo.findOne({ where: { email: normalized } });
    let isNew = false;

    if (!user) {
      if (!createIfMissing) {
        throw new NotFoundException(`Usuario ${normalized} no encontrado`);
      }
      user = this.repo.create({
        email: normalized,
        name: normalized.split('@')[0] ?? null,
        role: 'developer',
      });
      user = await this.repo.save(user);
      isNew = true;
    }

    return { id: user.id, email: user.email, role: user.role, name: user.name, isNew };
  }

  /** Listar todos los usuarios (sin datos sensibles). */
  async findAll(): Promise<
    Array<{
      id: string;
      email: string;
      name: string | null;
      role: UserRole;
      hasMcpToken: boolean;
      createdAt: Date;
      updatedAt: Date;
    }>
  > {
    const users = await this.repo.find({ order: { createdAt: 'ASC' } });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      hasMcpToken: !!u.mcpTokenHash,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }));
  }

  /** Obtener un usuario por ID. */
  async findOne(id: string): Promise<{
    id: string;
    email: string;
    name: string | null;
    role: UserRole;
    mcpTokenPrefix: string | null;
    hasMcpToken: boolean;
    createdAt: Date;
    updatedAt: Date;
  }> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`Usuario ${id} no encontrado`);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      mcpTokenPrefix: user.mcpTokenPrefix,
      hasMcpToken: !!user.mcpTokenHash,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  /** Cambiar rol de un usuario. Solo admin puede hacerlo. */
  async updateRole(id: string, role: UserRole): Promise<{ id: string; email: string; role: UserRole }> {
    if (role !== 'admin' && role !== 'developer') {
      throw new BadRequestException('Rol inválido. Use admin o developer.');
    }
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`Usuario ${id} no encontrado`);
    user.role = role;
    await this.repo.save(user);
    return { id: user.id, email: user.email, role: user.role };
  }

  /** Genera un nuevo token MCP para el usuario. Retorna el token en texto plano (única vez). */
  async regenerateMcpToken(userId: string): Promise<{ token: string; prefix: string }> {
    const user = await this.repo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException(`Usuario ${userId} no encontrado`);

    const token = `ari_${crypto.randomBytes(TOKEN_BYTE_LENGTH).toString('hex')}`;
    const prefix = token.slice(0, TOKEN_PREFIX_LENGTH);
    const hash = await bcrypt.hash(token, 10);

    user.mcpTokenHash = hash;
    user.mcpTokenPrefix = prefix;
    await this.repo.save(user);

    return { token, prefix };
  }

  /** Valida un token MCP contra el hash almacenado. Devuelve el usuario o null. */
  async validateMcpToken(
    token: string,
  ): Promise<{ id: string; email: string; role: UserRole; name: string | null } | null> {
    if (!token.trim()) return null;

    const users = await this.repo.find({ select: ['id', 'email', 'role', 'name', 'mcpTokenHash'] });
    for (const user of users) {
      if (!user.mcpTokenHash) continue;
      const valid = await bcrypt.compare(token, user.mcpTokenHash);
      if (valid) {
        return { id: user.id, email: user.email, role: user.role, name: user.name };
      }
    }
    return null;
  }

  /** Crear un usuario manualmente (admin). Devuelve error si ya existe. */
  async create(email: string, name?: string, role?: UserRole): Promise<{ id: string; email: string; role: UserRole }> {
    const normalized = email.trim().toLowerCase();
    const existing = await this.repo.findOne({ where: { email: normalized } });
    if (existing) throw new ConflictException(`El email ${normalized} ya está registrado`);

    const user = this.repo.create({
      email: normalized,
      name: (name?.trim() || normalized.split('@')[0]) ?? null,
      role: role ?? 'developer',
    });
    const saved = await this.repo.save(user);
    return { id: saved.id, email: saved.email, role: saved.role };
  }

  /** Eliminar un usuario. */
  async delete(id: string): Promise<void> {
    const r = await this.repo.delete(id);
    if (r.affected === 0) throw new NotFoundException(`Usuario ${id} no encontrado`);
  }
}
