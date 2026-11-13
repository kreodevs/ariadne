/**
 * @fileoverview Sincroniza la configuración de FalkorDB (sharding) del MCP con la del ingest.
 *
 * El ingest y el API aplican `setFalkorRuntimeOverrides` con los valores guardados desde la UI
 * (`system_settings`). El MCP solo leía `process.env`, así que con el sharding por proyecto activo
 * en la UI escribía el ingest en `AriadneSpecs:<projectId>` y el MCP consultaba el grafo
 * `AriadneSpecs` (vacío). Aquí se consulta `GET {INGEST_URL}/internal/system-settings` (red interna)
 * y se aplican los mismos overrides, con caché corta como en `services/api`.
 *
 * Si el ingest no responde se conservan los overrides ya aplicados (o el comportamiento por env
 * si nunca hubo respuesta): nunca lanza.
 */

import { createLogger, setFalkorRuntimeOverrides, type FalkorRuntimeOverrides } from "ariadne-common";

const log = createLogger("mcp-ariadne:falkor-settings");

const CACHE_TTL_MS = 15_000;
const FETCH_TIMEOUT_MS = 3_000;
/** Tras un fallo se reintenta pronto, sin bloquear cada tool con un timeout. */
const RETRY_AFTER_FAILURE_MS = 5_000;

let loadedAt = 0;
let inFlight: Promise<void> | null = null;
let warnedUnreachable = false;

/**
 * Extrae los overrides de Falkor de la respuesta de `/internal/system-settings`.
 * Solo toma campos con el tipo esperado; devuelve `null` si no hay ninguno válido.
 */
export function parseFalkorOverrides(json: unknown): FalkorRuntimeOverrides | null {
  const falkor = (json as { falkor?: Record<string, unknown> } | null | undefined)?.falkor;
  if (!falkor || typeof falkor !== "object") return null;
  const out: FalkorRuntimeOverrides = {};
  if (typeof falkor.shardByProject === "boolean") out.shardByProject = falkor.shardByProject;
  if (typeof falkor.shardByDomain === "boolean") out.shardByDomain = falkor.shardByDomain;
  if (typeof falkor.autoDomainOverflow === "boolean") out.autoDomainOverflow = falkor.autoDomainOverflow;
  if (typeof falkor.graphNodeSoftLimit === "number" && Number.isFinite(falkor.graphNodeSoftLimit)) {
    out.graphNodeSoftLimit = falkor.graphNodeSoftLimit;
  }
  if (typeof falkor.debugCypher === "boolean") out.debugCypher = falkor.debugCypher;
  return Object.keys(out).length > 0 ? out : null;
}

async function load(): Promise<void> {
  const base = (process.env.INGEST_URL ?? process.env.ARIADNESPEC_INGEST_URL ?? "").replace(/\/$/, "");
  if (!base) return;
  try {
    const res = await fetch(`${base}/internal/system-settings`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const overrides = parseFalkorOverrides(await res.json());
    if (overrides) setFalkorRuntimeOverrides(overrides);
    loadedAt = Date.now();
    warnedUnreachable = false;
  } catch (err) {
    loadedAt = Date.now() - (CACHE_TTL_MS - RETRY_AFTER_FAILURE_MS);
    if (!warnedUnreachable) {
      warnedUnreachable = true;
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "No se pudo leer system-settings del ingest; se mantiene la configuración de Falkor actual (env)",
      );
    }
  }
}

/**
 * Refresca los overrides de Falkor desde el ingest (máx. una vez cada 15 s; las llamadas
 * concurrentes comparten la misma petición). Llamar al inicio de cada tool.
 */
export function refreshFalkorRuntimeOverrides(): Promise<void> {
  if (Date.now() - loadedAt < CACHE_TTL_MS) return Promise.resolve();
  if (!inFlight) {
    inFlight = load().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/** Solo para tests: reinicia la caché y el aviso. */
export function __resetFalkorRuntimeSettingsForTests(): void {
  loadedAt = 0;
  inFlight = null;
  warnedUnreachable = false;
}
