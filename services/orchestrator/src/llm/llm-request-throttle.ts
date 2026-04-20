/**
 * Throttling proactivo para todas las llamadas LLM (concurrencia + espaciado entre inicios).
 * Control por env; desactivable para tests/local.
 */

function throttleDisabled(): boolean {
  const v = process.env.LLM_THROTTLE_DISABLED?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function maxConcurrent(): number {
  const raw = process.env.LLM_MAX_CONCURRENT?.trim();
  if (!raw) return 2;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 2;
  if (n === 0) return Number.POSITIVE_INFINITY;
  return n;
}

function minIntervalMs(): number {
  const raw = process.env.LLM_MIN_REQUEST_INTERVAL_MS?.trim();
  if (!raw) return 250;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 250;
  return n;
}

let inFlight = 0;
const concurrencyWaiters: Array<() => void> = [];

function acquireSlot(max: number): Promise<void> {
  if (!Number.isFinite(max)) return Promise.resolve();
  if (inFlight < max) {
    inFlight++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    concurrencyWaiters.push(() => {
      inFlight++;
      resolve();
    });
  });
}

function releaseSlot(): void {
  inFlight--;
  const wake = concurrencyWaiters.shift();
  if (wake) wake();
}

/** Serializa el cálculo de espaciado para evitar carreras en `nextEarliestStart`. */
let pacingChain = Promise.resolve();
let nextEarliestStart = 0;

async function paceNextStart(): Promise<void> {
  const gap = minIntervalMs();
  if (gap <= 0) return;
  const p = pacingChain.then(async () => {
    const now = Date.now();
    const wait = Math.max(0, nextEarliestStart - now);
    nextEarliestStart = Math.max(now, nextEarliestStart) + gap;
    if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
  });
  pacingChain = p.catch(() => {});
  await p;
}

/** Ejecuta `fn` tras aplicar límite de concurrencia y espaciado entre inicios. */
export async function withLlmRequestThrottle<T>(fn: () => Promise<T>): Promise<T> {
  if (throttleDisabled()) return fn();

  const max = maxConcurrent();
  await acquireSlot(max);
  try {
    await paceNextStart();
    return await fn();
  } finally {
    releaseSlot();
  }
}
