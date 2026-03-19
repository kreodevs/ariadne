/**
 * Servicio de detección de anti-patrones (spaghetti, god functions, imports circulares, etc.).
 */

import { Injectable } from '@nestjs/common';
import { RepositoriesService } from '../repositories/repositories.service';
import { ChatCypherService } from './chat-cypher.service';
import { findImportCycles } from './chat-analysis.utils';

export interface AntipatternsResult {
  spaghetti: Array<{ path: string; name: string; nestingDepth: number; complexity: number; loc: number }>;
  godFunctions: Array<{ path: string; name: string; outCalls: number }>;
  highFanIn: Array<{ path: string; name: string; inCalls: number }>;
  circularImports: Array<[string, string]>;
  overloadedComponents: Array<{ name: string; renderCount: number }>;
}

@Injectable()
export class ChatAntipatternsService {
  constructor(
    private readonly repos: RepositoriesService,
    private readonly cypher: ChatCypherService,
  ) {}

  private async resolveProjectIdForRepo(repoId: string): Promise<string> {
    const ids = await this.repos.getProjectIdsForRepo(repoId);
    return ids[0] ?? repoId;
  }

  async detectAntipatterns(repositoryId: string): Promise<AntipatternsResult> {
    const repo = await this.repos.findOne(repositoryId);
    const projectId = await this.resolveProjectIdForRepo(repo.id);

    const spaghetti = (await this.cypher.executeCypher(
      projectId,
      `MATCH (fn:Function) WHERE fn.projectId = $projectId AND fn.nestingDepth > 4
       RETURN fn.path as path, fn.name as name, fn.nestingDepth as nestingDepth, fn.complexity as complexity, fn.loc as loc
       ORDER BY fn.nestingDepth DESC`,
    )) as Array<{ path: string; name: string; nestingDepth?: number; complexity?: number; loc?: number }>;

    const godFunctions = (await this.cypher.executeCypher(
      projectId,
      `MATCH (a:Function)-[:CALLS]->(b:Function) WHERE a.projectId = $projectId AND b.projectId = $projectId
       WITH a, count(b) as outCalls WHERE outCalls > 8
       RETURN a.path as path, a.name as name, outCalls ORDER BY outCalls DESC`,
    )) as Array<{ path: string; name: string; outCalls: number }>;

    const highFanIn = (await this.cypher.executeCypher(
      projectId,
      `MATCH (caller:Function)-[:CALLS]->(fn:Function) WHERE fn.projectId = $projectId AND caller.projectId = $projectId
       WITH fn, count(caller) as inCalls WHERE inCalls > 5
       RETURN fn.path as path, fn.name as name, inCalls ORDER BY inCalls DESC`,
    )) as Array<{ path: string; name: string; inCalls: number }>;

    const imports = (await this.cypher.executeCypher(
      projectId,
      `MATCH (a:File)-[:IMPORTS]->(b:File) WHERE a.projectId = $projectId AND b.projectId = $projectId
       RETURN a.path as fromPath, b.path as toPath`,
    )) as Array<{ fromPath: string; toPath: string }>;
    const circularImports = findImportCycles(imports);

    const overloadedComponents = (await this.cypher.executeCypher(
      projectId,
      `MATCH (c:Component)-[:RENDERS]->(child:Component) WHERE c.projectId = $projectId AND child.projectId = $projectId
       WITH c, count(child) as renderCount WHERE renderCount > 8
       RETURN c.name as name, renderCount ORDER BY renderCount DESC`,
    )) as Array<{ name: string; renderCount: number }>;

    return {
      spaghetti: spaghetti.filter((r) => r.nestingDepth != null).map((r) => ({
        path: r.path,
        name: r.name,
        nestingDepth: r.nestingDepth ?? 0,
        complexity: r.complexity ?? 0,
        loc: r.loc ?? 0,
      })),
      godFunctions,
      highFanIn,
      circularImports,
      overloadedComponents,
    };
  }
}
