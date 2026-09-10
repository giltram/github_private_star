import type {
  GitHubContentFile,
  GitHubAuthenticatedUser,
  GitHubErrorBody,
  GitHubPutContentResponse,
  GitHubRepository
} from "./types";

const API_ROOT = "https://api.github.com";

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export class GitHubApi {
  constructor(private readonly token: string) {}

  async getRepository(owner: string, repo: string): Promise<GitHubRepository> {
    return this.request<GitHubRepository>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    );
  }

  async getAuthenticatedUser(): Promise<GitHubAuthenticatedUser> {
    return this.request<GitHubAuthenticatedUser>("/user");
  }

  async getContent(
    owner: string,
    repo: string,
    path: string
  ): Promise<GitHubContentFile> {
    const value = await this.request<unknown>(this.contentPath(owner, repo, path));
    if (!isContentFile(value)) {
      throw new GitHubApiError("The storage path is not a regular Base64 file.", 422, "INVALID_CONTENT");
    }
    return value;
  }

  async putContent(
    owner: string,
    repo: string,
    path: string,
    content: string,
    sha: string | null
  ): Promise<GitHubPutContentResponse> {
    const body: { message: string; content: string; sha?: string } = {
      message: "Update private stars",
      content: encodeBase64Utf8(content)
    };
    if (sha !== null) body.sha = sha;

    return this.request<GitHubPutContentResponse>(this.contentPath(owner, repo, path), {
      method: "PUT",
      body: JSON.stringify(body)
    });
  }

  private contentPath(owner: string, repo: string, path: string): string {
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}`;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${API_ROOT}${path}`, {
        ...init,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.token}`,
          "X-GitHub-Api-Version": "2026-03-10",
          "Content-Type": "application/json",
          ...init.headers
        }
      });
    } catch {
      throw new GitHubApiError("Could not reach GitHub. Check your network connection.", 0, "NETWORK_ERROR");
    }

    if (!response.ok) {
      const body = await readErrorBody(response);
      throw new GitHubApiError(
        friendlyErrorMessage(response.status, body.message),
        response.status,
        statusCode(response.status)
      );
    }

    return response.json() as Promise<T>;
  }
}

export function decodeBase64Utf8(value: string): string {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function isContentFile(value: unknown): value is GitHubContentFile {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    item.type === "file" &&
    item.encoding === "base64" &&
    typeof item.content === "string" &&
    typeof item.sha === "string"
  );
}

async function readErrorBody(response: Response): Promise<GitHubErrorBody> {
  try {
    const value: unknown = await response.json();
    if (typeof value === "object" && value !== null) return value as GitHubErrorBody;
  } catch {
    // GitHub may return an empty/non-JSON response during an outage.
  }
  return {};
}

function statusCode(status: number): string {
  if (status === 401) return "INVALID_TOKEN";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  return "GITHUB_API_ERROR";
}

function friendlyErrorMessage(status: number, detail?: string): string {
  if (status === 401) return "The GitHub token is invalid or has expired.";
  if (status === 403) {
    return "GitHub denied access. Check the token's repository selection and Contents permission.";
  }
  if (status === 404) {
    return "The repository was not found or the token cannot access it.";
  }
  if (status === 409) return "The storage file changed while it was being updated.";
  return detail ? `GitHub API error: ${detail}` : `GitHub API request failed (${status}).`;
}
