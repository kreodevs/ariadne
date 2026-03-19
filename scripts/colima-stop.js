#!/usr/bin/env node
/**
 * Para el stack Docker (docker compose down) y luego Colima.
 * Solo para uso en local.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const COMPOSE_DIR = path.resolve(__dirname, '..');

function run(cmd, args = [], options = {}) {
  return spawnSync(cmd, args, {
    encoding: 'utf8',
    shell: false,
    cwd: options.cwd || process.cwd(),
    stdio: 'inherit',
    ...options,
  });
}

console.log('[colima-stop] Bajando stack (docker-compose down)...');
const down = run('sh', ['-c', 'docker-compose -f docker-compose.yml -f docker-compose.dev.yml down'], {
  cwd: COMPOSE_DIR,
});
if (down.status !== 0) {
  console.error('[colima-stop] Error al bajar el stack.');
  process.exit(1);
}

console.log('[colima-stop] Parando Colima...');
const stop = run('colima', ['stop']);
if (stop.status !== 0) {
  console.error('[colima-stop] Error al parar Colima:', stop.stderr || stop.error);
  process.exit(1);
}

console.log('[colima-stop] Listo: stack y Colima detenidos.');
process.exit(0);
