/**
 * @fileoverview Módulo compartido de cola BullMQ. Ambos SyncModule y RepositoriesModule lo importan para @InjectQueue(SYNC_QUEUE) sin circularidad.
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SYNC_QUEUE } from './sync.processor';

/** Obtiene host/port/password de Redis desde REDIS_URL. */
function getRedisConnection() {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6380';
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: parseInt(u.port || '6379', 10),
      password: u.password || undefined,
    };
  } catch {
    return { host: 'localhost', port: 6380 };
  }
}

@Module({
  imports: [
    BullModule.forRoot({
      connection: getRedisConnection(),
    }),
    BullModule.registerQueue({
      name: SYNC_QUEUE,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 100 },
      },
    }),
  ],
  exports: [BullModule],
})
export class SyncQueueModule {}
