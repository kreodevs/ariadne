import { Redis } from "ioredis";

/**
 * Caché opcional para herramientas MCP (component graph, legacy impact, sync status).
 * No confundir con la caché de `POST .../analyze`, que vive en **ingest** (LRU + Redis opcional).
 *
 * - Sin `MCP_REDIS_URL` ni `REDIS_URL`, o con `MCP_REDIS_DISABLED=1`: caché **en memoria** (por proceso).
 * - Con URL: **Redis** (compartible entre procesos / réplicas del MCP).
 */
export type McpToolCache = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
};

class MemoryMcpCache implements McpToolCache {
  private readonly store = new Map<string, { v: string; exp: number }>();

  async get(key: string): Promise<string | null> {
    const e = this.store.get(key);
    if (!e) return null;
    if (Date.now() > e.exp) {
      this.store.delete(key);
      return null;
    }
    return e.v;
  }

  async set(key: string, value: string, ttlSec: number): Promise<void> {
    this.store.set(key, { v: value, exp: Date.now() + Math.max(1, ttlSec) * 1000 });
  }
}

class RedisMcpCache implements McpToolCache {
  constructor(private readonly redis: Redis) {}

  async get(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch (e) {
      console.error("[MCP Redis Cache] get:", e);
      return null;
    }
  }

  async set(key: string, value: string, ttlSec: number): Promise<void> {
    try {
      await this.redis.set(key, value, "EX", Math.max(1, ttlSec));
    } catch (e) {
      console.error("[MCP Redis Cache] set:", e);
    }
  }
}

let cacheImpl: McpToolCache | null = null;
let redisInstance: Redis | null = null;

function redisUrlFromEnv(): string | null {
  const off = process.env.MCP_REDIS_DISABLED?.trim().toLowerCase();
  if (off === "1" || off === "true" || off === "yes") return null;
  const url = process.env.MCP_REDIS_URL?.trim() || process.env.REDIS_URL?.trim();
  return url || null;
}

export function getMcpToolCache(): McpToolCache {
  if (!cacheImpl) {
    const url = redisUrlFromEnv();
    if (url) {
      redisInstance = new Redis(url, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      });
      redisInstance.on("error", (err: Error) => {
        console.error("MCP Redis:", err.message);
      });
      cacheImpl = new RedisMcpCache(redisInstance);
    } else {
      cacheImpl = new MemoryMcpCache();
    }
  }
  return cacheImpl;
}

export async function closeRedis(): Promise<void> {
  if (redisInstance) {
    await redisInstance.quit().catch(() => undefined);
    redisInstance = null;
  }
  cacheImpl = null;
}
