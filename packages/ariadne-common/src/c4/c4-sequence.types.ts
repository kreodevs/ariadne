export interface C4SequenceRouteOption {
  routePath: string;
  screenName: string | null;
  apiSummary: string | null;
  isPublicEntry: boolean;
  hasApiLink: boolean;
  /** `route` = nodo Falkor `:Route`; `api-client` = flujo desde `REFERENCES_API` sin ruta UI. */
  kind?: 'route' | 'api-client';
  screenFilePath?: string | null;
}
