/** Cuerpo POST /embedding-spaces: registra un espacio vectorial versionado para Falkor + Postgres. */
export class CreateEmbeddingSpaceDto {
  /** ej. openai, google, ollama */
  provider!: string;
  /** ej. text-embedding-3-small, nomic-embed-text */
  modelId!: string;
  dimension!: number;
  /** Opcional; default derivado de provider/model/dim */
  key?: string;
  /** Propiedad en nodos Falkor; opcional (se sugiere emb_<provider>_<model>_<dim>) */
  graphProperty?: string;
}
