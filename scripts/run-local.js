#!/usr/bin/env node
/**
 * Ejecuta un servicio backend en local con env vars para conectar a infra en Docker.
 * Requiere: dev:infra (o dev:back) ejecutado antes.
 * Uso: node scripts/run-local.js <api|ingest|orchestrator> [npm script]
 */
const path = require("path");
const fs = require("fs");
const { spawn, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const LOCAL_ENV = {
  PGHOST: "localhost",
  PGPORT: "5432",
  PGUSER: "falkorspecs",
  PGPASSWORD: "falkorspecs",
  PGDATABASE: "falkorspecs",
  FALKORDB_HOST: "localhost",
  FALKORDB_PORT: "6379",
  REDIS_URL: "redis://localhost:6380",
  INGEST_URL: "http://localhost:3002",
  CARTOGRAPHER_URL: "http://localhost:4000",
  FALKORSPEC_API_URL: "http://localhost:3000/api",
};

const SERVICES = {
  api: { dir: "services/api", script: "dev" },
  ingest: { dir: "services/ingest", script: "dev" },
  orchestrator: { dir: "services/orchestrator", script: "dev" },
};

const name = process.argv[2];
const scriptOverride = process.argv[3];
if (!name || !SERVICES[name]) {
  console.error(
    "Uso: node scripts/run-local.js <api|ingest|orchestrator> [script]",
  );
  console.error("  api        -> nest start --watch");
  console.error("  ingest     -> nest start");
  console.error("  orchestrator -> nest start");
  process.exit(1);
}

try {
  require.resolve("dotenv");
  require("dotenv").config({ path: path.join(ROOT, ".env") });
} catch {
  // dotenv opcional
}

const svc = SERVICES[name];
const script = scriptOverride || svc.script;
const cwd = path.join(ROOT, svc.dir);
const env = { ...process.env, ...LOCAL_ENV };

const nodeModules = path.join(cwd, "node_modules");
if (!fs.existsSync(nodeModules)) {
  console.log(`[run-local] Instalando dependencias en ${svc.dir}...`);
  const install = spawnSync("pnpm", ["install"], {
    cwd,
    env,
    stdio: "inherit",
  });
  if (install.status !== 0) process.exit(install.status ?? 1);
}

const child = spawn("pnpm", ["run", script], {
  cwd,
  env,
  stdio: "inherit",
  shell: true,
});
child.on("exit", (code) => process.exit(code ?? 0));
