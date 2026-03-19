/**
 * Common interface for repository providers (Bitbucket API, GitHub API, Git shallow clone).
 * Permite intercambiar la estrategia de obtención de código según el proveedor.
 */

export interface RepoProviderResult {
  paths: string[];
  getContent: (relPath: string) => Promise<string | null>;
  getLatestCommitSha: () => Promise<string | null>;
}
