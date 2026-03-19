/**
 * Contrato para proveedores de embeddings. FalkorDB indexa vectores con dimensión fija;
 * el proveedor debe reportar su dimensión para que los índices vectoriales coincidan.
 */
export interface EmbeddingProvider {
  readonly id: string;
  isAvailable(): boolean;
  getDimension(): number;
  embed(text: string): Promise<number[]>;
}
