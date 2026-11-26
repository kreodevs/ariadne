import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POST_COMMIT_BLOCK } from "./git-hook.ts";

type Hit = { url: string; auth?: string };

async function runHook(opts: { env?: Record<string, string>; serverUrl?: string; status?: number }) {
  const hits: Hit[] = [];
  const srv = createServer((req, res) => {
    hits.push({ url: req.url ?? "", auth: req.headers.authorization });
    req.resume();
    res.statusCode = opts.status ?? 200;
    res.end("{}");
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as { port: number }).port;

  const repo = mkdtempSync(join(tmpdir(), "hook-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "t@t.t");
  git("config", "user.name", "t");
  mkdirSync(join(repo, ".ariadne"));
  const serverUrl = opts.serverUrl ?? `http://127.0.0.1:${port}`;
  writeFileSync(join(repo, ".ariadne", "config.json"), JSON.stringify({ serverUrl }));
  writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
  git("add", "a.ts");
  git("commit", "-q", "-m", "x");

  const out = await new Promise<string>((resolve) => {
    const script = POST_COMMIT_BLOCK.split("\n").filter((l) => !l.startsWith("# ")).join("\n");
    const p = spawn("bash", ["-c", script], {
      cwd: repo,
      env: { PATH: process.env.PATH ?? "", HOME: repo, ...Object.fromEntries(Object.entries(opts.env ?? {}).map(([k, v]) => [k, v.replace("{PORT}", String(port))])) },
    });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", () => resolve(err));
  });
  srv.close();
  return { hits, out };
}

test("URL local: envía directo al ingest sin Authorization", async () => {
  const { hits, out } = await runHook({ env: { ARIADNE_TOKEN: "ari_x" } });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].url, "/repositories/local-sync/file");
  assert.equal(hits[0].auth, undefined);
  assert.match(out, /1 archivo\(s\) sincronizados/);
});

test("INGEST_URL explícito manda sobre config.json", async () => {
  const { hits } = await runHook({ serverUrl: "http://127.0.0.1:1", env: { INGEST_URL: "http://127.0.0.1:{PORT}/" } });
  assert.equal(hits.length, 1);
});

test("URL remota sin token: no llama y explica", async () => {
  const { out } = await runHook({ serverUrl: "https://relicai.example.com/mcp" });
  assert.match(out, /exige token.*ARIADNE_TOKEN/);
});

test("405 corta y avisa que la URL no enruta al ingest", async () => {
  const { hits, out } = await runHook({ status: 405 });
  assert.equal(hits.length, 1);
  assert.match(out, /respondio 405.*no enruta al ingest/);
});
