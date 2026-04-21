/**
 * Throttling proactivo para todas las llamadas LLM (concurrencia + espaciado entre inicios).
 * Opcional: ventana 60s de TPM estimado (Kimi / cuotas por tokens-minuto).
 * Control por env; desactivable para tests/local.
 */

type TpmEntry = { t: number; tokens: number };
const tpmWindow: TpmEntry[] = [];
let tpmMutex = Promise.resolve();

function throttleDisabled(): boolean {
  const v = process.env.LLM_THROTTLE_DISABLED?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function maxConcurrent(): number {
  const raw = process.env.LLM_MAX_CONCURRENT?.trim();
  if (!raw) return 1;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 1;
  if (n === 0) return Number.POSITIVE_INFINITY;
  return n;
}

function minIntervalMs(): number {
  const raw = process.env.LLM_MIN_REQUEST_INTERVAL_MS?.trim();
  if (!raw) return 2000;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 2000;
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

function pruneTpmWindow(now: number): void {
  const cutoff = now - 60_000;
  while (tpmWindow.length > 0 && tpmWindow[0].t < cutoff) tpmWindow.shift();
}

function sumTpmWindow(now: number): number {
  pruneTpmWindow(now);
  return tpmWindow.reduce((s, e) => s + e.tokens, 0);
}

/** Reserva coste TPM estimado en ventana 60s antes de disparar el fetch. */
async function acquireTpmReservation(budget: number, rawNeed: number): Promise<void> {
  if (budget <= 0 || rawNeed <= 0) return;
  const need = Math.min(Math.ceil(rawNeed), budget);

  const run = async (): Promise<void> => {
    for (;;) {
      const now = Date.now();
      const used = sumTpmWindow(now);
      if (used + need <= budget) {
        tpmWindow.push({ t: now, tokens: need });
        return;
      }
      const oldest = tpmWindow[0];
      const waitMs = oldest ? Math.min(15_000, Math.max(50, oldest.t + 60_001 - now)) : 200;
      await new Promise<void>((r) => setTimeout(r, waitMs));
    }
  };

  const prev = tpmMutex;
  let release!: () => void;
  tpmMutex = new Promise<void>((res) => {
    release = res;
  });
  await prev;
  try {
    await run();
  } finally {
    release();
  }
}

export type LlmThrottleOptions = {
  /** TPM máximo estimado por proceso en ventana 60s (p. ej. Moonshot proyecto / réplicas). */
  tpmBudget?: number;
  /** Coste estimado de esta petición; si falta con tpmBudget>0, no se aplica ventana TPM. */
  estimatedTpmCost?: number;
};

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
export async function withLlmRequestThrottle<T>(
  fn: () => Promise<T>,
  opts?: LlmThrottleOptions,
): Promise<T> {
  if (throttleDisabled()) return fn();

  const budget = opts?.tpmBudget ?? 0;
  const est = opts?.estimatedTpmCost ?? 0;
  if (budget > 0 && est > 0) {
    await acquireTpmReservation(budget, est);
  }

  const max = maxConcurrent();
  await acquireSlot(max);
  try {
    await paceNextStart();
    return await fn();
  } finally {
    releaseSlot();
  }
}
