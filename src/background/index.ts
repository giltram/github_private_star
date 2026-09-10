import { GitHubApi, GitHubApiError } from "../github/api";
import { getConfig } from "../shared/config";
import type { ExtensionMessage, MessageResponseMap } from "../shared/messages";
import type { PublicError, RepoIdentifier, RepoMetadata } from "../shared/types";
import { GitHubPrivateStarsStore } from "../storage/privateStars";

const storageAccessReady = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isExtensionMessage(message)) return false;

  void handleMessage(message)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ ok: false, error: toPublicError(error) }));
  return true;
});

type AnyMessageResponse = MessageResponseMap[keyof MessageResponseMap];

async function handleMessage(message: ExtensionMessage): Promise<AnyMessageResponse> {
  await storageAccessReady;
  if (message.type === "OPEN_OPTIONS") {
    await chrome.runtime.openOptionsPage();
    return { ok: true, data: { opened: true } };
  }

  const config = await getConfig();
  if (!config?.token.trim() || !config.storageOwner.trim() || !config.storageRepo.trim()) {
    return {
      ok: false,
      error: {
        code: "CONFIG_REQUIRED",
        message: "Please configure GitHub Private Star first."
      }
    };
  }

  const store = new GitHubPrivateStarsStore(config);

  if (message.type === "GET_PRIVATE_STAR_STATUS") {
    return { ok: true, data: { starred: await store.isStarred(message.repo) } };
  }

  if (message.type === "GET_PRIVATE_STARS") {
    await assertAuthenticatedViewer(config.token, message.viewerLogin);
    const file = await store.getAll();
    const stars = Object.values(file.stars).sort((left, right) =>
      right.starredAt.localeCompare(left.starredAt)
    );
    return { ok: true, data: { stars } };
  }

  if (message.type === "REMOVE_PRIVATE_STAR") {
    await assertAuthenticatedViewer(config.token, message.viewerLogin);
    await store.remove(message.repo);
    return { ok: true, data: { removed: true } };
  }

  if (message.type === "TEST_CONNECTION") {
    await store.testConnection();
    return {
      ok: true,
      data: { message: `Connected to private repository ${config.storageOwner}/${config.storageRepo}.` }
    };
  }

  const repo = message.repo;
  const fullName = `${repo.owner}/${repo.name}`;
  const starred = await store.toggle(fullName, () => loadRepoMetadata(config.token, repo));
  return { ok: true, data: { starred } };
}

async function loadRepoMetadata(token: string, repo: RepoIdentifier): Promise<RepoMetadata> {
  const repository = await new GitHubApi(token).getRepository(repo.owner, repo.name);
  return {
    repo: repository.full_name,
    url: repository.html_url,
    description: repository.description ?? "",
    language: repository.language ?? "",
    starredAt: new Date().toISOString(),
    tags: [],
    note: ""
  };
}

async function assertAuthenticatedViewer(token: string, expectedLogin: string): Promise<void> {
  const user = await new GitHubApi(token).getAuthenticatedUser();
  if (user.login.toLowerCase() !== expectedLogin.toLowerCase()) {
    throw new GitHubApiError(
      `The configured PAT belongs to @${user.login}, but GitHub is signed in as @${expectedLogin}.`,
      403,
      "ACCOUNT_MISMATCH"
    );
  }
}

function toPublicError(error: unknown): PublicError {
  if (error instanceof GitHubApiError) {
    return { code: error.code, message: error.message, status: error.status };
  }
  if (error instanceof Error) return { code: "UNEXPECTED_ERROR", message: error.message };
  return { code: "UNEXPECTED_ERROR", message: "An unexpected error occurred." };
}

function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  if (message.type === "GET_PRIVATE_STAR_STATUS") {
    return typeof message.repo === "string";
  }
  if (message.type === "REMOVE_PRIVATE_STAR") {
    return typeof message.repo === "string" && typeof message.viewerLogin === "string";
  }
  if (message.type === "GET_PRIVATE_STARS") return typeof message.viewerLogin === "string";
  if (
    message.type === "TEST_CONNECTION" ||
    message.type === "OPEN_OPTIONS"
  ) return true;
  if (message.type !== "TOGGLE_PRIVATE_STAR") return false;
  if (typeof message.repo !== "object" || message.repo === null) return false;
  const repo = message.repo as Record<string, unknown>;
  return typeof repo.owner === "string" && typeof repo.name === "string";
}
