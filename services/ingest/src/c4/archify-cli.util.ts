import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

const RENDER_TIMEOUT_MS = 120_000;

export function archifyCliOutput(result: Pick<SpawnSyncReturns<string>, 'stdout' | 'stderr'>): string {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

export function isUnknownArchifyCommand(
  result: Pick<SpawnSyncReturns<string>, 'stdout' | 'stderr' | 'status'>,
  command: string,
): boolean {
  if (result.status === 0) return false;
  const output = archifyCliOutput(result);
  return new RegExp(`Unknown command ["']?${command}["']?`, 'i').test(output);
}

type ArchifyDiagramType = 'architecture' | 'sequence' | 'workflow' | 'lifecycle';

function spawnArchify(bin: string, args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: 'utf8',
    timeout: RENDER_TIMEOUT_MS,
  });
}

/** validate showcase; reintenta sin --quality en CLIs antiguas (v2.9). */
export function runArchifyValidate(
  bin: string,
  type: ArchifyDiagramType,
  jsonPath: string,
): SpawnSyncReturns<string> {
  const attempts = [
    ['validate', type, jsonPath, '--quality', 'showcase', '--json'],
    ['validate', type, jsonPath, '--json'],
  ];
  let last = spawnArchify(bin, attempts[0]);
  for (const args of attempts) {
    const result = spawnArchify(bin, args);
    if (result.status === 0) return result;
    last = result;
  }
  return last;
}

/**
 * Genera HTML tras validate. Prueba `deliver` (Archify ≥2.10) y cae a `render` (v2.9 / legacy).
 */
export function runArchifyRender(
  bin: string,
  type: ArchifyDiagramType,
  jsonPath: string,
  htmlPath: string,
): SpawnSyncReturns<string> {
  const deliver = spawnArchify(bin, [
    'deliver',
    type,
    jsonPath,
    htmlPath,
    '--quality',
    'showcase',
    '--json',
  ]);
  if (deliver.status === 0) return deliver;
  if (!isUnknownArchifyCommand(deliver, 'deliver')) return deliver;

  const renderShowcase = spawnArchify(bin, ['render', type, jsonPath, htmlPath, '--quality', 'showcase']);
  if (renderShowcase.status === 0) return renderShowcase;

  const renderPlain = spawnArchify(bin, ['render', type, jsonPath, htmlPath]);
  return renderPlain;
}
