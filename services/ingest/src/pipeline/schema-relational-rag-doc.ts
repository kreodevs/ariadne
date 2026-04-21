/**
 * Documento sintético :MarkdownDoc por repo/proyecto: texto orientado a preguntas de esquema relacional
 * para RAG (embed-index vectoriza `documentationText`). Path reservado bajo `ariadne-internal/`.
 */
import { getDMMF } from '@prisma/internals';
import { cypherSafe } from 'ariadne-common';
import type { ParsedFile } from './parser';
import { listOpenApiOperations } from './openapi-spec-ingest';
import { STORYBOOK_MAX_EMBED_CHARS } from './storybook-documentation';

/** Path virtual (no existe en el repo); no se registra en `indexed_files`. */
export const SCHEMA_RELATIONAL_RAG_SOURCE_PATH = 'ariadne-internal/relational-schema-rag-index.md';

export const SCHEMA_RELATIONAL_RAG_TITLE = 'Esquema relacional (vista índice RAG)';

export async function buildSchemaRelationalRagDocumentationText(input: {
  prismaFiles: readonly { path: string; content: string }[];
  parsedFiles: readonly ParsedFile[];
  openApiSpecs: readonly { path: string; content: string }[];
}): Promise<string> {
  const lines: string[] = [];

  lines.push('## Esquema relacional');
  lines.push('');
  lines.push(
    'Vista consolidada de datos y contratos HTTP para búsqueda semántica: tablas, modelos, entidades, relaciones entre modelos, base de datos, Prisma, TypeORM, OpenAPI, swagger.',
  );
  lines.push('');

  if (input.prismaFiles.length === 0) {
    lines.push('### Prisma');
    lines.push('');
    lines.push('_(No hay archivos `.prisma` en este snapshot del repo.)_');
    lines.push('');
  }

  for (const pf of input.prismaFiles) {
    let doc: Awaited<ReturnType<typeof getDMMF>>;
    try {
      doc = await getDMMF({ datamodel: pf.content });
    } catch {
      lines.push(`### Prisma — \`${pf.path}\``);
      lines.push('');
      lines.push('_(No se pudo obtener DMMF; schema inválido o versión incompatible.)_');
      lines.push('');
      continue;
    }
    const dm = doc.datamodel;
    const modelNames = new Set((dm.models ?? []).map((m) => m.name));

    lines.push(`### Prisma — \`${pf.path}\``);
    lines.push('');

    for (const model of dm.models ?? []) {
      const tableLabel =
        'dbName' in model && typeof (model as { dbName?: string }).dbName === 'string'
          ? (model as { dbName: string }).dbName
          : model.name;
      lines.push(`- **Modelo \`${model.name}\`** (tabla / colección lógica: \`${tableLabel}\`)`);
      if (model.documentation?.trim()) {
        lines.push(`  - Descripción: ${model.documentation.trim().replace(/\s+/g, ' ').slice(0, 280)}`);
      }
      const rels: string[] = [];
      const enumUses: string[] = [];
      const scalars: string[] = [];
      for (const field of model.fields ?? []) {
        if (field.kind === 'object' && modelNames.has(field.type)) {
          rels.push(`\`${field.name}\` → modelo \`${field.type}\` (relación)`);
        } else if (field.kind === 'enum') {
          enumUses.push(`\`${field.name}\` → enum \`${field.type}\``);
        } else if (field.kind === 'scalar') {
          scalars.push(`${field.name}:${field.type}`);
        }
      }
      if (scalars.length) {
        lines.push(
          `  - Campos escalares: ${scalars.slice(0, 50).join(', ')}${scalars.length > 50 ? ' …' : ''}`,
        );
      }
      if (rels.length) {
        lines.push(`  - Relaciones: ${rels.join('; ')}`);
      }
      if (enumUses.length) {
        lines.push(`  - Enums: ${enumUses.join('; ')}`);
      }
      lines.push('');
    }

    const enums = dm.enums ?? [];
    if (enums.length) {
      lines.push('**Enums Prisma:** ' + enums.map((e) => `\`${e.name}\``).join(', '));
      lines.push('');
    }
  }

  const typeormLines: string[] = [];
  for (const p of input.parsedFiles) {
    for (const m of p.models ?? []) {
      if (m.source !== 'typeorm') continue;
      const desc = m.description?.trim()
        ? ` — ${m.description.trim().replace(/\s+/g, ' ').slice(0, 200)}`
        : '';
      const fields =
        m.entityFields && m.entityFields.length
          ? m.entityFields.slice(0, 60).join(', ') + (m.entityFields.length > 60 ? ' …' : '')
          : '(columnas no inferidas)';
      typeormLines.push(
        `- **Entidad \`${m.name}\`** (TypeORM) en \`${p.path}\`${desc}. Propiedades/columnas: ${fields}.`,
      );
    }
  }

  lines.push('### TypeORM (@Entity)');
  lines.push('');
  if (typeormLines.length) {
    lines.push(...typeormLines);
    lines.push('');
  } else {
    lines.push('_(No se detectaron clases con @Entity en los archivos parseados.)_');
    lines.push('');
  }

  lines.push('### OpenAPI (operaciones HTTP)');
  lines.push('');
  let anyOa = false;
  for (const spec of input.openApiSpecs) {
    const ops = listOpenApiOperations(spec.content, spec.path);
    if (ops.length === 0) continue;
    anyOa = true;
    lines.push(`**Spec \`${spec.path}\`** (${ops.length} operaciones):`);
    lines.push('');
    const sample = ops.slice(0, 400);
    for (const op of sample) {
      const sum = op.summary ? ` — ${op.summary.replace(/\s+/g, ' ').slice(0, 120)}` : '';
      lines.push(`- \`${op.method} ${op.pathTemplate}\`${sum}`);
    }
    if (ops.length > 400) {
      lines.push(`- _… y ${ops.length - 400} operaciones más_`);
    }
    lines.push('');
  }
  if (!anyOa) {
    lines.push('_(No hay specs OpenAPI indexables o sin operaciones en este snapshot.)_');
    lines.push('');
  }

  const body = lines.join('\n').trimEnd();
  return body.length > STORYBOOK_MAX_EMBED_CHARS ? body.slice(0, STORYBOOK_MAX_EMBED_CHARS) : body;
}

/**
 * MERGE :File virtual + :MarkdownDoc enlazado (mismo patrón que producer para project markdown).
 */
export function buildCypherForSchemaRelationalRagDoc(
  projectId: string,
  repoId: string,
  sourcePath: string,
  title: string,
  documentationText: string,
): string[] {
  const pid = cypherSafe(projectId);
  const rid = cypherSafe(repoId);
  const pPath = cypherSafe(sourcePath);
  const now = cypherSafe(new Date().toISOString());
  const ext = cypherSafe('.md');
  const titleS = cypherSafe(title);
  const docText = cypherSafe(documentationText);
  return [
    `MERGE (f:File {path: ${pPath}, projectId: ${pid}, repoId: ${rid}}) ON CREATE SET f.extension = ${ext}, f.lastScan = ${now} ON MATCH SET f.extension = ${ext}, f.lastScan = ${now}`,
    `MATCH (p:Project {projectId: ${pid}}) MATCH (f:File {path: ${pPath}, projectId: ${pid}, repoId: ${rid}}) MERGE (p)-[:CONTAINS]->(f)`,
    `MERGE (md:MarkdownDoc {sourcePath: ${pPath}, projectId: ${pid}, repoId: ${rid}}) ON CREATE SET md.title = ${titleS}, md.documentationText = ${docText} ON MATCH SET md.title = ${titleS}, md.documentationText = ${docText}`,
    `MATCH (f:File {path: ${pPath}, projectId: ${pid}, repoId: ${rid}}) MATCH (md:MarkdownDoc {sourcePath: ${pPath}, projectId: ${pid}, repoId: ${rid}}) MERGE (f)-[:HAS_MARKDOWN_DOC]->(md)`,
  ];
}
