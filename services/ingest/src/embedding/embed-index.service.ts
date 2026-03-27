/**
 * @fileoverview Indexa embeddings en Function, Component y Document (chunks .md) para RAG.
 * Requiere EMBEDDING_PROVIDER + FalkorDB con soporte vectorial (`vecf32`, CREATE VECTOR INDEX), p. ej. FalkorDB 4.x según docs.
 * Si ves `Unknown function 'vecf32'`, actualiza FalkorDB o desactiva embed post-sync con SYNC_SKIP_EMBED_INDEX=1.
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FalkorDB } from 'falkordb';
import {
  getFalkorConfig,
  effectiveShardMode,
  listGraphNamesForProjectRouting,
} from '../pipeline/falkor';
import { ProjectEntity } from '../projects/entities/project.entity';
import { RepositoriesService } from '../repositories/repositories.service';
import { FileContentService } from '../repositories/file-content.service';
import { EmbeddingSpaceService } from './embedding-space.service';

/**
 * El driver Falkor devuelve filas como array posicional o como objeto con aliases de RETURN.
 * NO asumir tuplas: `const [a,b] = row` rompe con objetos ("row is not iterable").
 */
type FalkorDbClient = Awaited<ReturnType<typeof FalkorDB.connect>>;

function rowAsRecord(row: unknown, keys: string[]): Record<string, unknown> {
  if (row !== null && typeof row === 'object' && !Array.isArray(row)) {
    return row as Record<string, unknown>;
  }
  const arr = Array.isArray(row) ? row : [row];
  const out: Record<string, unknown> = {};
  for (let i = 0; i < keys.length; i++) {
    out[keys[i]] = arr[i];
  }
  return out;
}

/**
 * Servicio que recorre Function y Component del grafo, genera embeddings con EmbeddingService y actualiza el grafo (propiedad embedding).
 */
@Injectable()
export class EmbedIndexService {
  constructor(
    private readonly repos: RepositoriesService,
    private readonly fileContent: FileContentService,
    private readonly embeddingSpaces: EmbeddingSpaceService,
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
  ) {}

  /**
   * Indexa embeddings para todos los projectId Falkor asociados al repositorio (multi-root).
   * @param repositoryId - ID del repositorio en Postgres.
   */
  async runEmbedIndex(repositoryId: string): Promise<{ indexed: number; errors: number }> {
    await this.repos.findOne(repositoryId);
    const linked = await this.repos.getProjectIdsForRepo(repositoryId);
    const falkorProjectIds = linked.length > 0 ? linked : [repositoryId];
    let indexed = 0;
    let errors = 0;
    for (const falkorProjectId of falkorProjectIds) {
      const r = await this.runEmbedIndexForFalkorProject(falkorProjectId, repositoryId);
      indexed += r.indexed;
      errors += r.errors;
    }
    if (errors > 0) {
      console.warn(
        `[embed-index] ${indexed} indexed, ${errors} errors. ` +
          `Check: EMBEDDING_PROVIDER, API keys, FalkorDB con vecf32/vector index (upgrade si Unknown function 'vecf32'), rate limits. ` +
          `Para omitir embed en sync: SYNC_SKIP_EMBED_INDEX=1.`,
      );
    }
    return { indexed, errors };
  }

  /**
   * Embeddings en todos los subgrafos Falkor de un proyecto Ariadne.
   */
  async runEmbedIndexForFalkorProject(
    falkorProjectId: string,
    repositoryIdForFileContent: string,
  ): Promise<{ indexed: number; errors: number }> {
    const writeBinding =
      await this.embeddingSpaces.getWriteBindingForRepository(repositoryIdForFileContent);
    const embed = writeBinding.provider;
    if (!embed?.isAvailable()) {
      throw new Error(
        'Embedding provider not configured for write. Set EMBEDDING_PROVIDER + keys, OLLAMA_HOST for ollama, or link repository write/read embedding space via PATCH.',
      );
    }
    const prop = writeBinding.graphProperty;
    const dim = embed.getDimension();

    const projRow = await this.projectRepo.findOne({ where: { id: falkorProjectId } });
    const shardMode = effectiveShardMode(projRow?.falkorShardMode ?? 'project');
    const segments = Array.isArray(projRow?.falkorDomainSegments) ? projRow!.falkorDomainSegments! : [];
    const graphNames = listGraphNamesForProjectRouting(
      falkorProjectId,
      shardMode === 'domain' ? 'domain' : 'project',
      segments,
    );

    const config = getFalkorConfig();
    const client = await FalkorDB.connect({
      socket: { host: config.host, port: config.port },
    });
    let indexed = 0;
    let errors = 0;

    for (const gName of graphNames) {
      const graph = client.selectGraph(gName);
      try {
        const part = await this.embedOneGraph(
          graph,
          falkorProjectId,
          repositoryIdForFileContent,
          embed,
          prop,
          dim,
        );
        indexed += part.indexed;
        errors += part.errors;
      } catch {
        /* grafo vacío o nombre legacy sin datos */
      }
    }

    await client.close();
    return { indexed, errors };
  }

  private async embedOneGraph(
    graph: ReturnType<FalkorDbClient['selectGraph']>,
    falkorProjectId: string,
    repositoryIdForFileContent: string,
    embed: { embed: (t: string) => Promise<number[]>; getDimension: () => number },
    prop: string,
    dim: number,
  ): Promise<{ indexed: number; errors: number }> {
    let indexed = 0;
    let errors = 0;

    const funcRes = (await graph.query(
      `MATCH (n:Function) WHERE n.projectId = $projectId RETURN n.path AS path, n.name AS name, n.description AS description, n.startLine AS startLine, n.endLine AS endLine`,
      { params: { projectId: falkorProjectId } },
    )) as { data?: unknown[] };
    const funcRows = funcRes.data ?? [];
    for (const row of funcRows) {
      const r = rowAsRecord(row, ['path', 'name', 'description', 'startLine', 'endLine']);
      const path = String(r.path ?? '');
      const name = String(r.name ?? '');
      const description = r.description != null ? String(r.description) : null;
      const startLine = typeof r.startLine === 'number' ? r.startLine : null;
      const endLine = typeof r.endLine === 'number' ? r.endLine : null;

      let text = [name, path, description].filter(Boolean).join(' ');
      if (startLine != null && endLine != null && endLine >= startLine) {
        const content = await this.fileContent.getFileContentSafe(repositoryIdForFileContent, path);
        if (content) {
          const lines = content.split(/\r?\n/);
          const slice = lines.slice(Math.max(0, startLine - 1), endLine).join('\n').trim();
          if (slice.length > 30) text = slice.slice(0, 4000);
        }
      }
      try {
        const vec = await embed.embed(text);
        await graph.query(
          `MATCH (n:Function {path: $path, name: $name, projectId: $projectId}) SET n.${prop} = vecf32($vec)`,
          { params: { path, name, projectId: falkorProjectId, vec } },
        );
        indexed++;
      } catch (e) {
        errors++;
        if (errors <= 3) {
          console.warn(
            `[embed-index] Function ${path}::${name} failed:`,
            e instanceof Error ? e.message : e,
          );
        }
      }
    }

    const compRes = (await graph.query(
      `MATCH (n:Component) WHERE n.projectId = $projectId RETURN n.name AS name, n.description AS description`,
      { params: { projectId: falkorProjectId } },
    )) as { data?: unknown[] };
    for (const row of compRes.data ?? []) {
      const r = rowAsRecord(row, ['name', 'description']);
      const name = String(r.name ?? '');
      const description = r.description != null ? String(r.description) : null;
      const text = [name, description].filter(Boolean).join(' ');
      try {
        const vec = await embed.embed(text);
        await graph.query(
          `MATCH (n:Component {name: $name, projectId: $projectId}) SET n.${prop} = vecf32($vec)`,
          { params: { name, projectId: falkorProjectId, vec } },
        );
        indexed++;
      } catch (e) {
        errors++;
        if (errors <= 3) {
          console.warn(`[embed-index] Component ${name} failed:`, e instanceof Error ? e.message : e);
        }
      }
    }

    try {
      await graph.query(
        `CREATE VECTOR INDEX FOR (n:Function) ON (n.${prop}) OPTIONS {dimension: ${dim}, similarityFunction: 'cosine'}`,
      );
    } catch {
      /* index may already exist */
    }
    try {
      await graph.query(
        `CREATE VECTOR INDEX FOR (n:Component) ON (n.${prop}) OPTIONS {dimension: ${dim}, similarityFunction: 'cosine'}`,
      );
    } catch {
      /* index may already exist */
    }

    const docRes = (await graph.query(
      `MATCH (d:Document) WHERE d.projectId = $projectId AND d.chunkText IS NOT NULL AND trim(d.chunkText) <> '' RETURN d.path AS path, d.chunkIndex AS chunkIndex, d.heading AS heading, d.chunkText AS chunkText`,
      { params: { projectId: falkorProjectId } },
    )) as { data?: unknown[] };
    for (const row of docRes.data ?? []) {
      const r = rowAsRecord(row, ['path', 'chunkIndex', 'heading', 'chunkText']);
      const path = String(r.path ?? '');
      const chunkIndexRaw = r.chunkIndex;
      const chunkIndex =
        typeof chunkIndexRaw === 'number' ? chunkIndexRaw : Number(chunkIndexRaw);
      const heading = r.heading != null ? String(r.heading) : '';
      const chunkText = String(r.chunkText ?? '');
      const text = [heading, path, chunkText].filter(Boolean).join('\n').slice(0, 8000);
      if (text.length < 20) continue;
      try {
        const vec = await embed.embed(text);
        await graph.query(
          `MATCH (d:Document {path: $path, chunkIndex: $chunkIndex, projectId: $projectId}) SET d.${prop} = vecf32($vec)`,
          { params: { path, chunkIndex, projectId: falkorProjectId, vec } },
        );
        indexed++;
      } catch (e) {
        errors++;
        if (errors <= 3) {
          console.warn(
            `[embed-index] Document ${path}#${chunkIndex} failed:`,
            e instanceof Error ? e.message : e,
          );
        }
      }
    }

    try {
      await graph.query(
        `CREATE VECTOR INDEX FOR (n:Document) ON (n.${prop}) OPTIONS {dimension: ${dim}, similarityFunction: 'cosine'}`,
      );
    } catch {
      /* index may already exist */
    }

    return { indexed, errors };
  }
}
