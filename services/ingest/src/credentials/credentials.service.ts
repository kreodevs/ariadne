/**
 * @fileoverview CRUD de credenciales (Bitbucket/GitHub) con valores cifrados en BD. Resolución para sync y webhooks.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CredentialEntity } from './entities/credential.entity';
import { encrypt, decrypt } from './crypto.util';

const CACHE_TTL_MS = 60_000; // 1 min — evita N+1 en sync

/** Credenciales desencriptadas para Bitbucket (Bearer o Basic). */
export interface BitbucketAuth {
  type: 'bearer' | 'basic';
  token: string;
  username?: string;
}

/** DTO para crear una credencial (provider, kind, value cifrado, name, extra). */
export interface CredentialsCreateDto {
  provider: 'bitbucket' | 'github';
  kind: 'token' | 'app_password' | 'webhook_secret';
  value: string;
  name?: string | null;
  /** For app_password: { username } */
  extra?: Record<string, unknown> | null;
}

/**
 * Servicio de credenciales: create, findAll, findOne, update, delete; resolveForBitbucket/resolveForGitHub para uso en sync y APIs.
 */
@Injectable()
export class CredentialsService {
  private readonly bbCache = new Map<string, { data: BitbucketAuth; expiry: number }>();
  private readonly ghCache = new Map<string, { data: string; expiry: number }>();

  constructor(
    @InjectRepository(CredentialEntity)
    private readonly repo: Repository<CredentialEntity>,
  ) {}

  /**
   * Crea una credencial: cifra value y guarda en BD.
   * @param {CredentialsCreateDto} dto - provider, kind, value (plain), name, extra.
   * @returns {Promise<CredentialEntity>} Entidad guardada (sin exponer encryptedValue en respuestas públicas).
   */
  async create(dto: CredentialsCreateDto): Promise<CredentialEntity> {
    let enc: string;
    try {
      enc = encrypt(dto.value);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('CREDENTIALS_ENCRYPTION_KEY')) {
        throw new Error(
          'CREDENTIALS_ENCRYPTION_KEY no configurada. Ejecuta: openssl rand -base64 32',
        );
      }
      throw e;
    }
    const entity = this.repo.create({
      provider: dto.provider,
      kind: dto.kind,
      name: dto.name ?? null,
      encryptedValue: enc,
      extra: dto.extra ?? null,
    });
    return this.repo.save(entity);
  }

  /**
   * Lista credenciales (sin valor cifrado). Opcionalmente filtra por provider.
   * @param {string} [provider] - 'bitbucket' | 'github' para filtrar.
   * @returns {Promise<Omit<CredentialEntity, 'encryptedValue'>[]>}
   */
  async findAll(provider?: string): Promise<Omit<CredentialEntity, 'encryptedValue'>[]> {
    const qb = this.repo
      .createQueryBuilder('c')
      .select(['c.id', 'c.provider', 'c.kind', 'c.name', 'c.createdAt', 'c.updatedAt']);
    if (provider) qb.where('c.provider = :provider', { provider });
    qb.orderBy('c.createdAt', 'DESC');
    return qb.getMany();
  }

  /**
   * Obtiene una credencial por ID (sin encryptedValue). Lanza NotFoundException si no existe.
   * @param {string} id - UUID de la credencial.
   * @returns {Promise<Omit<CredentialEntity, 'encryptedValue'>>}
   */
  async findOne(id: string): Promise<Omit<CredentialEntity, 'encryptedValue'>> {
    const c = await this.repo.findOne({
      where: { id },
      select: ['id', 'provider', 'kind', 'name', 'extra', 'createdAt', 'updatedAt'],
    });
    if (!c) throw new NotFoundException(`Credential ${id} not found`);
    return c;
  }

  /**
   * Actualiza una credencial (value, name, extra). Invalida caché de resolución.
   * @param {string} id - UUID de la credencial.
   * @param {{ value?: string; name?: string | null; extra?: Record<string, unknown> | null }} dto - Campos a actualizar.
   * @returns {Promise<Omit<CredentialEntity, 'encryptedValue'>>}
   */
  async update(
    id: string,
    dto: { value?: string; name?: string | null; extra?: Record<string, unknown> | null },
  ): Promise<Omit<CredentialEntity, 'encryptedValue'>> {
    const existing = await this.repo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException(`Credential ${id} not found`);

    const updates: { name?: string | null; encryptedValue?: string; extra?: Record<string, unknown> | null } = {};
    if (dto.name !== undefined) updates.name = dto.name ?? null;
    if (dto.extra !== undefined) updates.extra = dto.extra ?? null;
    if (dto.value != null && dto.value.trim() !== '') {
      try {
        updates.encryptedValue = encrypt(dto.value.trim());
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('CREDENTIALS_ENCRYPTION_KEY')) {
          throw new Error('CREDENTIALS_ENCRYPTION_KEY no configurada.');
        }
        throw e;
      }
    }

    if (Object.keys(updates).length === 0) return this.findOne(id);
    await this.repo.update(id, updates as Record<string, unknown>);
    this.bbCache.delete(id);
    this.ghCache.delete(id);
    return this.findOne(id);
  }

  /**
   * Elimina una credencial por ID. Invalida caché. Lanza NotFoundException si no existe.
   * @param {string} id - UUID de la credencial.
   * @returns {Promise<void>}
   */
  async delete(id: string): Promise<void> {
    const r = await this.repo.delete(id);
    if (r.affected === 0) throw new NotFoundException(`Credential ${id} not found`);
    this.bbCache.delete(id);
    this.ghCache.delete(id);
  }

  /**
   * Resuelve credenciales para la API de Bitbucket. Devuelve null si no existe o falla el descifrado. Cache 1 min.
   * @param {string | null} credentialsRef - UUID de la credencial.
   * @returns {Promise<BitbucketAuth | null>} type, token, username (para basic) o null.
   */
  async resolveForBitbucket(credentialsRef: string | null): Promise<BitbucketAuth | null> {
    if (!credentialsRef) return null;
    const cached = this.bbCache.get(credentialsRef);
    if (cached && cached.expiry > Date.now()) return cached.data;
    try {
      const c = await this.repo.findOne({ where: { id: credentialsRef } });
      if (!c || c.provider !== 'bitbucket') return null;
      const value = decrypt(c.encryptedValue);
      let data: BitbucketAuth;
      if (c.kind === 'app_password') {
        const username = (c.extra?.username as string) ?? '';
        data = { type: 'basic', token: value, username };
      } else if (c.kind === 'token') {
        const email = (c.extra?.email as string) ?? '';
        data = { type: 'basic', token: value, username: email };
      } else {
        return null;
      }
      this.bbCache.set(credentialsRef, { data, expiry: Date.now() + CACHE_TTL_MS });
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Resuelve el token para la API de GitHub. Devuelve null si no existe o no es kind token. Cache 1 min.
   * @param {string | null} credentialsRef - UUID de la credencial.
   * @returns {Promise<string | null>} Token en claro o null.
   */
  async resolveForGitHub(credentialsRef: string | null): Promise<string | null> {
    if (!credentialsRef) return null;
    const cached = this.ghCache.get(credentialsRef);
    if (cached && cached.expiry > Date.now()) return cached.data;
    try {
      const c = await this.repo.findOne({ where: { id: credentialsRef } });
      if (!c || c.provider !== 'github' || c.kind !== 'token') return null;
      const data = decrypt(c.encryptedValue);
      this.ghCache.set(credentialsRef, { data, expiry: Date.now() + CACHE_TTL_MS });
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Get webhook secret for provider. Checks DB first (kind=webhook_secret), then env.
   */
  async getWebhookSecret(provider: 'bitbucket'): Promise<string | null> {
    const fromDb = await this.repo.findOne({
      where: { provider, kind: 'webhook_secret' },
    });
    if (fromDb) {
      try {
        return decrypt(fromDb.encryptedValue);
      } catch {
        return null;
      }
    }
    if (provider === 'bitbucket') {
      return process.env.BITBUCKET_WEBHOOK_SECRET ?? null;
    }
    return null;
  }
}
