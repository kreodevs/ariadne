/**
 * @fileoverview Análisis de cambios en jobs incrementales: impacto, seguridad, resumen.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FalkorDB } from 'falkordb';
import { SyncJob } from './entities/sync-job.entity';
import { RepositoryEntity } from './entities/repository.entity';
import { FileContentService } from './file-content.service';
import { getFalkorConfig } from '../pipeline/falkor';
import { GRAPH_NAME } from '../pipeline/falkor';

export interface JobAnalysisResult {
  jobId: string;
  repositoryId: string;
  type: string;
  paths: string[];
  summary: {
    riskScore: number;
    totalPaths: number;
    securityFindings: number;
    dependentModules: number;
  };
  impacto: {
    dependents: Array<{ path: string; dependents: string[] }>;
  };
  seguridad: {
    findings: Array<{ path: string; severity: 'critica' | 'alta' | 'media'; pattern: string; line?: number }>;
  };
  resumenEjecutivo: string;
}

const SECRET_PATTERNS: Array<{ pattern: RegExp; severity: 'critica' | 'alta' | 'media' }> = [
  { pattern: /(?:api[_-]?key|apikey|api_key)\s*=\s*['"`][^'"`]+['"`]/gi, severity: 'critica' },
  { pattern: /(?:password|passwd|pwd)\s*[=:]\s*['"`][^'"`]+['"`]/gi, severity: 'critica' },
  { pattern: /(?:secret|token)\s*[=:]\s*['"`][^'"`]{8,}['"`]/gi, severity: 'alta' },
  { pattern: /Bearer\s+[A-Za-z0-9_-]{20,}/g, severity: 'alta' },
  { pattern: /(?:private[_-]?key|privatekey).*['"`]/gi, severity: 'critica' },
  { pattern: /\.env|process\.env\.\w+/g, severity: 'media' },
];

@Injectable()
export class JobAnalysisService {
  constructor(
    @InjectRepository(SyncJob)
    private readonly jobsRepo: Repository<SyncJob>,
    @InjectRepository(RepositoryEntity)
    private readonly repoRepo: Repository<RepositoryEntity>,
    private readonly fileContent: FileContentService,
  ) {}

  /**
   * Analiza un job incremental: paths cambiados, impacto en el grafo, detección de secretos, resumen ejecutivo.
   * @param {string} repositoryId - ID del repositorio.
   * @param {string} jobId - ID del sync job (debe ser type incremental con payload.paths).
   * @returns {Promise<JobAnalysisResult>} riskScore, impacto.dependents, seguridad.findings, resumenEjecutivo.
   */
  async analyzeJob(repositoryId: string, jobId: string): Promise<JobAnalysisResult> {
    const repo = await this.repoRepo.findOne({ where: { id: repositoryId } });
    if (!repo) throw new NotFoundException(`Repository ${repositoryId} not found`);

    const job = await this.jobsRepo.findOne({
      where: { id: jobId, repositoryId },
      select: ['id', 'type', 'status', 'payload'],
    });
    if (!job) throw new NotFoundException(`Job ${jobId} not found`);
    if (job.type !== 'incremental')
      throw new BadRequestException('Solo jobs incrementales tienen análisis de cambios');

    const payload = (job.payload ?? {}) as Record<string, unknown>;
    const paths = (payload.paths as string[]) ?? [];
    if (paths.length === 0)
      throw new BadRequestException('Job sin paths en payload (sync vacío o antiguo)');

    const prefix = `${repo.repoSlug}/`;
    const prefixedPaths = paths.map((p) => (p.startsWith(prefix) ? p : prefix + p));

    const [impacto, seguridad] = await Promise.all([
      this.runImpactAnalysis(repositoryId, prefixedPaths),
      this.runSecurityScan(repositoryId, paths, repo.repoSlug),
    ]);

    const riskScore = this.computeRiskScore(seguridad, impacto, paths);
    const resumenEjecutivo = this.buildResumen(
      riskScore,
      seguridad.findings.length,
      impacto.dependents.reduce((acc, d) => acc + d.dependents.length, 0),
    );

    return {
      jobId: job.id,
      repositoryId,
      type: job.type,
      paths,
      summary: {
        riskScore,
        totalPaths: paths.length,
        securityFindings: seguridad.findings.length,
        dependentModules: impacto.dependents.reduce((acc, d) => acc + d.dependents.length, 0),
      },
      impacto,
      seguridad,
      resumenEjecutivo,
    };
  }

  private async runImpactAnalysis(
    projectId: string,
    paths: string[],
  ): Promise<{ dependents: Array<{ path: string; dependents: string[] }> }> {
    const config = getFalkorConfig();
    const client = await FalkorDB.connect({
      socket: { host: config.host, port: config.port },
    });

    try {
      const graph = client.selectGraph(GRAPH_NAME);
      const dependents: Array<{ path: string; dependents: string[] }> = [];

      for (const filePath of paths.slice(0, 30)) {
        const res = (await graph.query(
          `MATCH (a:File)-[:IMPORTS]->(b:File {path: $path, projectId: $projectId})
           RETURN a.path as importer`,
          { params: { path: filePath, projectId } },
        )) as { data?: Array<Record<string, string>> };
        const rows = (res?.data ?? []) as Array<{ importer?: string }>;
        const importers = rows.map((r) => r.importer).filter(Boolean) as string[];

        const res2 = (await graph.query(
          `MATCH (parent:File)-[:CONTAINS]->(comp:Component)-[:RENDERS]->(child:Component)
           MATCH (target:File)-[:CONTAINS]->(child)
           WHERE target.path = $path AND target.projectId = $projectId
           RETURN parent.path as referrer`,
          { params: { path: filePath, projectId } },
        )) as { data?: Array<Record<string, string>> };
        const rows2 = (res2?.data ?? []) as Array<{ referrer?: string }>;
        const renderers = rows2.map((r) => r.referrer).filter(Boolean) as string[];

        const all = [...new Set([...importers, ...renderers])];
        dependents.push({
          path: filePath.replace(/^[^/]+\//, ''),
          dependents: all.map((p) => p.replace(/^[^/]+\//, '')),
        });
      }

      return { dependents };
    } finally {
      await client.close();
    }
  }

  private async runSecurityScan(
    repositoryId: string,
    paths: string[],
    repoSlug: string,
  ): Promise<{
    findings: Array<{ path: string; severity: 'critica' | 'alta' | 'media'; pattern: string; line?: number }>;
  }> {
    const findings: Array<{
      path: string;
      severity: 'critica' | 'alta' | 'media';
      pattern: string;
      line?: number;
    }> = [];

    for (const relPath of paths.slice(0, 25)) {
      if (!/\.(tsx?|jsx?|js|json|env)$/.test(relPath)) continue;
      const content = await this.fileContent.getFileContentSafe(
        repositoryId,
        relPath.startsWith(repoSlug) ? relPath : `${repoSlug}/${relPath}`,
      );
      if (!content) continue;

      const lines = content.split('\n');
      for (const { pattern, severity } of SECRET_PATTERNS) {
        for (let i = 0; i < lines.length; i++) {
          const m = lines[i].match(pattern);
          if (m && !lines[i].trim().startsWith('//') && !lines[i].trim().startsWith('*'))
            findings.push({
              path: relPath,
              severity,
              pattern: m[0].slice(0, 40) + (m[0].length > 40 ? '…' : ''),
              line: i + 1,
            });
        }
      }
    }

    return { findings };
  }

  private computeRiskScore(
    seguridad: { findings: Array<{ severity: string }> },
    impacto: { dependents: Array<{ dependents: string[] }> },
    paths: string[],
  ): number {
    let score = 1;
    const critica = seguridad.findings.filter((f) => f.severity === 'critica').length;
    const alta = seguridad.findings.filter((f) => f.severity === 'alta').length;
    const depCount = impacto.dependents.reduce((acc, d) => acc + d.dependents.length, 0);
    const hasSensitivePath = paths.some(
      (p) => /\/api\/|\/auth\/|config|\.env/.test(p),
    );

    if (critica > 0) score += 4;
    else if (alta > 0) score += 2;
    if (depCount > 10) score += 2;
    else if (depCount > 3) score += 1;
    if (hasSensitivePath) score += 1;

    return Math.min(10, score);
  }

  private buildResumen(
    riskScore: number,
    securityCount: number,
    dependentCount: number,
  ): string {
    const parts: string[] = [];
    parts.push(`Riesgo: ${riskScore}/10.`);
    if (securityCount > 0)
      parts.push(`${securityCount} hallazgo(s) de seguridad (revisar exposición de secretos).`);
    if (dependentCount > 0)
      parts.push(`${dependentCount} módulo(s) dependen de los archivos modificados.`);
    if (parts.length === 1) parts.push('Sin hallazgos críticos.');
    return parts.join(' ');
  }
}
