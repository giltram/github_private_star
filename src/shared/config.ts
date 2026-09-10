import { DEFAULT_STORAGE_REPO, type ExtensionConfig } from "./types";

const CONFIG_KEY = "privateStarConfig";
const OWNER_PATTERN = /^(?!-)[A-Za-z0-9-]{1,39}(?<!-)$/;
const REPO_PATTERN = /^(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/;

export async function getConfig(): Promise<ExtensionConfig | null> {
  const result = await chrome.storage.local.get(CONFIG_KEY);
  const value: unknown = result[CONFIG_KEY];
  if (!isExtensionConfig(value)) return null;
  return value;
}

export async function saveConfig(config: ExtensionConfig): Promise<void> {
  validateConfig(config);
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
  await chrome.storage.local.remove("privateStarsCache");
}

export function defaultConfig(): ExtensionConfig {
  return { token: "", storageOwner: "", storageRepo: DEFAULT_STORAGE_REPO };
}

export function validateConfig(config: ExtensionConfig): void {
  if (!config.token.trim()) throw new Error("A Fine-grained personal access token is required.");
  if (!OWNER_PATTERN.test(config.storageOwner.trim())) {
    throw new Error("Enter a valid GitHub repository owner.");
  }
  if (!REPO_PATTERN.test(config.storageRepo.trim())) {
    throw new Error("Enter a valid GitHub repository name.");
  }
}

function isExtensionConfig(value: unknown): value is ExtensionConfig {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.token === "string" &&
    typeof candidate.storageOwner === "string" &&
    typeof candidate.storageRepo === "string"
  );
}
