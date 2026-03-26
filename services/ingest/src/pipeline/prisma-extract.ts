/**
 * Extrae modelos Prisma, enums y relaciones vía DMMF (@prisma/internals) → Cypher (:Model, :Enum, RELATES_TO).
 */
import { getDMMF } from '@prisma/internals';
import { cypherSafe } from 'ariadne-common';

const KIND_PRISMA = 'prisma';

/**
 * Genera MERGE/relaciones para un schema.prisma ya validado por el motor Prisma.
 */
export async function buildCypherForPrismaSchema(
  schemaPath: string,
  content: string,
  projectId: string,
  repoId: string,
): Promise<string[]> {
  const pid = cypherSafe(projectId);
  const rid = cypherSafe(repoId);
  const path = schemaPath;
  const ext = '.prisma';
  const now = new Date().toISOString();
  const statements: string[] = [];

  statements.push(
    `MERGE (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) ON CREATE SET f.extension = ${cypherSafe(ext)}, f.lastScan = ${cypherSafe(now)} ON MATCH SET f.extension = ${cypherSafe(ext)}, f.lastScan = ${cypherSafe(now)}`,
  );
  statements.push(
    `MATCH (p:Project {projectId: ${pid}}) MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MERGE (p)-[:CONTAINS]->(f)`,
  );

  let doc: Awaited<ReturnType<typeof getDMMF>>;
  try {
    doc = await getDMMF({ datamodel: content });
  } catch {
    return statements;
  }

  const dm = doc.datamodel;

  for (const en of dm.enums ?? []) {
    const desc =
      en.documentation != null && en.documentation.trim()
        ? `, e.description = ${cypherSafe(en.documentation.trim())}`
        : '';
    statements.push(
      `MERGE (e:Enum {path: ${cypherSafe(path)}, name: ${cypherSafe(en.name)}, projectId: ${pid}, repoId: ${rid}}) ON CREATE SET e.source = ${cypherSafe(KIND_PRISMA)}${desc} ON MATCH SET e.source = ${cypherSafe(KIND_PRISMA)}${desc}`,
    );
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (e:Enum {path: ${cypherSafe(path)}, name: ${cypherSafe(en.name)}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:CONTAINS]->(e)`,
    );
  }

  const modelNames = new Set((dm.models ?? []).map((m) => m.name));

  for (const model of dm.models ?? []) {
    const desc =
      model.documentation != null && model.documentation.trim()
        ? `, m.description = ${cypherSafe(model.documentation.trim())}`
        : '';
    statements.push(
      `MERGE (m:Model {path: ${cypherSafe(path)}, name: ${cypherSafe(model.name)}, projectId: ${pid}, repoId: ${rid}}) ON CREATE SET m.source = ${cypherSafe(KIND_PRISMA)}${desc} ON MATCH SET m.source = ${cypherSafe(KIND_PRISMA)}${desc}`,
    );
    statements.push(
      `MATCH (f:File {path: ${cypherSafe(path)}, projectId: ${pid}, repoId: ${rid}}) MATCH (m:Model {path: ${cypherSafe(path)}, name: ${cypherSafe(model.name)}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:CONTAINS]->(m)`,
    );
  }

  for (const model of dm.models ?? []) {
    for (const field of model.fields ?? []) {
      if (field.kind === 'object') {
        const target = field.type;
        if (!modelNames.has(target)) continue;
        statements.push(
          `MATCH (a:Model {path: ${cypherSafe(path)}, name: ${cypherSafe(model.name)}, projectId: ${pid}, repoId: ${rid}}) MATCH (b:Model {path: ${cypherSafe(path)}, name: ${cypherSafe(target)}, projectId: ${pid}, repoId: ${rid}}) MERGE (a)-[:RELATES_TO {field: ${cypherSafe(field.name)}}]->(b)`,
        );
      } else if (field.kind === 'enum') {
        const enName = field.type;
        statements.push(
          `MATCH (modl:Model {path: ${cypherSafe(path)}, name: ${cypherSafe(model.name)}, projectId: ${pid}, repoId: ${rid}}) MATCH (en:Enum {path: ${cypherSafe(path)}, name: ${cypherSafe(enName)}, projectId: ${pid}, repoId: ${rid}}) MERGE (modl)-[:USES_ENUM {field: ${cypherSafe(field.name)}}]->(en)`,
        );
      }
    }
  }

  return statements;
}
