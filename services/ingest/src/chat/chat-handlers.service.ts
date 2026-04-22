/**
 * Handlers de respuestas del chat: answer* y runExplorerReAct.
 * Usado por ChatService y por los agentes (CodeAnalysis, Knowledge).
 */

import { Injectable } from '@nestjs/common';
import { cypherSafe } from 'ariadne-common';
import { RepositoriesService } from '../repositories/repositories.service';
import { FileContentService } from '../repositories/file-content.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { EmbeddingSpaceService } from '../embedding/embedding-space.service';
import { ChatCypherService } from './chat-cypher.service';
import { ChatAntipatternsService } from './chat-antipatterns.service';
import { ChatLlmService } from './chat-llm.service';
import { SCHEMA, EXAMPLES, EXPLORER_TOOLS_ALL, getExplorerToolsKnowledge } from './chat.constants';
import { normalizeOptions, extractSearchTerms, getSearchTermsWithSynonyms } from './chat-analysis.utils';
import { isNonSourceEvidenceNoisePath } from './chat-evidence-path-filter';

/** Respuesta con answer opcional cypher/result (para AgentResponse). */
export interface HandlerResponse {
  answer: string;
  cypher?: string;
  result?: unknown[];
}

@Injectable()
export class ChatHandlersService {
  constructor(
    private readonly repos: RepositoriesService,
    private readonly fileContent: FileContentService,
    private readonly embedding: EmbeddingService,
    private readonly embeddingSpaces: EmbeddingSpaceService,
    private readonly cypher: ChatCypherService,
    private readonly antipatterns: ChatAntipatternsService,
    private readonly llm: ChatLlmService,
  ) {}

  private async resolveProjectIdForRepo(repoId: string): Promise<string> {
    const ids = await this.repos.getProjectIdsForRepo(repoId);
    return ids[0] ?? repoId;
  }

  private extractPathFromQuestion(message: string): string | null {
    const match = message.match(/[\w.-]+\/[\w./-]+\.(tsx?|jsx?|mjs|cjs)/i);
    return match ? match[0] : null;
  }

  private extractTwoPathsFromQuestion(message: string): [string, string] | null {
    const matches = message.matchAll(/[\w.-]+\/[\w./-]+\.(tsx?|jsx?|mjs|cjs)/gi);
    const paths = Array.from(matches).map((m) => m[0]);
    const unique = Array.from(new Set(paths));
    if (unique.length >= 2) return [unique[0], unique[1]];
    return null;
  }

  async answerImportUsage(repositoryId: string, message: string): Promise<string> {
    const paths = this.extractTwoPathsFromQuestion(message);
    if (!paths || paths.length < 2) {
      return 'Indica ambos paths (ej. archivo A importa archivo B) para verificar la relación IMPORTS y el uso.';
    }
    const [pathA, pathB] = paths;
    const projectId = (await this.repos.findOne(repositoryId)).id;

    const imports = (await this.cypher.executeCypher(
      projectId,
      `MATCH (a:File)-[:IMPORTS]->(b:File) WHERE a.projectId = $projectId AND b.projectId = $projectId
       AND a.path = $pathA AND b.path = $pathB
       RETURN a.path as fromPath, b.path as toPath`,
      { pathA, pathB },
    )) as Array<{ fromPath: string; toPath: string }>;

    if (imports.length === 0) {
      return `**No** — El grafo no tiene relación \`IMPORTS\` entre \`${pathA}\` y \`${pathB}\`. No se detectó ese import.`;
    }

    const calls = (await this.cypher.executeCypher(
      projectId,
      `MATCH (caller:Function)-[:CALLS]->(callee:Function)
       WHERE caller.projectId = $projectId AND callee.projectId = $projectId
       AND caller.path = $pathA AND callee.path = $pathB
       RETURN caller.name as caller, callee.name as callee`,
      { pathA, pathB },
    )) as Array<{ caller: string; callee: string }>;

    const parts: string[] = [`**Sí** — \`${pathA}\` importa \`${pathB}\` (relación IMPORTS en el grafo).`];

    if (calls.length > 0) {
      parts.push(`**Uso confirmado** — Hay ${calls.length} llamada(s) de funciones: ${calls.slice(0, 5).map((c) => `\`${c.caller}\` → \`${c.callee}\``).join(', ')}${calls.length > 5 ? '…' : ''}.`);
    } else {
      const content = await this.fileContent.getFileContentSafe(repositoryId, pathA);
      if (content) {
        const importedFileBase = pathB.split('/').pop()?.replace(/\.(tsx?|jsx?)$/, '') ?? '';
        const nameVariants = [importedFileBase, importedFileBase.charAt(0).toUpperCase() + importedFileBase.slice(1)];
        const bodyWithoutImports = content.replace(/import\s+.*?from\s+['\"][^'\"]+['\"];?\s*/gs, '');
        const hasRef = nameVariants.some((n) => bodyWithoutImports.includes(n) && bodyWithoutImports !== content);
        parts.push(hasRef
          ? `**Uso posible** — El nombre \`${importedFileBase}\` aparece en el cuerpo del archivo (tras ignorar imports). Revisa el código para confirmar.`
          : `**Uso no evidente** — No hay CALLS entre funciones ni referencias claras al import en el cuerpo. Puede ser un import de tipos/interfaces no usado (dead import). Revisa el código.`);
      } else {
        parts.push('**Uso** — No pude leer el archivo. Para tipos/interfaces el grafo no rastrea uso; revisa el código manualmente.');
      }
    }

    return parts.join('\n\n');
  }

  async answerWhyAntipattern(repositoryId: string, message: string): Promise<string> {
    const path = this.extractPathFromQuestion(message);
    if (!path) {
      return 'Indica el path del archivo (ej. `oohbp2/src/pages/Rutas/ABCRutas.tsx`) para que pueda explicar por qué se considera spaghetti o de riesgo.';
    }

    const antipatterns = await this.antipatterns.detectAntipatterns(repositoryId);
    const pathNorm = path.replace(/\/$/, '');
    const spaghettiItem = antipatterns.spaghetti.find((s) => s.path === pathNorm || s.path.endsWith(pathNorm) || s.path.includes(pathNorm.split('/').pop() ?? ''));
    const godItem = antipatterns.godFunctions.find((g) => g.path === pathNorm || g.path.endsWith(pathNorm) || g.path.includes(pathNorm.split('/').pop() ?? ''));

    const parts: string[] = [`## Por qué \`${path}\` se considera problemático\n`];

    if (spaghettiItem) {
      parts.push(
        `**Spaghetti (anidamiento excesivo)** — La función \`${spaghettiItem.name}\` en ese archivo tiene **nestingDepth: ${spaghettiItem.nestingDepth}** (umbral: 4). ` +
        `Bloques muy anidados (if/for/try dentro de otros) dificultan legibilidad y mantenimiento. ` +
        `Complejidad ciclomática: ${spaghettiItem.complexity ?? '—'}, LOC: ${spaghettiItem.loc ?? '—'}.`,
      );
    }
    if (godItem) {
      parts.push(
        `**God Function (acoplamiento alto)** — La función \`${godItem.name}\` tiene **outCalls: ${godItem.outCalls}** (umbral: 8). Indica que hace demasiado y está muy acoplada a otras funciones.`,
      );
    }

    if (parts.length === 1) {
      const filename = pathNorm.split('/').pop() ?? '';
      const byPath = antipatterns.spaghetti.filter((s) => s.path.includes(filename));
      const godByPath = antipatterns.godFunctions.filter((g) => g.path.includes(filename));
      if (byPath.length) {
        const s = byPath[0];
        parts.push(
          `**Spaghetti** — \`${s.name}\` tiene **nestingDepth: ${s.nestingDepth}** (umbral 4). Complejidad: ${s.complexity ?? '—'}, LOC: ${s.loc ?? '—'}.`,
        );
      } else if (godByPath.length) {
        const g = godByPath[0];
        parts.push(`**God Function** — \`${g.name}\` tiene **outCalls: ${g.outCalls}** (umbral 8).`);
      } else {
        return `No encontré \`${path}\` en la lista de antipatrones del último análisis. Ejecuta primero "Diagnóstico" en el panel de análisis o verifica el path.`;
      }
    }

    return parts.join('\n\n');
  }

  private isWhyMissingQuestion(message: string): boolean {
    const lower = message.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    return lower.includes('por que no aparece') || lower.includes('por qué no aparece') || lower.includes('no aparece la') || lower.includes('no aparece el') || lower.includes('por que falta') || lower.includes('falta la');
  }

  private extractMissingConcept(message: string): string | null {
    const m = message.match(/(?:cotización de |cotizacion de )([^.?!]+?)(?:\?|$)/i) ?? message.match(/(?:no aparece (?:la|el) )(?:cotización de )?([^.?!]+?)(?:\?|$)/i);
    const raw = m?.[1]?.trim();
    if (!raw || raw.length < 3) return null;
    return raw;
  }

  /**
   * Búsqueda semántica (vector). Expuesta para runUnifiedPipeline en ChatService.
   * @param graphProjectId - `projectId` en Falkor (padre en multi-root vía `resolveProjectIdForRepo`).
   * @param repositoryIdForEmbedding - fila `repositories.id` para leer espacio de embeddings; si se omite, se usa `graphProjectId` (repo sin proyecto asociado).
   * @param restrictRepoId - si se define, conteos + `queryNodes` solo consideran nodos con ese `repoId` (fan-out multi-root).
   * @param opts.dropNonSourceEvidenceNoisePaths — omite filas cuyo `path` encaje en el mismo criterio que
   *   `wherePathNotNonSourceEvidenceNoise` (deterministic raw_evidence).
   */
  async semanticSearchFallback(
    graphProjectId: string,
    query: string,
    limit = 15,
    repositoryIdForEmbedding?: string,
    restrictRepoId?: string,
    opts?: { dropNonSourceEvidenceNoisePaths?: boolean },
  ): Promise<{ cypher: string; result: unknown[] }> {
    if (!query.trim()) return { cypher: '', result: [] };
    const embeddingRepoId = repositoryIdForEmbedding ?? graphProjectId;
    const readBinding = await this.embeddingSpaces.getReadBindingForRepository(embeddingRepoId);
    const embed = readBinding.provider;
    if (!embed?.isAvailable()) return { cypher: '', result: [] };
    const vProp = readBinding.graphProperty;
    const repoClause = restrictRepoId ? ' AND n.repoId = $repoId' : '';
    const countExtra = restrictRepoId ? { repoId: restrictRepoId } : {};
    const yieldWhere = restrictRepoId
      ? ` WHERE node.projectId = ${cypherSafe(graphProjectId)} AND node.repoId = ${cypherSafe(restrictRepoId)}`
      : '';
    const dropNoise = Boolean(opts?.dropNonSourceEvidenceNoisePaths);
    const skipNoisePath = (pathStr: string) => dropNoise && isNonSourceEvidenceNoisePath(pathStr);
    try {
      const countFn = await this.cypher.executeCypher(
        graphProjectId,
        `MATCH (n:Function) WHERE n.projectId = $projectId${repoClause} AND n.${vProp} IS NOT NULL RETURN count(n) as c`,
        countExtra,
      );
      const countComp = await this.cypher.executeCypher(
        graphProjectId,
        `MATCH (n:Component) WHERE n.projectId = $projectId${repoClause} AND n.${vProp} IS NOT NULL RETURN count(n) as c`,
        countExtra,
      );
      const countDoc = await this.cypher.executeCypher(
        graphProjectId,
        `MATCH (n:Document) WHERE n.projectId = $projectId${repoClause} AND n.${vProp} IS NOT NULL RETURN count(n) as c`,
        countExtra,
      );
      const countSb = await this.cypher.executeCypher(
        graphProjectId,
        `MATCH (n:StorybookDoc) WHERE n.projectId = $projectId${repoClause} AND n.${vProp} IS NOT NULL RETURN count(n) as c`,
        countExtra,
      );
      const countMd = await this.cypher.executeCypher(
        graphProjectId,
        `MATCH (n:MarkdownDoc) WHERE n.projectId = $projectId${repoClause} AND n.${vProp} IS NOT NULL RETURN count(n) as c`,
        countExtra,
      );
      const countModel = await this.cypher.executeCypher(
        graphProjectId,
        `MATCH (n:Model) WHERE n.projectId = $projectId${repoClause} AND n.${vProp} IS NOT NULL RETURN count(n) as c`,
        countExtra,
      );
      const countEnum = await this.cypher.executeCypher(
        graphProjectId,
        `MATCH (n:Enum) WHERE n.projectId = $projectId${repoClause} AND n.${vProp} IS NOT NULL RETURN count(n) as c`,
        countExtra,
      );
      const hasFn = (countFn as Array<{ c?: number }>)?.[0]?.c ?? 0;
      const hasComp = (countComp as Array<{ c?: number }>)?.[0]?.c ?? 0;
      const hasDoc = (countDoc as Array<{ c?: number }>)?.[0]?.c ?? 0;
      const hasSb = (countSb as Array<{ c?: number }>)?.[0]?.c ?? 0;
      const hasMd = (countMd as Array<{ c?: number }>)?.[0]?.c ?? 0;
      const hasModel = (countModel as Array<{ c?: number }>)?.[0]?.c ?? 0;
      const hasEnum = (countEnum as Array<{ c?: number }>)?.[0]?.c ?? 0;
      if (hasFn === 0 && hasComp === 0 && hasDoc === 0 && hasSb === 0 && hasMd === 0 && hasModel === 0 && hasEnum === 0)
        return { cypher: '', result: [] };

      const vec = await embed.embed(query.trim());
      const vecStr = `[${vec.join(',')}]`;
      const k = Math.max(limit, 20);

      const funcVecQ = `CALL db.idx.vector.queryNodes('Function', '${vProp}', ${k}, vecf32(${vecStr})) YIELD node, score${yieldWhere} RETURN node.name AS name, node.path AS path, node.projectId AS projectId, node.repoId AS repoId, score`;
      const compVecQ = `CALL db.idx.vector.queryNodes('Component', '${vProp}', ${k}, vecf32(${vecStr})) YIELD node, score${yieldWhere} RETURN node.name AS name, node.projectId AS projectId, node.repoId AS repoId, score`;
      const docVecQ = `CALL db.idx.vector.queryNodes('Document', '${vProp}', ${k}, vecf32(${vecStr})) YIELD node, score${yieldWhere} RETURN node.path AS path, node.heading AS heading, node.chunkIndex AS chunkIndex, node.projectId AS projectId, node.repoId AS repoId, score`;
      const sbVecQ = `CALL db.idx.vector.queryNodes('StorybookDoc', '${vProp}', ${k}, vecf32(${vecStr})) YIELD node, score${yieldWhere} RETURN node.title AS name, node.sourcePath AS path, node.projectId AS projectId, node.repoId AS repoId, score`;
      const mdDocVecQ = `CALL db.idx.vector.queryNodes('MarkdownDoc', '${vProp}', ${k}, vecf32(${vecStr})) YIELD node, score${yieldWhere} RETURN node.title AS name, node.sourcePath AS path, node.projectId AS projectId, node.repoId AS repoId, score`;
      const modelVecQ = `CALL db.idx.vector.queryNodes('Model', '${vProp}', ${k}, vecf32(${vecStr})) YIELD node, score${yieldWhere} RETURN node.name AS name, node.path AS path, node.projectId AS projectId, node.repoId AS repoId, score`;
      const enumVecQ = `CALL db.idx.vector.queryNodes('Enum', '${vProp}', ${k}, vecf32(${vecStr})) YIELD node, score${yieldWhere} RETURN node.name AS name, node.path AS path, node.projectId AS projectId, node.repoId AS repoId, score`;

      const [fRes, cRes, dRes, sbRes, mdDocRes, modelVecRes, enumVecRes] = await Promise.all([
        hasFn > 0 ? this.cypher.executeCypherRaw(funcVecQ, graphProjectId) : Promise.resolve([]),
        hasComp > 0 ? this.cypher.executeCypherRaw(compVecQ, graphProjectId) : Promise.resolve([]),
        hasDoc > 0 ? this.cypher.executeCypherRaw(docVecQ, graphProjectId) : Promise.resolve([]),
        hasSb > 0 ? this.cypher.executeCypherRaw(sbVecQ, graphProjectId) : Promise.resolve([]),
        hasMd > 0 ? this.cypher.executeCypherRaw(mdDocVecQ, graphProjectId) : Promise.resolve([]),
        hasModel > 0 ? this.cypher.executeCypherRaw(modelVecQ, graphProjectId) : Promise.resolve([]),
        hasEnum > 0 ? this.cypher.executeCypherRaw(enumVecQ, graphProjectId) : Promise.resolve([]),
      ]);

      const fData = (Array.isArray(fRes) ? fRes : []) as Array<unknown>;
      const cData = (Array.isArray(cRes) ? cRes : []) as Array<unknown>;
      const dData = (Array.isArray(dRes) ? dRes : []) as Array<unknown>;
      const sbData = (Array.isArray(sbRes) ? sbRes : []) as Array<unknown>;
      const mdDocData = (Array.isArray(mdDocRes) ? mdDocRes : []) as Array<unknown>;
      const modelVecData = (Array.isArray(modelVecRes) ? modelVecRes : []) as Array<unknown>;
      const enumVecData = (Array.isArray(enumVecRes) ? enumVecRes : []) as Array<unknown>;

      const results: Array<{ tipo: string; path: string; name: string; repoId?: string }> = [];
      const seen = new Set<string>();

      const toRow = (r: unknown): Record<string, unknown> => {
        if (!Array.isArray(r)) return r as Record<string, unknown>;
        const a = r as unknown[];
        if (a.length >= 5) {
          return { name: a[0], path: a[1], projectId: a[2], repoId: a[3], score: a[4] };
        }
        return { name: a[0], path: a[1], projectId: a[2], score: a[3] };
      };

      const passesRepo = (rid: unknown) =>
        !restrictRepoId || String(rid ?? '') === restrictRepoId;

      for (const row of fData) {
        const { name, path, projectId: pid, repoId } = toRow(row);
        if (pid !== graphProjectId || !passesRepo(repoId)) continue;
        const pathStr = String(path ?? '');
        const nameStr = String(name ?? '');
        const key = `Function:${nameStr}:${pathStr}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (skipNoisePath(pathStr)) continue;
        const out: { tipo: string; path: string; name: string; repoId?: string } = {
          tipo: 'Function',
          path: pathStr,
          name: pathStr ? `${nameStr} — ${pathStr}` : nameStr,
        };
        if (repoId != null && String(repoId)) out.repoId = String(repoId);
        results.push(out);
        if (results.length >= limit) break;
      }
      for (const row of cData) {
        if (results.length >= limit) break;
        const obj = Array.isArray(row)
          ? row.length >= 4
            ? { name: row[0], projectId: row[1], repoId: row[2], score: row[3] }
            : { name: row[0], projectId: row[1], score: row[2] }
          : (row as Record<string, unknown>);
        const { name, projectId: pid, repoId } = obj;
        if (pid !== graphProjectId || !passesRepo(repoId)) continue;
        const nameStr = String(name ?? '');
        const key = `Component:${nameStr}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const out: { tipo: string; path: string; name: string; repoId?: string } = {
          tipo: 'Component',
          path: nameStr,
          name: nameStr,
        };
        if (repoId != null && String(repoId)) out.repoId = String(repoId);
        results.push(out);
      }
      for (const row of dData) {
        if (results.length >= limit) break;
        const obj = Array.isArray(row)
          ? row.length >= 6
            ? {
                path: row[0],
                heading: row[1],
                chunkIndex: row[2],
                projectId: row[3],
                repoId: row[4],
                score: row[5],
              }
            : {
                path: row[0],
                heading: row[1],
                chunkIndex: row[2],
                projectId: row[3],
                score: row[4],
              }
          : (row as Record<string, unknown>);
        const pid = obj.projectId;
        if (pid !== graphProjectId || !passesRepo(obj.repoId)) continue;
        const pathStr = String(obj.path ?? '');
        const heading = String(obj.heading ?? '');
        const ci = obj.chunkIndex != null ? String(obj.chunkIndex) : '';
        const key = `Document:${pathStr}:${ci}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (skipNoisePath(pathStr)) continue;
        const title = heading ? `${heading} — ${pathStr}` : pathStr;
        const out: { tipo: string; path: string; name: string; repoId?: string } = {
          tipo: 'Document',
          path: pathStr,
          name: title,
        };
        if (obj.repoId != null && String(obj.repoId)) out.repoId = String(obj.repoId);
        results.push(out);
      }
      for (const row of sbData) {
        if (results.length >= limit) break;
        const { name, path, projectId: pid, repoId } = toRow(row);
        if (pid !== graphProjectId || !passesRepo(repoId)) continue;
        const pathStr = String(path ?? '');
        const titleStr = String(name ?? '');
        const key = `StorybookDoc:${pathStr}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (skipNoisePath(pathStr)) continue;
        const out: { tipo: string; path: string; name: string; repoId?: string } = {
          tipo: 'StorybookDoc',
          path: pathStr,
          name: pathStr ? `${titleStr || 'Storybook'} — ${pathStr}` : titleStr || pathStr,
        };
        if (repoId != null && String(repoId)) out.repoId = String(repoId);
        results.push(out);
      }
      for (const row of mdDocData) {
        if (results.length >= limit) break;
        const { name, path, projectId: pid, repoId } = toRow(row);
        if (pid !== graphProjectId || !passesRepo(repoId)) continue;
        const pathStr = String(path ?? '');
        const titleStr = String(name ?? '');
        const key = `MarkdownDoc:${pathStr}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (skipNoisePath(pathStr)) continue;
        const out: { tipo: string; path: string; name: string; repoId?: string } = {
          tipo: 'MarkdownDoc',
          path: pathStr,
          name: pathStr ? `${titleStr || 'Doc'} — ${pathStr}` : titleStr || pathStr,
        };
        if (repoId != null && String(repoId)) out.repoId = String(repoId);
        results.push(out);
      }
      for (const row of modelVecData) {
        if (results.length >= limit) break;
        const { name, path, projectId: pid, repoId } = toRow(row);
        if (pid !== graphProjectId || !passesRepo(repoId)) continue;
        const pathStr = String(path ?? '');
        const nameStr = String(name ?? '');
        const key = `Model:${nameStr}:${pathStr}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (skipNoisePath(pathStr)) continue;
        const out: { tipo: string; path: string; name: string; repoId?: string } = {
          tipo: 'Model',
          path: pathStr,
          name: pathStr ? `${nameStr} — ${pathStr}` : nameStr,
        };
        if (repoId != null && String(repoId)) out.repoId = String(repoId);
        results.push(out);
      }
      for (const row of enumVecData) {
        if (results.length >= limit) break;
        const { name, path, projectId: pid, repoId } = toRow(row);
        if (pid !== graphProjectId || !passesRepo(repoId)) continue;
        const pathStr = String(path ?? '');
        const nameStr = String(name ?? '');
        const key = `Enum:${nameStr}:${pathStr}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (skipNoisePath(pathStr)) continue;
        const out: { tipo: string; path: string; name: string; repoId?: string } = {
          tipo: 'Enum',
          path: pathStr,
          name: pathStr ? `${nameStr} — ${pathStr}` : nameStr,
        };
        if (repoId != null && String(repoId)) out.repoId = String(repoId);
        results.push(out);
      }

      return {
        cypher: 'CALL db.idx.vector.queryNodes (semantic search)',
        result: results,
      };
    } catch {
      return { cypher: '', result: [] };
    }
  }

  /**
   * Explica por qué `semantic_search` pudo devolver 0 filas (config, índice vacío o query).
   * @param graphProjectId - `projectId` en Falkor (padre en multi-root).
   * @param repositoryIdForEmbedding - `repositories.id` para el espacio de embeddings (mismo criterio que `semanticSearchFallback`).
   */
  async getSemanticSearchDiagnostics(
    graphProjectId: string,
    repositoryIdForEmbedding?: string,
  ): Promise<string> {
    const embeddingRepoId = repositoryIdForEmbedding ?? graphProjectId;
    const readBinding = await this.embeddingSpaces.getReadBindingForRepository(embeddingRepoId);
    const embed = readBinding.provider;
    if (!embed?.isAvailable()) {
      return 'Diagnóstico: búsqueda semántica no disponible (configura EMBEDDING_PROVIDER + API key y embed-index, o espacio de lectura en Postgres). Mientras tanto usa execute_cypher.';
    }
    const vProp = readBinding.graphProperty;
    try {
      const countFn = await this.cypher.executeCypher(
        graphProjectId,
        `MATCH (n:Function) WHERE n.projectId = $projectId AND n.${vProp} IS NOT NULL RETURN count(n) as c`,
      );
      const countComp = await this.cypher.executeCypher(
        graphProjectId,
        `MATCH (n:Component) WHERE n.projectId = $projectId AND n.${vProp} IS NOT NULL RETURN count(n) as c`,
      );
      const countDoc = await this.cypher.executeCypher(
        graphProjectId,
        `MATCH (n:Document) WHERE n.projectId = $projectId AND n.${vProp} IS NOT NULL RETURN count(n) as c`,
      );
      const countSb = await this.cypher.executeCypher(
        graphProjectId,
        `MATCH (n:StorybookDoc) WHERE n.projectId = $projectId AND n.${vProp} IS NOT NULL RETURN count(n) as c`,
      );
      const countMd = await this.cypher.executeCypher(
        graphProjectId,
        `MATCH (n:MarkdownDoc) WHERE n.projectId = $projectId AND n.${vProp} IS NOT NULL RETURN count(n) as c`,
      );
      const countModel = await this.cypher.executeCypher(
        graphProjectId,
        `MATCH (n:Model) WHERE n.projectId = $projectId AND n.${vProp} IS NOT NULL RETURN count(n) as c`,
      );
      const countEnum = await this.cypher.executeCypher(
        graphProjectId,
        `MATCH (n:Enum) WHERE n.projectId = $projectId AND n.${vProp} IS NOT NULL RETURN count(n) as c`,
      );
      const hasFn = (countFn as Array<{ c?: number }>)?.[0]?.c ?? 0;
      const hasComp = (countComp as Array<{ c?: number }>)?.[0]?.c ?? 0;
      const hasDoc = (countDoc as Array<{ c?: number }>)?.[0]?.c ?? 0;
      const hasSb = (countSb as Array<{ c?: number }>)?.[0]?.c ?? 0;
      const hasMd = (countMd as Array<{ c?: number }>)?.[0]?.c ?? 0;
      const hasModel = (countModel as Array<{ c?: number }>)?.[0]?.c ?? 0;
      const hasEnum = (countEnum as Array<{ c?: number }>)?.[0]?.c ?? 0;
      if (hasFn === 0 && hasComp === 0 && hasDoc === 0 && hasSb === 0 && hasMd === 0 && hasModel === 0 && hasEnum === 0) {
        return 'Diagnóstico: ningún nodo indexable (Function/Component/Document/StorybookDoc/MarkdownDoc/Model/Enum) tiene embedding. Ejecuta POST /repositories/:id/embed-index tras sync.';
      }
      return 'Diagnóstico: hay embeddings pero esta consulta no obtuvo vecinos relevantes; reformula o usa execute_cypher con términos del dominio.';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Diagnóstico: error al comprobar embeddings (${msg}).`;
    }
  }

  private citesGraphData(answer: string, results: unknown[]): boolean {
    if (results.length === 0) return answer.length < 250;
    const rows = results as Array<Record<string, unknown>>;
    const citations = new Set<string>();
    for (const r of rows) {
      for (const v of Object.values(r)) {
        if (typeof v === 'string' && (v.includes('/') || v.includes('.ts') || v.includes('.tsx'))) {
          citations.add(v);
        }
      }
    }
    return citations.size > 0 && [...citations].some((c) => answer.includes(c));
  }

  private extractCypher(text: string): string | null {
    const fenced = text.match(/```(?:cypher)?\s*([\s\S]*?)```/);
    if (fenced) return fenced[1].trim();
    const singleLine = text.match(/^MATCH\s[\s\S]+$/m);
    if (singleLine) return singleLine[0].trim();
    return null;
  }

  async answerProjectOverview(repositoryId: string, message: string): Promise<string> {
    const repo = await this.repos.findOne(repositoryId);
    const projectId = await this.resolveProjectIdForRepo(repo.id);

    const summary = await this.cypher.getGraphSummary(repositoryId, true, true);
    const routes = await this.cypher.executeCypher(
      projectId,
      `MATCH (r:Route) WHERE r.projectId = $projectId AND r.repoId = $repoId RETURN r.path as path, r.componentName as component ORDER BY r.path`,
      { repoId: repositoryId },
    ) as Array<{ path: string; component?: string }>;
    const components = (summary.samples['Component'] ?? []) as Array<{ name: string }>;
    const files = (summary.samples['File'] ?? []) as Array<{ path: string }>;

    let readme = '';
    for (const p of ['README.md', 'README.MD', 'readme.md']) {
      const content = await this.fileContent.getFileContentSafe(repositoryId, p);
      if (content) {
        readme = content.slice(0, 3000);
        break;
      }
    }

    const context = `
Proyecto: ${repo.projectKey}/${repo.repoSlug}
Conteos: ${JSON.stringify(summary.counts)}
Rutas: ${routes.map((r) => `${r.path} → ${r.component ?? ''}`).join(', ') || 'ninguna'}
Componentes (muestra): ${components.map((c) => c.name).join(', ') || 'ninguno'}
Archivos (muestra): ${files.map((f) => f.path).join(', ') || 'ninguno'}
${readme ? `\nREADME (inicio):\n${readme}` : ''}
`;

    const systemPrompt = `## Rol
Eres un analista que resume qué hace un proyecto según su estructura (rutas, componentes, README).

## Instrucciones
- Infiere función del software solo a partir de: rutas, componentes, README.
- Sé conciso. 2-4 párrafos breves.
- Si no hay suficiente info, dilo explícitamente.

## Restricciones
- PROHIBIDO inventar características no sugeridas por la estructura.
- En español.`;
    const answer = await this.llm.callLlm(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Contexto:\n${context}\n\nPregunta: ${message}` },
      ],
      1024,
    );
    return answer;
  }

  async answerTiposOpciones(repositoryId: string, message: string): Promise<string> {
    const projectId = (await this.repos.findOne(repositoryId)).id;

    if (this.isWhyMissingQuestion(message)) {
      const conceptRaw = this.extractMissingConcept(message) ?? message.replace(/^.*(?:de |la |el )/i, '').replace(/[?!.]/g, '').trim();
      const conceptTerms = conceptRaw.split(/\s+/).filter((w) => w.length >= 3) as string[];
      if (conceptTerms.length > 0) {
        const found: string[] = [];
        const dcRows = (await this.cypher.executeCypher(
          projectId,
          `MATCH (dc:DomainConcept) WHERE dc.projectId = $projectId
           AND (dc.name CONTAINS $t0 OR dc.description CONTAINS $t0 OR dc.sourcePath CONTAINS $t0
             ${conceptTerms.length > 1 ? `OR dc.name CONTAINS $t1 OR dc.description CONTAINS $t1` : ''})
           RETURN dc.name as name, dc.category as category, dc.description as description, dc.sourcePath as sourcePath`,
          conceptTerms.length > 1 ? { projectId, t0: conceptTerms[0], t1: conceptTerms[1] } : { projectId, t0: conceptTerms[0] },
        )) as Array<{ name: string; category?: string; sourcePath?: string }>;
        for (const r of dcRows) found.push(`**${r.name}** (${r.category ?? 'concepto'}) en \`${r.sourcePath ?? ''}\``);
        const compRows = (await this.cypher.executeCypher(
          projectId,
          `MATCH (c:Component) WHERE c.projectId = $projectId AND (c.name CONTAINS $t0 OR c.description CONTAINS $t0)
           RETURN c.name as name, c.description as description`,
          { projectId, t0: conceptTerms[0] },
        )) as Array<{ name: string; description?: string | null }>;
        for (const r of compRows) found.push(`Componente **${r.name}**: ${(r.description ?? '').slice(0, 80)}…`);
        const fileRows = (await this.cypher.executeCypher(
          projectId,
          `MATCH (f:File) WHERE f.projectId = $projectId AND f.path CONTAINS $t0 RETURN f.path as path`,
          { projectId, t0: conceptTerms[0] },
        )) as Array<{ path: string }>;
        for (const r of fileRows) found.push(`Archivo \`${r.path}\``);
        const opts = conceptTerms.join(' ');
        if (found.length > 0) {
          return `## ¿Existe "${opts}"?\n\nSí, encontré referencias en el grafo:\n\n${found.map((f) => `- ${f}`).join('\n')}`;
        }
        const camel = conceptTerms.map((t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()).join('');
        return `## ¿Existe "${opts}"?\n\nNo encontré referencias a "${opts}" en el grafo de dominio ni en componentes. Posibles razones:\n- Usa otro nombre en el código (ej. \`${camel}\`, \`${conceptTerms.join('_').toUpperCase()}\`)\n- No está indexado aún (ejecuta sync/resync del proyecto)\n- Puede estar en constantes/enums sin extraer como DomainConcept`;
      }
    }

    const terms = extractSearchTerms(message);
    const term = terms.length > 0 ? terms.find((t) => ['cotizacion', 'cotizaciones', 'cotizador', 'medios', 'tipos'].includes(t)) ?? terms[terms.length - 1] : 'cotizador';
    const termCap = term.charAt(0).toUpperCase() + term.slice(1);

    const allDomainConcepts = (await this.cypher.executeCypher(
      projectId,
      `MATCH (dc:DomainConcept) WHERE dc.projectId = $projectId
       RETURN dc.name as name, dc.category as category, dc.description as description, dc.options as options, dc.sourcePath as sourcePath
       ORDER BY dc.category, dc.name`,
      { projectId },
    )) as Array<{ name: string; category?: string; description?: string | null; options?: string[]; sourcePath?: string }>;

    const cotizadorKeywords = ['renta', 'bonus', 'plaza', 'medio', 'brand', 'cotizador', 'vallas', 'urbano', 'indoor', 'extra', 'produccion', 'comision', 'template', 'view'];
    const domainConcepts = allDomainConcepts.filter((dc) => {
      const name = (dc.name ?? '').toLowerCase();
      if (dc.category === 'tipo') return true;
      if (name.includes('api_fields') || name.includes('_style') || name.includes('_options') || name.endsWith('style')) return false;
      return cotizadorKeywords.some((k) => name.includes(k));
    });
    const toUse = domainConcepts.length >= 5 ? domainConcepts : (domainConcepts.length > 0 ? domainConcepts : allDomainConcepts.slice(0, 50));

    if (toUse.length > 0) {
      const conceptLines = toUse.map((dc) => {
        const optsArr = normalizeOptions(dc.options);
        const opts = optsArr.length > 0 ? ` (${optsArr.join(', ')})` : '';
        const desc = dc.description?.trim() ? `: ${dc.description.slice(0, 80)}…` : opts;
        return `- **${dc.name}**${desc}`;
      });
      const fromGraph = `### Referencia (conceptos indexados)\n${conceptLines.join('\n')}`;

      const paths = Array.from(new Set(toUse.map((dc) => dc.sourcePath).filter(Boolean))) as string[];
      const pathPriority = (p: string) => {
        const l = p.toLowerCase();
        if (l.includes('constants') || l.includes('types') || l.includes('config')) return 3;
        if (l.includes('cotizador') || l.includes('renta') || l.includes('bonus')) return 2;
        return 1;
      };
      const sortedPaths = [...paths].sort((a, b) => pathPriority(b) - pathPriority(a));
      const MAX_CHARS_TOTAL = 80000;
      const MAX_CHARS_PER_FILE = 10000;
      let totalChars = 0;
      const codeBlocks: string[] = [];
      for (const path of sortedPaths) {
        if (totalChars >= MAX_CHARS_TOTAL) break;
        const content = await this.fileContent.getFileContentSafe(repositoryId, path);
        if (content) {
          const budgetLeft = MAX_CHARS_TOTAL - totalChars;
          const snippet = content.length > MAX_CHARS_PER_FILE
            ? content.slice(0, Math.min(MAX_CHARS_PER_FILE, budgetLeft)) + '\n\n...[truncado]'
            : content.slice(0, budgetLeft);
          codeBlocks.push(`## ${path}\n\`\`\`\n${snippet}\n\`\`\``);
          totalChars += (codeBlocks[codeBlocks.length - 1]?.length ?? 0);
        }
      }

      if (toUse.length >= 1) {
        const systemPrompt = `## Rol
Experto en dominio de cotizadores publicitarios. Analizas CÓDIGO FUENTE y extraes los tipos de cotización.

## Instrucciones
- Analiza el código que te proporciono. Extrae enums, constantes, tipos TS, switches que definan opciones/tipos de cotización.
- Explica cada tipo según lo que dice el código (valores, usos, relaciones).
- Agrupa por familias (Brand Rider, Medios fijos, Bonus, etc.).
- Cita nombres de variables/funciones del código cuando sea relevante.
- Prosa fluida. 300-500 palabras.

## Restricciones
- Extrae SOLO lo que está en el código. No inventes tipos no definidos.
- PROHIBIDO listar solo nombres sin explicar. Responde en prosa.
- En español.`;

        const codeSection = codeBlocks.length > 0 ? `### Código fuente (archivos con definiciones)\n\n${codeBlocks.join('\n\n')}\n\n` : '';
        const userPrompt = `${fromGraph}\n\n${codeSection}---\n\nPregunta: "${message}"\n\nAnaliza el código anterior y extrae los tipos de cotización que se pueden hacer. Explica cada uno según lo que define el código (enums, constantes, tipos). En español.`;
        const answer = await this.llm.callLlm(
          [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
          2048,
        );
        return `## Tipos de cotizaciones según el código\n\n${answer}`;
      }
    }

    const components = (await this.cypher.executeCypher(
      projectId,
      `MATCH (c:Component) WHERE c.projectId = $projectId
       AND (c.name CONTAINS 'Cotizador' OR c.name CONTAINS 'cotizador'
         OR c.name CONTAINS 'BrandRider' OR c.name CONTAINS 'Renta' OR c.name CONTAINS 'Bonus'
         OR c.name CONTAINS 'Medio' OR c.name CONTAINS 'Plaza' OR c.name CONTAINS 'Extra'
         OR c.name CONTAINS 'Produccion' OR c.name CONTAINS 'Comision')
       RETURN c.name as name, c.description as description
       ORDER BY c.name`,
      {},
    )) as Array<{ name: string; description?: string | null }>;
    const componentInfo = Array.from(new Map(components.map((c) => [c.name, c])).values()).filter((c) => c.name);

    const rows = (await this.cypher.executeCypher(
      projectId,
      `MATCH (fn:Function) WHERE fn.projectId = $projectId
       AND (fn.path CONTAINS $term OR fn.path CONTAINS $termCap
         OR fn.name CONTAINS $term OR fn.name CONTAINS $termCap
         OR fn.path CONTAINS 'cotizador' OR fn.path CONTAINS 'Cotizador'
         OR fn.path CONTAINS 'cotizacion' OR fn.path CONTAINS 'Cotizacion'
         OR fn.name CONTAINS 'tipoVista' OR fn.name CONTAINS 'tipo' OR fn.name CONTAINS 'Config')
       RETURN fn.path as path, fn.name as name
       ORDER BY fn.path, fn.name`,
      { term, termCap },
    )) as Array<{ path: string; name: string }>;

    const uniqueByPath = Array.from(new Map(rows.map((r) => [r.path, r])).values()).filter((r) => r.path);
    const prioritizer = (r: { path: string }) =>
      [r.path.includes('constants'), r.path.includes('config'), r.path.includes('Cotizador'), r.path.includes('tipo')].filter(Boolean).length;
    const pathsByRelevance = [...uniqueByPath].sort((a, b) => prioritizer(b) - prioritizer(a)).slice(0, 8);

    if (pathsByRelevance.length === 0 && componentInfo.length === 0) {
      return `No encontré archivos ni componentes relacionados con "${term}". Prueba con otro término (ej. cotizador, cotizaciones, medios).`;
    }

    const MAX_CHARS = 8000;
    const fileSnippets: string[] = [];
    if (componentInfo.length > 0) {
      const compLines = componentInfo
        .map((c) => {
          const desc = c.description?.trim();
          return desc ? `- **${c.name}**: ${desc.slice(0, 120)}${desc.length > 120 ? '…' : ''}` : `- **${c.name}**`;
        })
        .join('\n');
      fileSnippets.push(`### Componentes del cotizador (con JSDoc si existe):\n${compLines}`);
    }
    for (const { path } of pathsByRelevance.slice(0, 6)) {
      const content = await this.fileContent.getFileContentSafe(repositoryId, path);
      if (content) {
        const snippet = content.length > MAX_CHARS ? content.slice(0, MAX_CHARS) + '\n...[truncado]' : content;
        fileSnippets.push(`## ${path}\n\`\`\`\n${snippet}\n\`\`\``);
      }
    }

    const hasFileContent = fileSnippets.some((s) => s.startsWith('## ') && s.includes('```'));
    if (!hasFileContent && componentInfo.length === 0) {
      return `Encontré archivos (${pathsByRelevance.map((p) => p.path).join(', ')}) pero no pude leer su contenido. Revisa el acceso al repo.`;
    }

    const systemPrompt = `## Rol
Eres un analista de dominio que extrae TIPOS de cotizaciones del código.

## Instrucciones
- Solo tipos EXPLÍCITOS en el código: enums, constantes, tipos TS, switches, keys.
- Por cada tipo: nombre + 1-2 frases (qué es, para qué sirve).
- Agrupa por familias si el código lo indica.

## Restricciones
- PROHIBIDO inventar tipos no vistos en el código.
- PROHIBIDO listar archivos o nombres de funciones.
- Si no encuentras tipos claros, dilo explícitamente.
- En español.`;

    const userPrompt = `Contexto del codebase:\n\n${fileSnippets.join('\n\n')}\n\n---\n\nPregunta: "${message}"\n\nExtrae del código los tipos de cotizaciones que veas definidos (enums, constantes, tipos). Explica cada uno brevemente. Solo incluye lo que encuentres explícitamente. En español.`;

    const answer = await this.llm.callLlm(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      2048,
    );
    return `## Tipos de cotizaciones según el código\n\n${answer}`;
  }

  async answerCalculoAlgoritmo(repositoryId: string, message: string): Promise<string> {
    const terms = extractSearchTerms(message);
    const seedTerms = ['calcular', 'precio', 'precios', 'dias', 'horas', 'mes', 'actualizar', 'calculo', 'cotizador'];
    const searchTerms = [...new Set([...terms.filter((t) => t.length >= 4), ...seedTerms])].slice(0, 6);
    const projectId = (await this.repos.findOne(repositoryId)).id;

    const safeTerms =
      searchTerms.filter((t) => /^[\wáéíóúñ]+$/i.test(t)).length > 0
        ? searchTerms.filter((t) => /^[\wáéíóúñ]+$/i.test(t)).slice(0, 8)
        : ['calcular', 'precio', 'dias', 'horas', 'mes'];
    const params: Record<string, string> = { projectId };
    safeTerms.forEach((t, i) => {
      params[`t${i}`] = t;
      params[`t${i}Cap`] = t.charAt(0).toUpperCase() + t.slice(1);
    });
    const orParts = safeTerms.flatMap((_, i) => [
      `fn.name CONTAINS $t${i}`,
      `fn.name CONTAINS $t${i}Cap`,
      `fn.description CONTAINS $t${i}`,
      `fn.path CONTAINS $t${i}`,
      `fn.path CONTAINS $t${i}Cap`,
    ]);
    const orClause = `AND (${orParts.join(' OR ')})`;
    const rows = (await this.cypher.executeCypher(
      projectId,
      `MATCH (fn:Function) WHERE fn.projectId = $projectId ${orClause}
       RETURN fn.path as path, fn.name as name, fn.description as description
       ORDER BY fn.path, fn.name`,
      params,
    )) as Array<{ path: string; name: string; description?: string | null }>;

    const uniqueByPath = Array.from(new Map(rows.map((r) => [r.path, r])).values()).filter((r) => r.path);
    const prioritizer = (r: { path: string }) =>
      [r.path.includes('.handlers'), r.path.includes('.utils'), r.path.includes('calcular'), r.path.includes('precio')].filter(Boolean).length;
    const pathsByRelevance = [...uniqueByPath].sort((a, b) => prioritizer(b) - prioritizer(a)).slice(0, 6);

    if (pathsByRelevance.length === 0) {
      return `No encontré funciones relacionadas con cálculos o precios. Prueba con términos como "precio", "días", "horas", "calcular".`;
    }

    const MAX_CHARS = 12000;
    const fileSnippets: string[] = [];
    for (const { path, name, description } of pathsByRelevance) {
      const content = await this.fileContent.getFileContentSafe(repositoryId, path);
      if (content) {
        const snippet = content.length > MAX_CHARS ? content.slice(0, MAX_CHARS) + '\n...[truncado]' : content;
        const header = description?.trim() ? `## ${path} (${name}: ${description.slice(0, 80)}…)` : `## ${path}`;
        fileSnippets.push(`${header}\n\`\`\`\n${snippet}\n\`\`\``);
      }
    }

    if (fileSnippets.length === 0) {
      return `Encontré archivos (${pathsByRelevance.map((p) => p.path).join(', ')}) pero no pude leer su contenido.`;
    }

    const systemPrompt = `## Rol
Eres un analista que extrae CÁLCULOS y FÓRMULAS del código para que alguien pueda replicarlos.

## Instrucciones
1. Extrae fórmulas específicas: operaciones, condiciones (if/switch), orden.
2. Por modalidad (días, horas, mes): qué se calcula, con qué variables. Ej: "Para días: precioBase * cantidadDias * tarifaHora".
3. Incluye nombres de variables/funciones relevantes para replicación.
4. Menciona constantes o configuraciones que afectan el resultado.

## Restricciones
- PROHIBIDO listar rutas de archivos. Solo fórmulas y lógica en prosa.
- 300-600 palabras. En español.`;

    const userPrompt = `Código relevante:\n\n${fileSnippets.join('\n\n')}\n\n---\n\nPregunta: "${message}"\n\nExtrae los cálculos específicos que se hacen cuando es por días, horas y mes. Incluye fórmulas, condiciones y pasos para poder replicarlos. En prosa clara, sin listar archivos.`;

    const answer = await this.llm.callLlm(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      2048,
    );
    return `## Cómo se calcula (según el código)\n\n${answer}`;
  }

  async answerHowImplemented(
    repositoryId: string,
    message: string,
  ): Promise<HandlerResponse> {
    const terms = extractSearchTerms(message);
    if (terms.length === 0) {
      return { answer: 'Indica el nombre del componente, archivo o feature (ej. "login", "Header", "auth").' };
    }
    const primaryTerm = terms[terms.length - 1];
    const termsToTry = getSearchTermsWithSynonyms(primaryTerm);
    const projectId = (await this.repos.findOne(repositoryId)).id;

    let files: Array<{ path: string }> = [];
    let componentsByName: Array<{ name: string }> = [];
    let term = primaryTerm;
    let termCap = primaryTerm.charAt(0).toUpperCase() + primaryTerm.slice(1);

    for (const t of termsToTry) {
      const cap = t.charAt(0).toUpperCase() + t.slice(1);
      files = (await this.cypher.executeCypher(
        projectId,
        `MATCH (f:File) WHERE f.projectId = $projectId AND (f.path CONTAINS $term OR f.path CONTAINS $termCap) RETURN f.path as path ORDER BY f.path`,
        { term: t, termCap: cap },
      )) as Array<{ path: string }>;
      componentsByName = (await this.cypher.executeCypher(
        projectId,
        `MATCH (c:Component) WHERE c.projectId = $projectId AND (c.name CONTAINS $term OR c.name CONTAINS $termCap) RETURN c.name as name`,
        { term: t, termCap: cap },
      )) as Array<{ name: string }>;
      const compNames = new Set(componentsByName.map((c) => c.name));
      const filePaths = new Set(files.map((f) => f.path));
      if (filePaths.size > 0 || compNames.size > 0) {
        term = t;
        termCap = cap;
        break;
      }
    }

    const compNames = new Set(componentsByName.map((c) => c.name));
    const filePaths = new Set(files.map((f) => f.path));
    if (filePaths.size === 0 && compNames.size === 0) {
      return {
        answer: `No encontré archivos ni componentes relacionados con "${primaryTerm}". Prueba con "auth", "signin" u otro término del dominio.`,
      };
    }

    const mainCypher = `MATCH (f:File) WHERE f.projectId = $projectId AND (f.path CONTAINS $term OR f.path CONTAINS $termCap) RETURN f.path as path ORDER BY f.path`;
    const cypherDisplay = mainCypher.replace(/\$term/g, `'${term}'`).replace(/\$termCap/g, `'${termCap}'`).replace(/\$projectId/g, '$projectId');

    const sections: string[] = [];
    if (files.length > 0) sections.push(`### Archivos\n${files.map((f) => `- \`${f.path}\``).join('\n')}`);

    const allComponents: Array<{ path: string; name: string }> = [];
    if (filePaths.size > 0) {
      const compsInFiles = (await this.cypher.executeCypher(
        projectId,
        `MATCH (f:File)-[:CONTAINS]->(c:Component) WHERE f.projectId = $projectId AND (f.path CONTAINS $term OR f.path CONTAINS $termCap) RETURN f.path as path, c.name as name`,
        { term, termCap },
      )) as Array<{ path: string; name: string }>;
      for (const c of compsInFiles) {
        allComponents.push(c);
        compNames.add(c.name);
      }
    }
    for (const c of componentsByName) {
      const inFile = (await this.cypher.executeCypher(
        projectId,
        `MATCH (f:File)-[:CONTAINS]->(c:Component {name: $name, projectId: $projectId}) RETURN f.path as path LIMIT 1`,
        { name: c.name, projectId },
      )) as Array<{ path: string }>;
      if (inFile.length) allComponents.push({ path: inFile[0].path, name: c.name });
    }

    const routes = (await this.cypher.executeCypher(
      projectId,
      `MATCH (r:Route) WHERE r.projectId = $projectId AND (r.path CONTAINS $term OR r.componentName CONTAINS $term OR r.path CONTAINS $termCap OR r.componentName CONTAINS $termCap)
       RETURN r.path as path, r.componentName as component ORDER BY r.path`,
      { term, termCap },
    )) as Array<{ path: string; component: string }>;

    const funcs = filePaths.size > 0
      ? ((await this.cypher.executeCypher(
          projectId,
          `MATCH (f:File)-[:CONTAINS]->(fn:Function) WHERE f.projectId = $projectId AND (f.path CONTAINS $term OR f.path CONTAINS $termCap)
           RETURN f.path as path, fn.name as name, fn.description as description ORDER BY f.path, fn.name`,
          { term, termCap },
        )) as Array<{ path: string; name: string; description?: string | null }>)
      : [];

    const compDetails: string[] = [];
    const seenComp = new Set<string>();
    for (const { path: compPath, name: compName } of allComponents) {
      if (seenComp.has(compName)) continue;
      seenComp.add(compName);

      const props = (await this.cypher.executeCypher(
        projectId,
        `MATCH (c:Component {name: $name, projectId: $projectId})-[:HAS_PROP]->(p:Prop) RETURN p.name as name, p.required as required`,
        { name: compName, projectId },
      )) as Array<{ name: string; required: boolean }>;

      const hooks = (await this.cypher.executeCypher(
        projectId,
        `MATCH (c:Component {name: $name, projectId: $projectId})-[:USES_HOOK]->(h:Hook) RETURN h.name as name`,
        { name: compName, projectId },
      )) as Array<{ name: string }>;

      const renders = (await this.cypher.executeCypher(
        projectId,
        `MATCH (c:Component {name: $name, projectId: $projectId})-[:RENDERS]->(child:Component) RETURN child.name as name`,
        { name: compName, projectId },
      )) as Array<{ name: string }>;

      const parts: string[] = [];
      if (props.length) parts.push(`Props: ${props.map((p) => `${p.name}${p.required ? ' (requerida)' : ''}`).join(', ')}`);
      if (hooks.length) parts.push(`Hooks: ${hooks.map((h) => h.name).join(', ')}`);
      if (renders.length) parts.push(`Renderiza: ${renders.map((r) => r.name).join(', ')}`);

      compDetails.push(`- **${compName}** (\`${compPath}\`)${parts.length ? `\n  ${parts.join(' | ')}` : ''}`);
    }

    if (compDetails.length) sections.push(`### Componentes\n${compDetails.join('\n')}`);
    if (routes.length) sections.push(`### Puntos de entrada (rutas)\n${routes.map((r) => `- \`${r.path}\` → ${r.component}`).join('\n')}`);
    if (funcs.length) {
      const byPath = new Map<string, string[]>();
      for (const f of funcs) {
        if (!byPath.has(f.path)) byPath.set(f.path, []);
        const desc = f.description ? ` — ${String(f.description).slice(0, 60)}…` : '';
        byPath.get(f.path)!.push(`${f.name}${desc}`);
      }
      sections.push(`### Funciones\n${Array.from(byPath.entries()).map(([path, names]) => `- \`${path}\`: ${names.join(', ')}`).join('\n')}`);
    }

    const dataBlock = sections.join('\n\n');
    let humanSummary = '';
    try {
      humanSummary = await this.llm.callLlm(
        [
          {
            role: 'system',
            content:
              'Rol: explicador técnico. Tarea: explica en 2-4 oraciones CÓMO funciona el proceso/feature, en prosa legible. Si hay pipeline (A → B → C), descríbelo. NO repitas listas de archivos; abstrae el flujo. En español.',
          },
          { role: 'user', content: `Feature/proceso: "${term}"\n\nDatos del grafo (archivos, componentes, funciones):\n${dataBlock}\n\n---\nExplica en prosa cómo funciona.` },
        ],
        250,
      );
      humanSummary = humanSummary.trim() ? `${humanSummary.trim()}\n\n` : '';
    } catch {
      /* no-op */
    }

    const cypherBlock = `\n\`\`\`cypher\n${cypherDisplay}\n\`\`\`\n`;
    const answer = `${humanSummary}## Cómo está implementado "${term}"\n\n${dataBlock}\n\n### Cypher ejecutado${cypherBlock}`;

    return {
      answer,
      cypher: mainCypher,
      result: files.map((f) => ({ path: f.path })),
    };
  }

  async runExplorerReAct(
    repositoryId: string,
    projectId: string,
    message: string,
    historyContent?: string,
    explorerContext: 'code_analysis' | 'knowledge' = 'code_analysis',
  ): Promise<HandlerResponse> {
    const tools = explorerContext === 'knowledge' ? getExplorerToolsKnowledge() : EXPLORER_TOOLS_ALL;

    const planStep =
      explorerContext === 'knowledge'
        ? 'Plan (máx 3 pasos): 1) DomainConcept/execute_cypher → 2) get_file_content en sourcePath → 3) Sintetiza. OBLIGATORIO usar get_file_content para tipos/opciones/algoritmos.'
        : 'Plan: ¿Qué información necesito? (Cypher, file, semantic). Ejecuta plan (máx 3 pasos). Sintetiza.';

    const explorerSystem = `<instrucciones>
Eres un experto en explorar codebases. Plan-then-Execute: ${planStep}

<patron_react>
Thought → Action (tool) → Observation. Máx 3 turnos. Si tras 3 turnos no hay respuesta útil, resume lo encontrado y sugiere consultar el índice o ampliar búsqueda.
</patron_react>
</instrucciones>

<tipos_pregunta>
- **Tipos de cotizaciones / opciones en cotizador** ("qué tipos de cotizaciones", "qué se puede hacer con el cotizador"): 1) MATCH (dc:DomainConcept) para obtener conceptos de dominio (Renta, Bonus, etc.). 2) Si hay sourcePath, get_file_content en esos archivos. 3) NO uses solo "tipo" en Cypher — es ambiguo; usa cotizador, cotizacion, renta, bonus, config.
- **Cálculos/algoritmo** ("cómo funciona X", "lógica de"): buscar → get_file_content → resumir.
- **Exploratorio** ("utilidades de X"): semantic_search primero; si no hay embeddings, execute_cypher.
- **Estructural** ("archivos con X", "funciones no usadas"): execute_cypher.
</tipos_pregunta>

<restricciones>
- FalkorDB NO soporta NOT EXISTS; usa OPTIONAL MATCH + count(x)=0.
- Toda Cypher debe filtrar con projectId = $projectId.
- Responde en español, markdown (listas, negritas).
- **Síntesis obligatoria:** Si preguntan CÓMO funciona/hace algo (ingesta, sync, proceso), explica en PROSA legible (2-4 oraciones). PROHIBIDO devolver listas crudas de archivos/funciones; sintetiza el flujo.
</restricciones>

<schema_cypher>
${SCHEMA}${EXAMPLES}
</schema_cypher>`;

    const userContent = historyContent ? `${historyContent}\n\n<user>${message}</user>` : `<user>${message}</user>`;

    const messages: Array<
      | { role: 'user' | 'system'; content: string }
      | { role: 'assistant'; content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }
      | { role: 'tool'; tool_call_id: string; content: string }
    > = [
      { role: 'system', content: explorerSystem },
      { role: 'user', content: userContent },
    ];

    let lastCypher = '';
    let collectedResults: unknown[] = [];
    const MAX_TURNS = 3;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const resp = await this.llm.callLlmWithTools(messages, tools);

      if (resp.content) {
        const formatted = collectedResults.length > 0
          ? this.cypher.formatResultsHuman(collectedResults as Record<string, unknown>[], collectedResults.length)
          : '';
        let answer = formatted ? `Encontré ${collectedResults.length} resultado(s):\n\n${formatted}\n\n---\n${resp.content}` : resp.content;

        if (explorerContext === 'knowledge' && turn < MAX_TURNS - 1 && !this.citesGraphData(answer, collectedResults)) {
          messages.push(
            { role: 'assistant', content: resp.content },
            { role: 'user', content: 'La respuesta debe citar paths del grafo. OBLIGATORIO usar get_file_content en sourcePath. PROHIBIDO inventar.' },
          );
          continue;
        }

        return { answer, cypher: lastCypher || undefined, result: collectedResults.length > 0 ? collectedResults : undefined };
      }

      if (!resp.tool_calls?.length) break;

      for (const tc of resp.tool_calls) {
        const fn = tc.function;
        let toolResult: string;
        try {
          if (fn.name === 'execute_cypher') {
            const args = JSON.parse(fn.arguments) as { cypher: string };
            const cypher = args.cypher?.trim();
            if (!cypher) {
              toolResult = 'Error: cypher vacío';
            } else {
              lastCypher = cypher;
              const rows = await this.cypher.executeCypher(projectId, cypher);
              if (rows.length === 0) {
                const critique = await this.llm.callLlm(
                  [
                    { role: 'system', content: 'Rol: analista de consultas. Tarea: 1-2 oraciones sobre por qué la Cypher devolvió 0. Considera: filtros restrictivos, nombres incorrectos, variantes (mayúsculas). Sin explicaciones largas.' },
                    { role: 'user', content: `Pregunta: "${message}"\nCypher:\n${cypher}\n¿Por qué falló?` },
                  ],
                  128,
                );
                toolResult = `0 resultados. Crítica: ${critique}\nPrueba semantic_search o otra Cypher (términos más amplios).`;
              } else {
                collectedResults = rows;
                toolResult = `Resultados (${rows.length} filas):\n${this.cypher.formatResultsHuman(rows as Record<string, unknown>[], rows.length)}`;
              }
            }
          } else if (fn.name === 'semantic_search') {
            const args = JSON.parse(fn.arguments) as { query: string };
            const q = args.query?.trim() || message;
            const semantic = await this.semanticSearchFallback(projectId, q, 15, repositoryId, undefined);
            if (semantic.result.length > 0) {
              collectedResults = semantic.result;
              toolResult = `Búsqueda semántica encontró ${semantic.result.length} resultados:\n${this.cypher.formatResultsHuman(semantic.result as Record<string, unknown>[], semantic.result.length)}`;
            } else {
              toolResult = 'Búsqueda semántica no encontró resultados (puede no haber embed-index). Prueba execute_cypher con CONTAINS.';
            }
          } else if (fn.name === 'get_graph_summary') {
            const summary = await this.cypher.getGraphSummary(repositoryId, true, true);
            toolResult = `Conteos: ${JSON.stringify(summary.counts)}. Muestras: ${JSON.stringify(summary.samples, null, 2).slice(0, 1500)}...`;
          } else if (fn.name === 'get_file_content') {
            const args = JSON.parse(fn.arguments) as { path: string };
            const p = args.path?.trim();
            if (!p) {
              toolResult = 'Error: path vacío';
            } else {
              const content = await this.fileContent.getFileContentSafe(repositoryId, p);
              if (!content) {
                toolResult = `No se pudo leer el archivo \`${p}\` (no existe o sin acceso).`;
              } else {
                const MAX_CHARS = 14000;
                const truncated = content.length > MAX_CHARS;
                const snippet = truncated ? content.slice(0, MAX_CHARS) + '\n\n...[truncado]' : content;
                toolResult = `Contenido de \`${p}\`:\n\n\`\`\`\n${snippet}\n\`\`\`${truncated ? `\n\n(archivo largo, mostrando primeros ${MAX_CHARS} caracteres)` : ''}`;
              }
            }
          } else {
            toolResult = `Herramienta desconocida: ${fn.name}`;
          }
        } catch (err) {
          toolResult = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }

        messages.push(
          { role: 'assistant', content: null, tool_calls: [tc] },
          { role: 'tool', tool_call_id: tc.id, content: toolResult },
        );
      }
    }

    const formatted = collectedResults.length > 0
      ? this.cypher.formatResultsHuman(collectedResults as Record<string, unknown>[], collectedResults.length)
      : '';
    return {
      answer: formatted || 'No encontré resultados. Prueba con otro término o revisa "Ver índice FalkorDB".',
      cypher: lastCypher || undefined,
      result: collectedResults.length > 0 ? collectedResults : undefined,
    };
  }

}
