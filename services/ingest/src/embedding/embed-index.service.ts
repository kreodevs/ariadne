/**
 * @fileoverview Indexa embeddings en nodos Function y Component del grafo para RAG vectorial. Requiere EMBEDDING_PROVIDER + API key y FalkorDB 4.0+.
 */
import { Injectable } from '@nestjs/common';
import { FalkorDB } from 'falkordb';
import { getFalkorConfig } from '../pipeline/falkor';
import { GRAPH_NAME } from '../pipeline/falkor';
import { RepositoriesService } from '../repositories/repositories.service';
import { FileContentService } from '../repositories/file-content.service';
import { EmbeddingService } from './embedding.service';

/**
 * Servicio que recorre Function y Component del grafo, genera embeddings con EmbeddingService y actualiza el grafo (propiedad embedding).
 */
@Injectable()
export class EmbedIndexService {
  constructor(
    private readonly repos: RepositoriesService,
    private readonly fileContent: FileContentService,
    private readonly embedding: EmbeddingService,
  ) {}

  /**
   * Indexa embeddings en nodos Function y Component del grafo (FalkorDB 4.0+). Usa contenido de archivos para enriquecer el texto a embedir.
   * @param {string} projectId - UUID del repositorio (projectId en FalkorDB).
   * @returns {Promise<{ indexed: number; errors: number }>} Número de nodos indexados y errores.
   */
  async runEmbedIndex(projectId: string): Promise<{ indexed: number; errors: number }> {
    await this.repos.findOne(projectId);
    if (!this.embedding.isAvailable()) {
      throw new Error('Embedding provider not configured. Set EMBEDDING_PROVIDER=openai|google and OPENAI_API_KEY or GOOGLE_API_KEY.');
    }
    const config = getFalkorConfig();
    const client = await FalkorDB.connect({
      socket: { host: config.host, port: config.port },
    });
    const graph = client.selectGraph(GRAPH_NAME);
    const dim = this.embedding.getDimension();
    let indexed = 0;
    let errors = 0;

    const funcRes = (await graph.query(
      `MATCH (n:Function) WHERE n.projectId = $projectId RETURN n.path AS path, n.name AS name, n.description AS description, n.startLine AS startLine, n.endLine AS endLine`,
      { params: { projectId } },
    )) as { data?: unknown[] };
    const funcRows = funcRes.data ?? [];
    for (const row of funcRows) {
      const arr = Array.isArray(row) ? row : [row];
      const path = String(arr[0] ?? '');
      const name = String(arr[1] ?? '');
      const description = arr[2] != null ? String(arr[2]) : null;
      const startLine = typeof arr[3] === 'number' ? arr[3] : null;
      const endLine = typeof arr[4] === 'number' ? arr[4] : null;

      let text = [name, path, description].filter(Boolean).join(' ');
      if (startLine != null && endLine != null && endLine >= startLine) {
        const content = await this.fileContent.getFileContentSafe(projectId, path);
        if (content) {
          const lines = content.split(/\r?\n/);
          const slice = lines.slice(Math.max(0, startLine - 1), endLine).join('\n').trim();
          if (slice.length > 30) text = slice.slice(0, 4000);
        }
      }
      try {
        const vec = await this.embedding.embed(text);
        const vecStr = `[${vec.join(',')}]`;
        await graph.query(
          `MATCH (n:Function {path: $path, name: $name, projectId: $projectId}) SET n.embedding = vecf32(${vecStr})`,
          { params: { path, name, projectId } }
        );
        indexed++;
      } catch (e) {
        errors++;
        if (errors <= 3) {
          console.warn(`[embed-index] Function ${path}::${name} failed:`, e instanceof Error ? e.message : e);
        }
      }
    }

    const compRes = (await graph.query(
      `MATCH (n:Component) WHERE n.projectId = $projectId RETURN n.name AS name, n.description AS description`,
      { params: { projectId } },
    )) as { data?: [string, string | null][] };
    for (const row of compRes.data ?? []) {
      const [name, description] = row;
      const text = [name, description].filter(Boolean).join(' ');
      try {
        const vec = await this.embedding.embed(text);
        const vecStr = `[${vec.join(',')}]`;
        await graph.query(
          `MATCH (n:Component {name: $name, projectId: $projectId}) SET n.embedding = vecf32(${vecStr})`,
          { params: { name, projectId } }
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
        `CREATE VECTOR INDEX FOR (n:Function) ON (n.embedding) OPTIONS {dimension: ${dim}, similarityFunction: 'cosine'}`,
      );
    } catch {
      /* index may already exist */
    }
    try {
      await graph.query(
        `CREATE VECTOR INDEX FOR (n:Component) ON (n.embedding) OPTIONS {dimension: ${dim}, similarityFunction: 'cosine'}`,
      );
    } catch {
      /* index may already exist */
    }
    await client.close();
    if (errors > 0) {
      console.warn(
        `[embed-index] ${indexed} indexed, ${errors} errors. ` +
        `Check: EMBEDDING_PROVIDER, OPENAI_API_KEY/GOOGLE_API_KEY, FalkorDB 4.0+ vector support, rate limits.`
      );
    }
    return { indexed, errors };
  }
}
