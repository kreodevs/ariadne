/**
 * Ejecución de herramientas del retriever (Cypher, RAG, archivos) — sin LLM.
 * Compartido por el pipeline de chat en ingest y por POST /internal/... para el orchestrator.
 */
import { Injectable } from '@nestjs/common';
import { ChatCypherService } from './chat-cypher.service';
import { ChatHandlersService } from './chat-handlers.service';
import { FileContentService } from '../repositories/file-content.service';
import { RepositoriesService } from '../repositories/repositories.service';
import type { ChatScope } from './chat-scope.util';
import { filterCypherRowsByScope, matchesChatScope } from './chat-scope.util';

export type RetrieverToolName = 'execute_cypher' | 'semantic_search' | 'get_graph_summary' | 'get_file_content';

export interface RetrieverToolRequest {
  projectScope?: boolean;
  scope?: ChatScope;
  tool: RetrieverToolName;
  arguments: Record<string, unknown>;
  /** Si semantic_search viene sin query, se usa este texto (mensaje usuario). */
  fallbackMessage?: string;
}

export interface RetrieverToolResult {
  toolResult: string;
  lastCypher?: string;
  collectedRows: unknown[];
}

@Injectable()
export class ChatRetrieverToolsService {
  constructor(
    private readonly cypher: ChatCypherService,
    private readonly handlers: ChatHandlersService,
    private readonly fileContent: FileContentService,
    private readonly repos: RepositoriesService,
  ) {}

  /**
   * Ejecuta una herramienta del retriever (misma lógica que el bucle ReAct).
   * @param repositoryId - Repo desde el que se resuelve projectId Falkor.
   * @param projectId - projectId del grafo (normalmente resolveProjectIdForRepo(repositoryId)).
   */
  async executeTool(
    repositoryId: string,
    projectId: string,
    req: RetrieverToolRequest,
  ): Promise<RetrieverToolResult> {
    const scope = req.scope;
    const projectScope = Boolean(req.projectScope);
    let lastCypher: string | undefined;
    const collectedRows: unknown[] = [];

    const fn = req.tool;
    let toolResult: string;

    try {
      if (fn === 'execute_cypher') {
        const cypher = String(req.arguments.cypher ?? '').trim();
        if (!cypher) {
          toolResult = 'Error: cypher vacío';
        } else {
          lastCypher = cypher;
          const rawRows = await this.cypher.executeCypher(projectId, cypher);
          const rows = filterCypherRowsByScope(rawRows as Record<string, unknown>[], scope) as typeof rawRows;
          if (rawRows.length > 0 && rows.length === 0) {
            toolResult = `0 filas tras aplicar el alcance (scope): ${rawRows.length} filas en crudo omitidas por repoIds/prefijos/exclusiones. Ajusta el scope o la consulta.`;
          } else if (rows.length === 0) {
            toolResult =
              '0 filas devueltas por Cypher. **sin datos en índice para este alcance** — no inventes rutas; prueba términos más amplios, otro MATCH o semantic_search.';
          } else {
            collectedRows.push(...rows);
            toolResult = `Resultados (${rows.length} filas):\n${this.cypher.formatResultsHuman(rows as Record<string, unknown>[], rows.length)}`;
          }
        }
      } else if (fn === 'semantic_search') {
        const q =
          String(req.arguments.query ?? '').trim() || String(req.fallbackMessage ?? '').trim();
        const semantic = await this.handlers.semanticSearchFallback(projectId, q);
        let semRows = semantic.result as Array<Record<string, unknown>>;
        if (scope) {
          semRows = semRows.filter((row) =>
            matchesChatScope(row.path as string, row.repoId as string, scope),
          );
        }
        if (semRows.length > 0) {
          collectedRows.push(...semRows);
          toolResult = `Búsqueda semántica (${semRows.length}):\n${this.cypher.formatResultsHuman(semRows, semRows.length)}`;
        } else if (semantic.result.length > 0 && semRows.length === 0) {
          toolResult =
            'Búsqueda semántica: todos los candidatos quedaron fuera del alcance (scope). Ajusta repoIds/prefijos/exclusiones o amplía la consulta.';
        } else {
          const diag = await this.handlers.getSemanticSearchDiagnostics(projectId);
          toolResult = `Búsqueda semántica: 0 resultados.\n${diag}\nPrueba execute_cypher si el índice vectorial no aplica.`;
        }
      } else if (fn === 'get_graph_summary') {
        let summary: Awaited<ReturnType<ChatCypherService['getGraphSummary']>>;
        if (projectScope) {
          const single =
            scope?.repoIds?.length === 1 ? scope.repoIds[0]! : undefined;
          summary = single
            ? await this.cypher.getGraphSummary(single, true, true)
            : await this.cypher.getGraphSummaryForProject(projectId);
        } else {
          summary = await this.cypher.getGraphSummary(repositoryId, true, true);
        }
        toolResult = `Conteos: ${JSON.stringify(summary.counts)}. Muestras: ${JSON.stringify(summary.samples, null, 2)}`;
      } else if (fn === 'get_file_content') {
        const p = String(req.arguments.path ?? '').trim();
        if (!p) {
          toolResult = 'Error: path vacío';
        } else if (!matchesChatScope(p, projectScope ? undefined : repositoryId, scope)) {
          toolResult = `Path \`${p}\` fuera del alcance (scope): repoIds / prefijos / exclusiones.`;
        } else {
          let content: string | null = null;
          if (projectScope) {
            const repos = await this.repos.findAll(projectId);
            const ordered =
              scope?.repoIds && scope.repoIds.length > 0
                ? repos.filter((r) => scope.repoIds!.includes(r.id))
                : repos;
            const list = ordered.length > 0 ? ordered : repos;
            for (const repo of list) {
              if (!matchesChatScope(p, repo.id, scope)) continue;
              content = await this.fileContent.getFileContentSafe(repo.id, p);
              if (content != null) break;
            }
          } else {
            content = await this.fileContent.getFileContentSafe(repositoryId, p);
          }
          if (!content) {
            toolResult = `No se pudo leer \`${p}\` (o no coincide con el alcance del scope).`;
          } else {
            const MAX_CHARS = 14000;
            const truncated = content.length > MAX_CHARS;
            const snippet = truncated ? content.slice(0, MAX_CHARS) + '\n\n...[truncado]' : content;
            toolResult = `Archivo \`${p}\`:\n\`\`\`\n${snippet}\n\`\`\``;
          }
        }
      } else {
        toolResult = `Herramienta desconocida: ${String(fn)}`;
      }
    } catch (err) {
      toolResult = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }

    return { toolResult, lastCypher, collectedRows };
  }
}
