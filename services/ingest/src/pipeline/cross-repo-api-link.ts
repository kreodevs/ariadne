/**
 * Enlaces post-sync entre referencias `api/...` del frontend y el backend (OpenAPI + StrapiRoute)
 * dentro del mismo proyecto Ariadne (multi-root).
 */
import { cypherSafe } from 'ariadne-common';
import { strapiRouteMatchesNormalizedPathCypher } from './strapi-route-path-match';
import { openApiPathMatchesStrapiRouteCypher } from './strapi-openapi-route-match';
import { nestRouteMatchesNormalizedPathCypher } from './nest-route-path-match';
import { openApiPathMatchesNestRouteCypher } from './nest-openapi-route-match';
import { publicEntryApiNameMatchCypher } from './react-route-public-entry';

/** MERGE (ApiClientReference)-[:CALLS_API]->(OpenApiOperation) por coincidencia de path. */
export function buildCrossRepoApiLinkCypher(projectId: string): string[] {
  const pid = cypherSafe(projectId);
  return [
    `MATCH (ref:ApiClientReference {projectId: ${pid}}) MATCH (op:OpenApiOperation {projectId: ${pid}}) WHERE ref.repoId <> op.repoId AND (op.pathTemplate = '/' + ref.normalizedPath OR op.pathTemplate STARTS WITH '/' + ref.normalizedPath + '/' OR op.pathTemplate = '/api/' + ref.normalizedPath OR op.pathTemplate STARTS WITH '/api/' + ref.normalizedPath + '/') MERGE (ref)-[:CALLS_API]->(op)`,
  ];
}

/**
 * MERGE (ApiClientReference)-[:CALLS_STRAPI_ROUTE]->(StrapiRoute) cuando el literal `api/...` del front
 * coincide con la ruta Strapi custom (`/createCampaniaWDetalles`, sufijos `campanias/...`, etc.).
 */
export function buildCrossRepoStrapiRouteLinkCypher(projectId: string): string[] {
  const pid = cypherSafe(projectId);
  const match = strapiRouteMatchesNormalizedPathCypher('ref', 'sr');
  return [
    `MATCH (ref:ApiClientReference {projectId: ${pid}}) MATCH (sr:StrapiRoute {projectId: ${pid}}) WHERE ref.repoId <> sr.repoId AND (${match}) MERGE (ref)-[:CALLS_STRAPI_ROUTE]->(sr)`,
  ];
}

/** MERGE (ExternalApiReference)-[:CALLS_STRAPI_ROUTE]->(StrapiRoute) — Tasks/SSO con path `api/...`. */
export function buildCrossRepoExternalStrapiRouteLinkCypher(projectId: string): string[] {
  const pid = cypherSafe(projectId);
  const match = strapiRouteMatchesNormalizedPathCypher('ear', 'sr');
  return [
    `MATCH (ear:ExternalApiReference {projectId: ${pid}}) MATCH (sr:StrapiRoute {projectId: ${pid}}) WHERE ear.repoId <> sr.repoId AND (${match}) MERGE (ear)-[:CALLS_STRAPI_ROUTE]->(sr)`,
  ];
}

/**
 * Lifecycles y archivos con `strapi.service('api::…')` → rutas del mismo API en el repo ERP.
 * Relación `(File)-[:INVOKES_STRAPI_ROUTE]->(StrapiRoute)`.
 */
export function buildInternalStrapiRouteLinkCypher(projectId: string): string[] {
  const pid = cypherSafe(projectId);
  return [
    `MATCH (f:File {projectId: ${pid}})-[:LIFECYCLE_OF]->(ct:StrapiContentType) MATCH (sr:StrapiRoute {projectId: ${pid}}) WHERE f.repoId = sr.repoId AND ct.apiName = sr.apiName MERGE (f)-[:INVOKES_STRAPI_ROUTE]->(sr)`,
    `MATCH (f:File {projectId: ${pid}})-[:REFERENCES_STRAPI_UID]->(uid:StrapiUidReference) MATCH (ct:StrapiContentType {projectId: ${pid}}) WHERE ct.strapiUid = uid.uid AND ct.repoId = f.repoId MATCH (sr:StrapiRoute {projectId: ${pid}}) WHERE sr.repoId = f.repoId AND sr.apiName = ct.apiName MERGE (f)-[:INVOKES_STRAPI_ROUTE]->(sr)`,
  ];
}

/** MERGE (OpenApiOperation)-[:SAME_REST_AS]->(StrapiRoute) y front vía OpenAPI cuando REST coincide. */
export function buildOpenApiStrapiRouteLinkCypher(projectId: string): string[] {
  const pid = cypherSafe(projectId);
  const pathMatch = openApiPathMatchesStrapiRouteCypher('op', 'sr');
  return [
    `MATCH (op:OpenApiOperation {projectId: ${pid}}) MATCH (sr:StrapiRoute {projectId: ${pid}}) WHERE op.repoId = sr.repoId AND op.method = sr.method AND (${pathMatch}) MERGE (op)-[:SAME_REST_AS]->(sr)`,
    `MATCH (ref:ApiClientReference {projectId: ${pid}})-[:CALLS_API]->(op:OpenApiOperation)-[:SAME_REST_AS]->(sr:StrapiRoute) WHERE ref.repoId <> sr.repoId MERGE (ref)-[:CALLS_STRAPI_ROUTE]->(sr)`,
  ];
}

/** GraphQlQuery custom Strapi → StrapiRoute vía resolverOf (`Medios.cercanos` → handler `*.cercanos`). */
export function buildGraphQlResolvesToRouteLinkCypher(projectId: string): string[] {
  const pid = cypherSafe(projectId);
  return [
    `MATCH (gq:GraphQlQuery {projectId: ${pid}}) WHERE gq.resolverAction IS NOT NULL AND trim(gq.resolverAction) <> '' MATCH (sr:StrapiRoute {projectId: ${pid}}) WHERE gq.repoId = sr.repoId AND sr.handler IS NOT NULL AND (sr.handler ENDS WITH gq.resolverAction OR sr.handler ENDS WITH '.' + gq.resolverAction) MERGE (gq)-[:RESOLVES_TO_ROUTE]->(sr)`,
  ];
}

/** Front GraphQL → GraphQlQuery (cross-repo) por nombre de operación/campo. */
export function buildCrossRepoGraphQlClientLinkCypher(projectId: string): string[] {
  const pid = cypherSafe(projectId);
  return [
    `MATCH (gcr:GraphQlClientReference {projectId: ${pid}}) MATCH (gq:GraphQlQuery {projectId: ${pid}}) WHERE gcr.repoId <> gq.repoId AND (gcr.operationName = gq.name OR gcr.rootField = gq.name) MERGE (gcr)-[:CALLS_GRAPHQL_QUERY]->(gq)`,
    `MATCH (gcr:GraphQlClientReference {projectId: ${pid}})-[:CALLS_GRAPHQL_QUERY]->(gq:GraphQlQuery)-[:RESOLVES_TO_ROUTE]->(sr:StrapiRoute) WHERE gcr.repoId <> sr.repoId MERGE (gcr)-[:CALLS_STRAPI_ROUTE]->(sr)`,
  ];
}

/** GraphQL custom sin REST (`RESOLVES_TO_ROUTE`) → consumidor admin GraphQL. */
export function buildGraphQlAdminOnlyMarkCypher(projectId: string): string[] {
  const pid = cypherSafe(projectId);
  return [
    `MATCH (gq:GraphQlQuery {projectId: ${pid}}) WHERE NOT (gq)-[:RESOLVES_TO_ROUTE]->(:StrapiRoute) SET gq.implicitConsumer = 'strapi_graphql_admin'`,
    `MATCH (gq:GraphQlQuery {projectId: ${pid}}) WHERE (gq)-[:RESOLVES_TO_ROUTE]->(:StrapiRoute) SET gq.implicitConsumer = null`,
  ];
}

/**
 * Enlaza Route → ApiClientReference alcanzable desde el componente de pantalla
 * (TanStack / React Router) hacia Nest/OpenAPI vía CALLS_NEST_ROUTE / CALLS_API.
 */
export function buildRouteComponentApiReachLinkCypher(projectId: string): string[] {
  const pid = cypherSafe(projectId);
  return [
    `MATCH (rt:Route {projectId: ${pid}})-[:ROUTE_TO_COMPONENT]->(comp:Component) MATCH (f:File {projectId: ${pid}})-[:CONTAINS]->(comp) MATCH (f)-[:REFERENCES_API]->(acr:ApiClientReference) WHERE f.projectId = ${pid} MERGE (rt)-[:ENTRY_REACHES_API]->(acr)`,
    `MATCH (rt:Route {projectId: ${pid}})-[:ROUTE_TO_COMPONENT]->(root:Component) OPTIONAL MATCH (root)-[:RENDERS*1..8]->(desc:Component) WITH rt, collect(DISTINCT desc) + [root] AS comps UNWIND comps AS comp MATCH (f:File {projectId: ${pid}})-[:CONTAINS]->(comp) MATCH (f)-[:REFERENCES_API]->(acr:ApiClientReference) MERGE (rt)-[:ENTRY_REACHES_API]->(acr)`,
  ];
}

/** Rutas React públicas → StrapiRoute con `auth: false` (urbanos, visualización cliente). */
export function buildPublicEntryRouteLinkCypher(projectId: string): string[] {
  const pid = cypherSafe(projectId);
  const apiMatch = publicEntryApiNameMatchCypher('rt', 'sr');
  return [
    `MATCH (rt:Route {projectId: ${pid}}) WHERE coalesce(rt.isPublicEntry, 'false') = 'true' MATCH (sr:StrapiRoute {projectId: ${pid}}) WHERE coalesce(sr.publicRoute, 'false') = 'true' AND rt.repoId <> sr.repoId AND (${apiMatch}) MERGE (rt)-[:ENTRY_CONSUMES]->(sr)`,
  ];
}

/**
 * Desde entry público, recorre `RENDERS` y enlaza `ApiClientReference` alcanzables con StrapiRoute públicas.
 */
export function buildPublicEntryReachableApiLinkCypher(projectId: string): string[] {
  const pid = cypherSafe(projectId);
  const match = strapiRouteMatchesNormalizedPathCypher('acr', 'sr');
  return [
    `MATCH (rt:Route {projectId: ${pid}}) WHERE coalesce(rt.isPublicEntry, 'false') = 'true' MATCH (rt)-[:ROUTE_TO_COMPONENT]->(root:Component) OPTIONAL MATCH (root)-[:RENDERS*1..12]->(desc:Component) WITH rt, collect(DISTINCT desc) + [root] AS comps UNWIND comps AS comp MATCH (f:File)-[:CONTAINS]->(comp) MATCH (f)-[:REFERENCES_API]->(acr:ApiClientReference) MATCH (sr:StrapiRoute {projectId: ${pid}}) WHERE acr.repoId <> sr.repoId AND coalesce(sr.publicRoute, 'false') = 'true' AND (${match}) MERGE (acr)-[:CALLS_STRAPI_ROUTE]->(sr) MERGE (rt)-[:ENTRY_REACHES_API]->(acr)`,
  ];
}

/** MERGE (OpenApiOperation)-[:SAME_REST_AS]->(NestRoute) y front vía OpenAPI cuando REST coincide. */
export function buildOpenApiNestRouteLinkCypher(projectId: string): string[] {
  const pid = cypherSafe(projectId);
  const pathMatch = openApiPathMatchesNestRouteCypher('op', 'nr');
  return [
    `MATCH (op:OpenApiOperation {projectId: ${pid}}) MATCH (nr:NestRoute {projectId: ${pid}}) WHERE op.repoId = nr.repoId AND op.method = nr.httpMethod AND (${pathMatch}) MERGE (op)-[:SAME_REST_AS]->(nr)`,
    `MATCH (ref:ApiClientReference {projectId: ${pid}})-[:CALLS_API]->(op:OpenApiOperation)-[:SAME_REST_AS]->(nr:NestRoute) WHERE ref.repoId <> nr.repoId MERGE (ref)-[:CALLS_NEST_ROUTE]->(nr)`,
  ];
}

/** MERGE (ApiClientReference)-[:CALLS_NEST_ROUTE]->(NestRoute) por literal `api/…` o `/api/…` normalizado. */
export function buildCrossRepoNestRouteLinkCypher(projectId: string): string[] {
  const pid = cypherSafe(projectId);
  const match = nestRouteMatchesNormalizedPathCypher('ref', 'nr');
  return [
    `MATCH (ref:ApiClientReference {projectId: ${pid}}) MATCH (nr:NestRoute {projectId: ${pid}}) WHERE ref.repoId <> nr.repoId AND (${match}) MERGE (ref)-[:CALLS_NEST_ROUTE]->(nr)`,
  ];
}

/** OpenAPI + StrapiRoute + NestRoute cross-repo + consumidores internos (ejecutar tras indexar todos los repos del proyecto). */
export function buildCrossRepoApiAndStrapiLinkCypher(projectId: string): string[] {
  return [
    ...buildCrossRepoApiLinkCypher(projectId),
    ...buildCrossRepoStrapiRouteLinkCypher(projectId),
    ...buildCrossRepoNestRouteLinkCypher(projectId),
    ...buildCrossRepoExternalStrapiRouteLinkCypher(projectId),
    ...buildInternalStrapiRouteLinkCypher(projectId),
    ...buildOpenApiStrapiRouteLinkCypher(projectId),
    ...buildOpenApiNestRouteLinkCypher(projectId),
    ...buildGraphQlResolvesToRouteLinkCypher(projectId),
    ...buildCrossRepoGraphQlClientLinkCypher(projectId),
    ...buildGraphQlAdminOnlyMarkCypher(projectId),
    ...buildPublicEntryRouteLinkCypher(projectId),
    ...buildPublicEntryReachableApiLinkCypher(projectId),
    ...buildRouteComponentApiReachLinkCypher(projectId),
  ];
}
