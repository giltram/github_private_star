export const DEFAULT_STORAGE_REPO = "github-private-stars";
export const STARS_FILE_PATH = "stars.json";

export interface ExtensionConfig {
  token: string;
  storageOwner: string;
  storageRepo: string;
}

export interface RepoIdentifier {
  owner: string;
  name: string;
}

export interface RepoMetadata {
  repo: string;
  url: string;
  description: string;
  language: string;
  starredAt: string;
  tags: string[];
  note: string;
}

export interface PrivateStarsFile {
  version: 1;
  stars: Record<string, RepoMetadata>;
}

export interface CachedStarsFile {
  configKey: string;
  file: PrivateStarsFile;
  sha: string | null;
  lastFetchedAt: number;
}

export interface PublicError {
  code: string;
  message: string;
  status?: number;
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: PublicError };

export const emptyStarsFile = (): PrivateStarsFile => ({
  version: 1,
  stars: {}
});
