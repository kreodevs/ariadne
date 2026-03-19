/**
 * @fileoverview Cache Redis para impact, component, contract (TTL 300s).
 */
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

const TTL_IMPACT = 300;
const TTL_COMPONENT = 300;
const TTL_CONTRACT = 300;
const PREFIX = 'falkorspecs:';

/** Cache Redis con prefijo falkorspecs: para impact, component, contract. */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private redis: RedisClientType | null = null;

  private async getRedis(): Promise<RedisClientType | null> {
    const url = process.env.REDIS_URL;
    if (!url) return null;
    if (!this.redis) {
      this.redis = createClient({ url });
      this.redis.on('error', () => {});
      await this.redis.connect();
    }
    return this.redis;
  }

  /**
   * Obtiene un valor del cache por clave (deserializado JSON). Devuelve null si no hay Redis o no existe.
   * @param {string} key - Clave sin prefijo (se antepone falkorspecs:).
   * @returns {Promise<T | null>}
   */
  async get<T>(key: string): Promise<T | null> {
    const r = await this.getRedis();
    if (!r) return null;
    const raw = await r.get(PREFIX + key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  /**
   * Guarda un valor en cache con TTL. No hace nada si Redis no está configurado.
   * @param {string} key - Clave sin prefijo.
   * @param {unknown} value - Valor a serializar (JSON).
   * @param {number} [ttlSeconds] - TTL en segundos (default TTL.impact).
   * @returns {Promise<void>}
   */
  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const r = await this.getRedis();
    if (!r) return;
    await r.setEx(PREFIX + key, ttlSeconds ?? TTL_IMPACT, JSON.stringify(value));
  }

  /** Genera la clave de cache para impacto de un nodo. */
  impactKey(nodeId: string): string {
    return `impact:${nodeId}`;
  }

  /** Genera la clave de cache para dependencias de componente (nombre + profundidad). */
  componentKey(name: string, depth: number): string {
    return `component:${name}:${depth}`;
  }

  /** Genera la clave de cache para contrato (props) de un componente. */
  contractKey(componentName: string): string {
    return `contract:${componentName}`;
  }

  readonly TTL = { impact: TTL_IMPACT, component: TTL_COMPONENT, contract: TTL_CONTRACT };

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
  }
}
