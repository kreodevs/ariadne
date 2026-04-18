/**
 * OpenAPI 3.1 spec - AriadneSpecs Graph API (constitution Módulo 3).
 */
export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "AriadneSpecs Graph API",
    description: "API de consulta al grafo de conocimiento estructural. Módulo 3 (constitution).",
    version: "1.0.0",
  },
  servers: [{ url: "/", description: "Current" }],
  paths: {
    "/graph/impact/{nodeId}": {
      get: {
        operationId: "getGraphImpact",
        summary: "Mapa de impacto",
        description:
          "Devuelve qué archivos/componentes se verían afectados si se modifica una función o componente (basado en FalkorDB).",
        parameters: [
          {
            name: "nodeId",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Nombre del nodo (componente o función)",
          },
        ],
        responses: {
          "200": {
            description: "Lista de dependientes",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    nodeId: { type: "string" },
                    dependents: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          name: { type: "string" },
                          labels: { type: "array", items: { type: "string" } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { description: "nodeId requerido" },
          "500": { description: "Error de FalkorDB" },
        },
      },
    },
    "/graph/component/{name}": {
      get: {
        operationId: "getComponentGraph",
        summary: "Grafo de dependencias de un componente",
        parameters: [
          { name: "name", in: "path", required: true, schema: { type: "string" } },
          { name: "depth", in: "query", schema: { type: "integer", default: 2 } },
        ],
        responses: {
          "200": {
            description: "Dependencias directas e indirectas",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    componentName: { type: "string" },
                    depth: { type: "integer" },
                    graphHints: {
                      type: "object",
                      properties: {
                        suggestResync: { type: "boolean" },
                        messageEs: { type: "string" },
                      },
                    },
                    dependencies: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          name: { type: "string" },
                          path: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/graph/contract/{componentName}": {
      get: {
        operationId: "getGraphContract",
        summary: "Contrato (props) del componente",
        description: "Extrae las props detectadas por el Scanner (HAS_PROP en FalkorDB).",
        parameters: [
          {
            name: "componentName",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Props del componente",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    componentName: { type: "string" },
                    props: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          name: { type: "string" },
                          required: { type: "boolean" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { description: "componentName requerido" },
          "500": { description: "Error de FalkorDB" },
        },
      },
    },
    "/graph/compare/{componentName}": {
      get: {
        operationId: "getGraphCompare",
        summary: "Comparar componente: main vs shadow",
        description:
          "Tras POST /graph/shadow, compara props en el grafo principal vs el grafo shadow de esa sesión (query shadowSessionId devuelto por el indexado). Sin query se lee el grafo legacy FalkorSpecsShadow.",
        parameters: [
          { name: "componentName", in: "path", required: true, schema: { type: "string" } },
          {
            name: "shadowSessionId",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Namespace shadow (mismo valor que devuelve POST /graph/shadow).",
          },
        ],
        responses: {
          "200": {
            description: "match, mainProps, shadowProps, missingInShadow, extraInShadow",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    componentName: { type: "string" },
                    match: { type: "boolean" },
                    mainProps: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: { name: { type: "string" }, required: { type: "boolean" } },
                      },
                    },
                    shadowProps: { type: "array", items: { type: "object" } },
                    missingInShadow: { type: "array", items: { type: "string" } },
                    extraInShadow: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
          },
          "400": { description: "componentName requerido" },
          "500": { description: "Error" },
        },
      },
    },
    "/graph/shadow": {
      post: {
        operationId: "postGraphShadow",
        summary: "Indexar código propuesto en grafo shadow",
        description:
          "Proxy al ingest: indexa en FalkorDB bajo FalkorSpecsShadow:<sesión>. Opcional shadowSessionId para reindexar el mismo namespace.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["files"],
                properties: {
                  shadowSessionId: {
                    type: "string",
                    description: "Opcional; si falta el ingest genera UUID y lo devuelve.",
                  },
                  files: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["path", "content"],
                      properties: {
                        path: { type: "string" },
                        content: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "ok, indexed, statements, shadowSessionId, shadowGraphName",
          },
          "400": { description: "body.files array required" },
          "502": { description: "Error proxy ingest" },
        },
      },
    },
  },
} as const;
