import { decodeBase64Utf8, GitHubApi, GitHubApiError } from "../github/api";
import type { GitHubRepository } from "../github/types";
import {
  emptyStarsFile,
  STARS_FILE_PATH,
  type CachedStarsFile,
  type ExtensionConfig,
  type PrivateStarsFile,
  type RepoMetadata
} from "../shared/types";

const CACHE_KEY = "privateStarsCache";
const CACHE_TTL_MS = 60_000;
const MAX_WRITE_ATTEMPTS = 3;

interface RemoteFile {
  file: PrivateStarsFile;
  sha: string | null;
}

export interface PrivateStarsStore {
  getAll(forceRefresh?: boolean): Promise<PrivateStarsFile>;
  isStarred(repo: string): Promise<boolean>;
  toggle(repo: string, loadMetadata: () => Promise<RepoMetadata>): Promise<boolean>;
  remove(repo: string): Promise<void>;
}

export class GitHubPrivateStarsStore implements PrivateStarsStore {
  private readonly api: GitHubApi;
  private readonly configKey: string;

  constructor(private readonly config: ExtensionConfig) {
    this.api = new GitHubApi(config.token);
    this.configKey = `${config.storageOwner}/${config.storageRepo}`.toLowerCase();
  }

  async getAll(forceRefresh = false): Promise<PrivateStarsFile> {
    if (!forceRefresh) {
      const cached = await this.readCache();
      if (cached && Date.now() - cached.lastFetchedAt < CACHE_TTL_MS) return cached.file;
    }

    const remote = await this.readRemote();
    await this.writeCache(remote);
    return remote.file;
  }

  async isStarred(repo: string): Promise<boolean> {
    const file = await this.getAll();
    return findRepoKey(file, repo) !== undefined;
  }

  async toggle(repo: string, loadMetadata: () => Promise<RepoMetadata>): Promise<boolean> {
    const normalizedRepo = repo.toLowerCase();
    const initial = await this.readRemote();
    const shouldStar = findRepoKey(initial.file, normalizedRepo) === undefined;
    const metadata = shouldStar ? await loadMetadata() : null;

    for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
      const latest = attempt === 1 ? initial : await this.readRemote();
      const next: PrivateStarsFile = {
        version: 1,
        stars: { ...latest.file.stars }
      };

      if (shouldStar && metadata) next.stars[metadata.repo] = metadata;
      else {
        const existingKey = findRepoKey(next, normalizedRepo);
        if (existingKey) delete next.stars[existingKey];
      }

      try {
        const response = await this.api.putContent(
          this.config.storageOwner,
          this.config.storageRepo,
          STARS_FILE_PATH,
          `${JSON.stringify(next, null, 2)}\n`,
          latest.sha
        );
        const newSha = response.content?.sha;
        if (!newSha) throw new GitHubApiError("GitHub did not return the updated file SHA.", 502, "INVALID_RESPONSE");
        await this.writeCache({ file: next, sha: newSha });
        return shouldStar;
      } catch (error) {
        const canRetry = error instanceof GitHubApiError && error.status === 409;
        if (!canRetry || attempt === MAX_WRITE_ATTEMPTS) throw error;
      }
    }

    throw new GitHubApiError("Could not update the storage file after 3 attempts.", 409, "CONFLICT");
  }

  async remove(repo: string): Promise<void> {
    const initial = await this.readRemote();
    if (findRepoKey(initial.file, repo) === undefined) {
      await this.writeCache(initial);
      return;
    }

    for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
      const latest = attempt === 1 ? initial : await this.readRemote();
      const next: PrivateStarsFile = { version: 1, stars: { ...latest.file.stars } };
      const existingKey = findRepoKey(next, repo);
      if (existingKey) delete next.stars[existingKey];

      try {
        const response = await this.api.putContent(
          this.config.storageOwner,
          this.config.storageRepo,
          STARS_FILE_PATH,
          `${JSON.stringify(next, null, 2)}\n`,
          latest.sha
        );
        const newSha = response.content?.sha;
        if (!newSha) {
          throw new GitHubApiError("GitHub did not return the updated file SHA.", 502, "INVALID_RESPONSE");
        }
        await this.writeCache({ file: next, sha: newSha });
        return;
      } catch (error) {
        const canRetry = error instanceof GitHubApiError && error.status === 409;
        if (!canRetry || attempt === MAX_WRITE_ATTEMPTS) throw error;
      }
    }
  }

  async testConnection(): Promise<void> {
    const repository = await this.getStorageRepository();
    assertPrivateStorageRepository(repository);

    try {
      const content = await this.api.getContent(
        this.config.storageOwner,
        this.config.storageRepo,
        STARS_FILE_PATH
      );
      parseStarsFile(decodeBase64Utf8(content.content));
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 404) return;
      throw error;
    }
  }

  private async readRemote(): Promise<RemoteFile> {
    try {
      const response = await this.api.getContent(
        this.config.storageOwner,
        this.config.storageRepo,
        STARS_FILE_PATH
      );
      return { file: parseStarsFile(decodeBase64Utf8(response.content)), sha: response.sha };
    } catch (error) {
      if (!(error instanceof GitHubApiError) || error.status !== 404) throw error;

      const repository = await this.getStorageRepository();
      assertPrivateStorageRepository(repository);
      return { file: emptyStarsFile(), sha: null };
    }
  }

  private async getStorageRepository(): Promise<GitHubRepository> {
    try {
      return await this.api.getRepository(this.config.storageOwner, this.config.storageRepo);
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 404) {
        throw new GitHubApiError(
          `Storage repository ${this.config.storageOwner}/${this.config.storageRepo} was not found or the token cannot access it.`,
          404,
          "STORAGE_REPO_UNAVAILABLE"
        );
      }
      throw error;
    }
  }

  private async readCache(): Promise<CachedStarsFile | null> {
    const result = await chrome.storage.local.get(CACHE_KEY);
    const value: unknown = result[CACHE_KEY];
    if (!isCachedStarsFile(value) || value.configKey !== this.configKey) return null;
    return value;
  }

  private async writeCache(remote: RemoteFile): Promise<void> {
    const cache: CachedStarsFile = {
      configKey: this.configKey,
      file: remote.file,
      sha: remote.sha,
      lastFetchedAt: Date.now()
    };
    await chrome.storage.local.set({ [CACHE_KEY]: cache });
  }
}

function parseStarsFile(json: string): PrivateStarsFile {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new GitHubApiError("stars.json contains invalid JSON.", 422, "INVALID_STARS_FILE");
  }

  if (!isPrivateStarsFile(value)) {
    throw new GitHubApiError("stars.json does not use the supported version 1 format.", 422, "INVALID_STARS_FILE");
  }
  return value;
}

function isPrivateStarsFile(value: unknown): value is PrivateStarsFile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || typeof candidate.stars !== "object" || candidate.stars === null) {
    return false;
  }
  return Object.values(candidate.stars).every(isRepoMetadata);
}

function isRepoMetadata(value: unknown): value is RepoMetadata {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.repo === "string" &&
    typeof item.url === "string" &&
    typeof item.description === "string" &&
    typeof item.language === "string" &&
    typeof item.starredAt === "string" &&
    Array.isArray(item.tags) && item.tags.every((tag) => typeof tag === "string") &&
    typeof item.note === "string"
  );
}

function isCachedStarsFile(value: unknown): value is CachedStarsFile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.configKey === "string" &&
    typeof candidate.lastFetchedAt === "number" &&
    (typeof candidate.sha === "string" || candidate.sha === null) &&
    isPrivateStarsFile(candidate.file)
  );
}

function assertPrivateStorageRepository(repository: GitHubRepository): void {
  if (!repository.private) {
    throw new GitHubApiError(
      "The storage repository must be private before Private Stars can be used.",
      422,
      "STORAGE_REPO_NOT_PRIVATE"
    );
  }
}

function findRepoKey(file: PrivateStarsFile, repo: string): string | undefined {
  const normalized = repo.toLowerCase();
  return Object.keys(file.stars).find((key) => key.toLowerCase() === normalized);
}
