import { defaultConfig, getConfig, saveConfig } from "../shared/config";
import { sendExtensionMessage } from "../shared/messages";
import type { ExtensionConfig } from "../shared/types";

const form = requireElement<HTMLFormElement>("settings-form");
const tokenInput = requireElement<HTMLInputElement>("token");
const ownerInput = requireElement<HTMLInputElement>("storage-owner");
const repoInput = requireElement<HTMLInputElement>("storage-repo");
const testButton = requireElement<HTMLButtonElement>("test-connection");
const status = requireElement<HTMLDivElement>("status");
let savedToken = "";

void loadSettings();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveCurrentSettings("Settings saved.");
});

testButton.addEventListener("click", async () => {
  setBusy(true);
  setStatus("Saving settings and testing connection…", "pending");
  try {
    await saveConfig(readForm());
    rememberToken();
    const response = await sendExtensionMessage({ type: "TEST_CONNECTION" });
    if (response.ok) setStatus(response.data.message, "success");
    else setStatus(response.error.message, "error");
  } catch (error) {
    setStatus(errorMessage(error), "error");
  } finally {
    setBusy(false);
  }
});

async function loadSettings(): Promise<void> {
  const config = (await getConfig()) ?? defaultConfig();
  savedToken = config.token;
  updateTokenPlaceholder();
  ownerInput.value = config.storageOwner;
  repoInput.value = config.storageRepo;
}

async function saveCurrentSettings(successMessage: string): Promise<void> {
  setBusy(true);
  try {
    await saveConfig(readForm());
    rememberToken();
    setStatus(successMessage, "success");
  } catch (error) {
    setStatus(errorMessage(error), "error");
  } finally {
    setBusy(false);
  }
}

function readForm(): ExtensionConfig {
  return {
    token: tokenInput.value.trim() || savedToken,
    storageOwner: ownerInput.value.trim(),
    storageRepo: repoInput.value.trim()
  };
}

function rememberToken(): void {
  const replacement = tokenInput.value.trim();
  if (replacement) savedToken = replacement;
  tokenInput.value = "";
  updateTokenPlaceholder();
}

function updateTokenPlaceholder(): void {
  tokenInput.placeholder = savedToken ? "Token saved — leave blank to keep it" : "github_pat_…";
}

function setBusy(busy: boolean): void {
  for (const element of form.querySelectorAll<HTMLButtonElement>("button")) element.disabled = busy;
}

function setStatus(message: string, kind: "pending" | "success" | "error"): void {
  status.textContent = message;
  status.dataset.kind = kind;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element: ${id}`);
  return element as T;
}
