/**
 * Caché opcional de resultados `analyze` en Redis (compartida entre réplicas).
 * URL: `ANALYZE_CACHE_REDIS_URL` o fallback `REDIS_URL`. Prefijo default: `ariadne:analyze:v2:`.
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class AnalyzeDistributedCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(AnalyzeDistributedCacheService.name);
  private readonly redis: Redis | null;
  private readonly prefix: string;
  private readonly enabled: boolean;

  constructor() {
    const off = process.env.ANALYZE_CACHE_REDIS_DISABLED?.trim().toLowerCase();
    this.prefix = (process.env.ANALYZE_CACHE_REDIS_PREFIX?.trim() || 'ariadne:analyze:v2:') as string;
    if (off === '1' || off === 'true') {
      this.enabled = false;
      this.redis = null;
      return;
    }
    const url = process.env.ANALYZE_CACHE_REDIS_URL?.trim() || process.env.REDIS_URL?.trim();
    if (!url) {
      this.enabled = false;
      this.redis = null;
      return;
    }
    try {
      this.redis = new Redis(url, { maxRetriesPerRequest: 2 });
      this.enabled = true;
      this.redis.on('error', (e) => this.logger.warn(`Redis analyze cache: ${e.message}`));
    } catch (e) {
      this.logger.warn(`Redis analyze cache deshabilitado: ${e instanceof Error ? e.message : String(e)}`);
      this.redis = null;
      this.enabled = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit().catch(() => undefined);
    }
  }

  isEnabled(): boolean {
    return this.enabled && this.redis != null;
  }

  async getJson(key: string): Promise<string | null> {
    if (!this.redis) return null;
    try {
      return await this.redis.get(this.prefix + key);
    } catch (e) {
      this.logger.debug(`Redis get falló: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  async setJson(key: string, json: string, ttlSec: number): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(this.prefix + key, json, 'EX', Math.max(30, ttlSec));
    } catch (e) {
      this.logger.debug(`Redis set falló: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
