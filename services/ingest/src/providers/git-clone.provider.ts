/**
 * Shallow clone provider: git clone --depth 1 para evitar historial completo.
 * Alternativa a la API cuando hay rate limits o se prefiere un solo fetch.
 */

import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { shouldSkipWalkDirectory, shouldSyncIndexPath } from './sync-path-filter';

function walkDir(dir: string, base = ''): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!shouldSkipWalkDirectory(e.name)) {
        files.push(...walkDir(path.join(dir, e.name), rel));
      }
    } else if (e.isFile() && shouldSyncIndexPath(rel)) {
      files.push(rel);
    }
  }
  return files;
}

function buildCloneUrl(
  baseUrl: string,
  token: string | null,
  tokenUsername = 'x-token-auth',
): string {
  if (!token) return baseUrl;
  try {
    const u = new URL(baseUrl);
    u.username = tokenUsername;
    u.password = token;
    return u.toString();
  } catch {
    return baseUrl;
  }
}

export interface GitCloneOptions {
  /** Base clone URL sin credenciales, ej. https://bitbucket.org/workspace/repo.git */
  cloneUrl: string;
  ref?: string;
  token?: string | null;
  /** Usuario para token en URL: Bitbucket usa x-bitbucket-api-token-auth, GitHub x-access-token */
  tokenUsername?: string;
}

/**
 * Shallow clone del repo y retorna paths + acceso a contenido.
 * El directorio se limpia al finalizar (caller debe llamar cleanup).
 */
export async function runShallowClone(
  opts: GitCloneOptions,
): Promise<{
  workDir: string;
  paths: string[];
  getContent: (relPath: string) => Promise<string | null>;
  getLatestCommitSha: () => Promise<string | null>;
  cleanup: () => void;
}> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariadne-ingest-'));
  const url = buildCloneUrl(
    opts.cloneUrl,
    opts.token ?? null,
    opts.tokenUsername ?? 'x-token-auth',
  );
  const ref = opts.ref ?? 'HEAD';

  try {
    const r = spawnSync('git', ['clone', '--depth', '1', '--branch', ref, url, '.'], {
      cwd: workDir,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    if (r.status !== 0) {
      const msg = [r.stderr, r.stdout, `git clone failed (exit ${r.status})`].filter(Boolean).join(' ');
      throw new Error(msg.trim() || 'git clone failed (is git installed?)');
    }
  } catch (err) {
    fs.rmSync(workDir, { recursive: true, force: true });
    throw err;
  }

  const paths = walkDir(workDir);

  return {
    workDir,
    paths,
    getContent: async (relPath: string) => {
      const fullPath = path.join(workDir, relPath);
      try {
        return fs.readFileSync(fullPath, 'utf-8');
      } catch {
        return null;
      }
    },
    getLatestCommitSha: async () => {
      try {
        const r = spawnSync('git', ['rev-parse', 'HEAD'], {
          cwd: workDir,
          encoding: 'utf-8',
        });
        return r.status === 0 ? (r.stdout?.trim() ?? null) : null;
      } catch {
        return null;
      }
    },
    cleanup: () => {
      fs.rmSync(workDir, { recursive: true, force: true });
    },
  };
}
