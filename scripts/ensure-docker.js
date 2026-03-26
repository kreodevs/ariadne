#!/usr/bin/env node
/**
 * Asegura que Colima (runtime de contenedores) y el stack Docker de Ariadne estén en ejecución.
 * Solo para uso en local. Requiere Colima y Docker (CLI) instalados.
 *
 * Para saltar este paso (p. ej. si Colima falla o ya tienes los servicios en otro sitio):
 *   SKIP_ENSURE_DOCKER=1 pnpm run dev
 */

if (process.env.SKIP_ENSURE_DOCKER === '1') {
  console.log(
    '[ensure-docker] SKIP_ENSURE_DOCKER=1 → omitiendo. Asegúrate de tener falkordb, postgres, redis y los servicios que necesites.',
  );
  process.exit(0);
}

const path = require('path');
const { spawnSync } = require('child_process');

const COLIMA_START_ARGS = '--cpu 2 --memory 4';
const COMPOSE_DIR = path.resolve(__dirname, '..');

function run(cmd, args = [], options = {}) {
  return spawnSync(cmd, args, {
    encoding: 'utf8',
    shell: false,
    cwd: options.cwd || process.cwd(),
    ...options,
  });
}

function runShell(cmd, options = {}) {
  return spawnSync(cmd, [], {
    encoding: 'utf8',
    shell: true,
    ...options,
  });
}

function ensureColima() {
  const status = runShell('colima status');
  if (status.status === 0) {
    console.log('[ensure-docker] Colima ya está en ejecución.');
    return 0;
  }
  console.log('[ensure-docker] Iniciando Colima (--cpu 2 --memory 4)...');
  const start = runShell(`colima start ${COLIMA_START_ARGS}`);
  if (start.status !== 0) {
    console.error('[ensure-docker] Error al iniciar Colima:', start.stderr || start.error);
    console.error(
      '[ensure-docker] Si no usas Colima, levanta los servicios por tu cuenta y ejecuta: SKIP_ENSURE_DOCKER=1 <comando>',
    );
    return 1;
  }
  console.log('[ensure-docker] Colima iniciado.');
  return 0;
}

const INFRA_SERVICES = 'falkordb postgres redis';
const BACKEND_SERVICES = 'falkordb postgres redis ingest api orchestrator';

function ensureCompose(backendOnly = false, infraOnly = false) {
  const services = infraOnly ? INFRA_SERVICES : backendOnly ? BACKEND_SERVICES : '';
  const composeFiles = '-f docker-compose.yml -f docker-compose.dev.yml';
  const cmd = services
    ? `docker-compose ${composeFiles} up -d --build ${services}`
    : `docker-compose ${composeFiles} up -d --build`;
  console.log('[ensure-docker] Levantando stack (docker compose up -d)...');
  const up = run('sh', ['-c', cmd], { cwd: COMPOSE_DIR });
  if (up.status !== 0) {
    console.error('[ensure-docker] Error al levantar el stack:', up.stderr || up.error);
    return 1;
  }
  const msg = infraOnly
    ? '[ensure-docker] Infra en ejecución (falkordb, postgres, redis). Ejecuta dev:api, dev:ingest, dev:orchestrator en terminales separadas.'
    : backendOnly
      ? '[ensure-docker] Backend en ejecución (falkordb, postgres, redis, api, ingest, orchestrator).'
      : '[ensure-docker] Stack completo en ejecución.';
  console.log(msg);
  return 0;
}

function main() {
  const colimaOk = ensureColima();
  if (colimaOk !== 0) return colimaOk;
  return ensureCompose(
    process.env.BACKEND_ONLY === '1',
    process.env.INFRA_ONLY === '1'
  );
}

const code = main();
process.exit(code);
