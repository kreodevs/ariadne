/**
 * Caché y persistencia de estado (constitution §2.B — Redis para estados de agentes y fragmentos).
 * Si REDIS_URL no está definido, no se usa Redis (caché en memoria opcional o sin caché).
 */

import { createClient, type RedisClientType } from "redis";

const TTL_IMPACT = 300; // 5 min
const TTL_COMPONENT = 300;
const TTL_CONTRACT = 300;
const PREFIX = "falkorspecs:";

let redis: RedisClientType | null = null;

export async function getRedis(): Promise<RedisClientType | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!redis) {
    redis = createClient({ url });
    redis.on("error", () => {});
    await redis.connect();
  }
  return redis;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const r = await getRedis();
  if (!r) return null;
  const raw = await r.get(PREFIX + key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  const r = await getRedis();
  if (!r) return;
  await r.setEx(PREFIX + key, ttlSeconds ?? TTL_IMPACT, JSON.stringify(value));
}

export function impactCacheKey(nodeId: string): string {
  return `impact:${nodeId}`;
}

export function componentCacheKey(name: string, depth: number): string {
  return `component:${name}:${depth}`;
}

export function contractCacheKey(componentName: string): string {
  return `contract:${componentName}`;
}

export const CACHE_TTL = { impact: TTL_IMPACT, component: TTL_COMPONENT, contract: TTL_CONTRACT };

export async function closeCache(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
