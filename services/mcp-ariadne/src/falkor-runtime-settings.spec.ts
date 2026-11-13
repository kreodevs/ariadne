/**
 * @fileoverview Tests de la sincronización de configuración Falkor (sharding) del MCP con el ingest.
 * Usa node:test (nativo) — sin dependencias externas.
 *
 * Ejecutar (desde services/mcp-ariadne, con ariadne-common compilado):
 *   node --experimental-strip-types --no-warnings --test src/falkor-runtime-settings.spec.ts
 */
import { afterEach, beforeEach, describe, it } from "node:test";
import * as assert from "node:assert";
import { isProjectShardingEnabled, setFalkorRuntimeOverrides } from "ariadne-common";
import {
  __resetFalkorRuntimeSettingsForTests,
  parseFalkorOverrides,
  refreshFalkorRuntimeOverrides,
} from "./falkor-runtime-settings.ts";

const realFetch = globalThis.fetch;
const realIngest = process.env.INGEST_URL;
const realShard = process.env.FALKOR_SHARD_BY_PROJECT;

function mockFetch(impl: (url: string) => Promise<Response>): { calls: string[] } {
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    return impl(url);
  }) as typeof fetch;
  return { calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  __resetFalkorRuntimeSettingsForTests();
  setFalkorRuntimeOverrides(null);
  process.env.INGEST_URL = "http://ingest.test:3002/";
  delete process.env.FALKOR_SHARD_BY_PROJECT;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setFalkorRuntimeOverrides(null);
  if (realIngest === undefined) delete process.env.INGEST_URL;
  else process.env.INGEST_URL = realIngest;
  if (realShard === undefined) delete process.env.FALKOR_SHARD_BY_PROJECT;
  else process.env.FALKOR_SHARD_BY_PROJECT = realShard;
});

describe("parseFalkorOverrides", () => {
  it("toma los campos válidos de falkor", () => {
    assert.deepStrictEqual(
      parseFalkorOverrides({
        falkor: {
          shardByProject: true,
          shardByDomain: false,
          autoDomainOverflow: true,
          graphNodeSoftLimit: 50000,
          debugCypher: false,
        },
      }),
      {
        shardByProject: true,
        shardByDomain: false,
        autoDomainOverflow: true,
        graphNodeSoftLimit: 50000,
        debugCypher: false,
      },
    );
  });

  it("ignora campos con tipo inválido y devuelve null si no queda ninguno", () => {
    assert.deepStrictEqual(parseFalkorOverrides({ falkor: { shardByProject: "true", graphNodeSoftLimit: "x" } }), null);
    assert.deepStrictEqual(parseFalkorOverrides({ falkor: { shardByProject: true, debugCypher: 1 } }), {
      shardByProject: true,
    });
  });

  it("devuelve null con respuestas sin falkor", () => {
    assert.strictEqual(parseFalkorOverrides(null), null);
    assert.strictEqual(parseFalkorOverrides({}), null);
    assert.strictEqual(parseFalkorOverrides({ falkor: null }), null);
  });
});

describe("refreshFalkorRuntimeOverrides", () => {
  it("aplica el sharding de la UI aunque el env diga lo contrario (caso del bug)", async () => {
    process.env.FALKOR_SHARD_BY_PROJECT = "false";
    mockFetch(async () => jsonResponse({ falkor: { shardByProject: true } }));
    assert.strictEqual(isProjectShardingEnabled(), false);
    await refreshFalkorRuntimeOverrides();
    assert.strictEqual(isProjectShardingEnabled(), true);
  });

  it("consulta /internal/system-settings del ingest sin barra final duplicada", async () => {
    const { calls } = mockFetch(async () => jsonResponse({ falkor: { shardByProject: true } }));
    await refreshFalkorRuntimeOverrides();
    assert.deepStrictEqual(calls, ["http://ingest.test:3002/internal/system-settings"]);
  });

  it("usa caché: dos llamadas seguidas hacen una sola petición", async () => {
    const { calls } = mockFetch(async () => jsonResponse({ falkor: { shardByProject: true } }));
    await refreshFalkorRuntimeOverrides();
    await refreshFalkorRuntimeOverrides();
    assert.strictEqual(calls.length, 1);
  });

  it("las llamadas concurrentes comparten una sola petición", async () => {
    const { calls } = mockFetch(async () => jsonResponse({ falkor: { shardByProject: true } }));
    await Promise.all([refreshFalkorRuntimeOverrides(), refreshFalkorRuntimeOverrides(), refreshFalkorRuntimeOverrides()]);
    assert.strictEqual(calls.length, 1);
  });

  it("si el ingest falla no lanza, conserva el env y no reintenta en cada tool", async () => {
    process.env.FALKOR_SHARD_BY_PROJECT = "true";
    const { calls } = mockFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    await refreshFalkorRuntimeOverrides();
    await refreshFalkorRuntimeOverrides();
    assert.strictEqual(isProjectShardingEnabled(), true, "mantiene el valor por env");
    assert.strictEqual(calls.length, 1, "no reintenta dentro de la ventana de reintento");
  });

  it("con HTTP 500 no lanza ni altera la configuración previa", async () => {
    setFalkorRuntimeOverrides({ shardByProject: true });
    mockFetch(async () => jsonResponse({ error: "boom" }, 500));
    await refreshFalkorRuntimeOverrides();
    assert.strictEqual(isProjectShardingEnabled(), true);
  });

  it("sin INGEST_URL no hace ninguna petición", async () => {
    delete process.env.INGEST_URL;
    delete process.env.ARIADNESPEC_INGEST_URL;
    const { calls } = mockFetch(async () => jsonResponse({}));
    await refreshFalkorRuntimeOverrides();
    assert.strictEqual(calls.length, 0);
  });
});
