/**
 * @fileoverview Estado de sesión en Redis (refactor:state:*). TTL 3600s.
 */
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

const KEY_PREFIX = 'refactor:state:';
const CHAT_PREFIX = 'codebase:chat:';
const DEFAULT_TTL_SEC = 3600;

/** Servicio de estado de sesión en Redis (get, set con TTL). */
@Injectable()
export class RedisStateService implements OnModuleDestroy {
  private client: RedisClientType | null = null;

  private async getClient(): Promise<RedisClientType> {
    if (this.client?.isOpen) return this.client;
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.client = createClient({ url });
    this.client.on('error', (err) => console.error('RedisStateService', err));
    await this.client.connect();
    return this.client;
  }

  /**
   * Obtiene el estado de sesión por ID (deserializado JSON). Null si no existe o error.
   * @param {string} sessionId - ID de sesión (sin prefijo refactor:state:).
   * @returns {Promise<T | null>}
   */
  async get<T>(sessionId: string): Promise<T | null> {
    try {
      const client = await this.getClient();
      const raw = await client.get(KEY_PREFIX + sessionId);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  /**
   * Guarda el estado de sesión con TTL. Clave: refactor:state:{sessionId}.
   * @param {string} sessionId - ID de sesión.
   * @param {unknown} state - Objeto a serializar (JSON).
   * @param {number} [ttlSec] - TTL en segundos (default 3600).
   * @returns {Promise<void>}
   */
  async set(
    sessionId: string,
    state: unknown,
    ttlSec: number = DEFAULT_TTL_SEC
  ): Promise<void> {
    try {
      const client = await this.getClient();
      const key = KEY_PREFIX + sessionId;
      await client.setEx(key, ttlSec, JSON.stringify(state));
    } catch (err) {
      console.error('RedisStateService.set', err);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client?.isOpen) await this.client.quit();
  }

  /**
   * Snapshot post-retrieve para ask_codebase (observabilidad / futura reanudación).
   * Clave: codebase:chat:{threadId}
   */
  async setChatThread(threadId: string, state: unknown, ttlSec: number = DEFAULT_TTL_SEC): Promise<void> {
    try {
      const client = await this.getClient();
      await client.setEx(CHAT_PREFIX + threadId, ttlSec, JSON.stringify(state));
    } catch (err) {
      console.error('RedisStateService.setChatThread', err);
    }
  }

  async getChatThread<T>(threadId: string): Promise<T | null> {
    try {
      const client = await this.getClient();
      const raw = await client.get(CHAT_PREFIX + threadId);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }
}
