/**
 * @fileoverview Invoca Archify CLI (validate + deliver/render) para HTML showcase.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import {
  sanitizeArchifyArchitectureIr,
  sanitizeArchifySequenceIr,
  type ArchifyArchitectureIr,
  type ArchifyLifecycleIr,
  type ArchifySequenceIr,
  type ArchifyWorkflowIr,
} from 'ariadne-common';
import { getC4Settings } from './c4-settings.util';
import { runArchifyRender, runArchifyValidate } from './archify-cli.util';
import { fixArchifyArchitectureIr, fixArchifySequenceIr } from './c4-archify-ir-fix';

export interface ArchifyRenderResult {
  htmlPath: string;
  validated: boolean;
  archifyBin: string | null;
  stderr?: string;
}

const ARCHIFY_BIN_MISSING =
  'Archify CLI no encontrado. Rebuild del contenedor ingest (imagen con /opt/archify) o configura la ruta en Ajustes → Sistema → C4.';

function extractArchifyCliError(stdout: string, stderr: string, fallback: string): string {
  const raw = (stderr || stdout || '').trim();
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as {
      message?: string;
      error?: string;
      errors?: Array<{ message?: string; path?: string }>;
    };
    if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message.trim();
    if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error.trim();
    if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
      return parsed.errors
        .slice(0, 5)
        .map((e) => [e.path, e.message].filter(Boolean).join(': '))
        .join(' · ');
    }
  } catch {
    /* salida no JSON */
  }
  return raw.slice(0, 2000);
}

@Injectable()
export class C4ArchifyRenderer {
  private readonly logger = new Logger(C4ArchifyRenderer.name);

  resolveArchifyBin(): string | null {
    const configured = getC4Settings().archifyBin?.trim();
    const candidates = [
      configured,
      '/opt/archify/bin/archify.mjs',
      '/opt/archify/archify/bin/archify.mjs',
      join(homedir(), '.agents/skills/archify/bin/archify.mjs'),
      join(homedir(), '.cursor/skills/archify/bin/archify.mjs'),
    ].filter(Boolean) as string[];
    for (const c of candidates) {
      if (existsSync(c)) return resolve(c);
    }
    return null;
  }

  storageRoot(): string {
    return join(process.cwd(), 'data', 'c4-html');
  }

  async renderArchitecture(
    projectId: string,
    level: string,
    ir: ArchifyArchitectureIr,
  ): Promise<ArchifyRenderResult> {
    const root = this.storageRoot();
    await mkdir(root, { recursive: true });
    const base = join(root, projectId);
    await mkdir(base, { recursive: true });
    const jsonPath = join(base, `${level}.architecture.json`);
    const htmlPath = join(base, `${level}.architecture.html`);
    const sanitized = sanitizeArchifyArchitectureIr(fixArchifyArchitectureIr(ir));
    await writeFile(jsonPath, JSON.stringify(sanitized, null, 2), 'utf8');

    const bin = this.resolveArchifyBin();
    if (!bin) {
      this.logger.warn(
        'Archify bin not found; configura ruta en Ajustes → Sistema o instala en /opt/archify.',
      );
      return { htmlPath, validated: false, archifyBin: null, stderr: ARCHIFY_BIN_MISSING };
    }

    const validate = runArchifyValidate(bin, 'architecture', jsonPath);
    if (validate.status !== 0) {
      const err = extractArchifyCliError(
        validate.stdout ?? '',
        validate.stderr ?? '',
        'Archify validate (architecture) falló',
      );
      this.logger.warn(`Archify validate failed: ${err.slice(0, 500)}`);
      return { htmlPath, validated: false, archifyBin: bin, stderr: err };
    }

    await mkdir(dirname(htmlPath), { recursive: true });
    const rendered = runArchifyRender(bin, 'architecture', jsonPath, htmlPath);
    if (rendered.status !== 0) {
      const err = extractArchifyCliError(
        rendered.stdout ?? '',
        rendered.stderr ?? '',
        'Archify render (architecture) falló',
      );
      this.logger.warn(`Archify render failed: ${err.slice(0, 500)}`);
      return { htmlPath, validated: false, archifyBin: bin, stderr: err };
    }

    return { htmlPath, validated: true, archifyBin: bin };
  }

  async compareArchitecture(
    projectId: string,
    level: string,
    baseIr: ArchifyArchitectureIr,
    headIr: ArchifyArchitectureIr,
    fromSnapshotId: string,
    toSnapshotId: string,
  ): Promise<ArchifyRenderResult> {
    const root = this.storageRoot();
    const base = join(root, projectId);
    await mkdir(base, { recursive: true });
    const basePath = join(base, `diff-${fromSnapshotId.slice(0, 8)}.base.json`);
    const headPath = join(base, `diff-${toSnapshotId.slice(0, 8)}.head.json`);
    const htmlPath = join(base, `diff-${fromSnapshotId.slice(0, 8)}-${toSnapshotId.slice(0, 8)}.html`);

    await writeFile(
      basePath,
      JSON.stringify(sanitizeArchifyArchitectureIr(fixArchifyArchitectureIr(baseIr)), null, 2),
      'utf8',
    );
    await writeFile(
      headPath,
      JSON.stringify(sanitizeArchifyArchitectureIr(fixArchifyArchitectureIr(headIr)), null, 2),
      'utf8',
    );

    const bin = this.resolveArchifyBin();
    if (!bin) {
      return { htmlPath, validated: false, archifyBin: null, stderr: ARCHIFY_BIN_MISSING };
    }

    const cmp = spawnSync(
      process.execPath,
      [bin, 'compare', 'architecture', basePath, headPath, htmlPath, '--json'],
      { encoding: 'utf8', timeout: 120_000 },
    );
    if (cmp.status !== 0) {
      const err = extractArchifyCliError(
        cmp.stdout ?? '',
        cmp.stderr ?? '',
        'Archify compare (architecture) falló',
      );
      this.logger.warn(`Archify compare failed: ${err.slice(0, 500)}`);
      return { htmlPath, validated: false, archifyBin: bin, stderr: err };
    }

    return { htmlPath, validated: true, archifyBin: bin };
  }

  async renderSequence(
    projectId: string,
    ir: ArchifySequenceIr,
  ): Promise<ArchifyRenderResult> {
    const root = this.storageRoot();
    await mkdir(root, { recursive: true });
    const base = join(root, projectId);
    await mkdir(base, { recursive: true });
    const jsonPath = join(base, 'sequence.json');
    const htmlPath = join(base, 'sequence.html');
    const sanitized = sanitizeArchifySequenceIr(fixArchifySequenceIr(ir));
    await writeFile(jsonPath, JSON.stringify(sanitized, null, 2), 'utf8');

    const bin = this.resolveArchifyBin();
    if (!bin) {
      return { htmlPath, validated: false, archifyBin: null, stderr: ARCHIFY_BIN_MISSING };
    }

    const validate = runArchifyValidate(bin, 'sequence', jsonPath);
    if (validate.status !== 0) {
      const err = extractArchifyCliError(
        validate.stdout ?? '',
        validate.stderr ?? '',
        'Archify validate (sequence) falló',
      );
      this.logger.warn(`Archify sequence validate failed: ${err.slice(0, 500)}`);
      return { htmlPath, validated: false, archifyBin: bin, stderr: err };
    }

    const rendered = runArchifyRender(bin, 'sequence', jsonPath, htmlPath);
    if (rendered.status !== 0) {
      const err = extractArchifyCliError(
        rendered.stdout ?? '',
        rendered.stderr ?? '',
        'Archify render (sequence) falló',
      );
      this.logger.warn(`Archify sequence render failed: ${err.slice(0, 500)}`);
      return { htmlPath, validated: false, archifyBin: bin, stderr: err };
    }

    return { htmlPath, validated: true, archifyBin: bin };
  }

  async renderWorkflow(
    projectId: string,
    ir: ArchifyWorkflowIr,
    targetId = 'sync-pipeline',
  ): Promise<ArchifyRenderResult> {
    const root = this.storageRoot();
    await mkdir(root, { recursive: true });
    const base = join(root, projectId);
    await mkdir(base, { recursive: true });
    const safeTarget = targetId.replace(/[^a-z0-9:_-]/gi, '_');
    const jsonPath = join(base, `workflow-${safeTarget}.json`);
    const htmlPath = join(base, `workflow-${safeTarget}.html`);
    await writeFile(jsonPath, JSON.stringify(ir, null, 2), 'utf8');

    const bin = this.resolveArchifyBin();
    if (!bin) {
      return { htmlPath, validated: false, archifyBin: null, stderr: ARCHIFY_BIN_MISSING };
    }

    const validate = runArchifyValidate(bin, 'workflow', jsonPath);
    if (validate.status !== 0) {
      const err = extractArchifyCliError(
        validate.stdout ?? '',
        validate.stderr ?? '',
        'Archify validate (workflow) falló',
      );
      return { htmlPath, validated: false, archifyBin: bin, stderr: err };
    }

    const rendered = runArchifyRender(bin, 'workflow', jsonPath, htmlPath);
    if (rendered.status !== 0) {
      const err = extractArchifyCliError(
        rendered.stdout ?? '',
        rendered.stderr ?? '',
        'Archify render (workflow) falló',
      );
      return { htmlPath, validated: false, archifyBin: bin, stderr: err };
    }

    return { htmlPath, validated: true, archifyBin: bin };
  }

  async renderLifecycle(
    projectId: string,
    ir: ArchifyLifecycleIr,
    target = 'sync-job',
  ): Promise<ArchifyRenderResult> {
    const root = this.storageRoot();
    await mkdir(root, { recursive: true });
    const base = join(root, projectId);
    await mkdir(base, { recursive: true });
    const safeTarget = target.replace(/[^a-z0-9_-]/gi, '_');
    const jsonPath = join(base, `lifecycle-${safeTarget}.json`);
    const htmlPath = join(base, `lifecycle-${safeTarget}.html`);
    await writeFile(jsonPath, JSON.stringify(ir, null, 2), 'utf8');

    const bin = this.resolveArchifyBin();
    if (!bin) {
      return { htmlPath, validated: false, archifyBin: null, stderr: ARCHIFY_BIN_MISSING };
    }

    const validate = runArchifyValidate(bin, 'lifecycle', jsonPath);
    if (validate.status !== 0) {
      const err = extractArchifyCliError(
        validate.stdout ?? '',
        validate.stderr ?? '',
        'Archify validate (lifecycle) falló',
      );
      return { htmlPath, validated: false, archifyBin: bin, stderr: err };
    }

    const rendered = runArchifyRender(bin, 'lifecycle', jsonPath, htmlPath);
    if (rendered.status !== 0) {
      const err = extractArchifyCliError(
        rendered.stdout ?? '',
        rendered.stderr ?? '',
        'Archify render (lifecycle) falló',
      );
      return { htmlPath, validated: false, archifyBin: bin, stderr: err };
    }

    return { htmlPath, validated: true, archifyBin: bin };
  }
}
