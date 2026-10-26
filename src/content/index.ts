import { sendExtensionMessage } from "../shared/messages";
import type { RepoIdentifier } from "../shared/types";
import { initializeProfileFeatures, syncProfileUi } from "./profile";

const WRAPPER_ID = "github-private-star-wrapper";
const STYLE_ID = "github-private-star-styles";
const TOAST_ID = "github-private-star-toast";
const ROUTE_CHECK_INTERVAL_MS = 800;
const MOUNT_TIMEOUT_MS = 15_000;

const RESERVED_TOP_LEVEL_ROUTES = new Set([
  "about", "account", "apps", "collections", "contact", "customer-stories", "enterprise",
  "events", "explore", "features", "issues", "login", "marketplace", "new", "notifications",
  "organizations", "orgs", "pricing", "pulls", "search", "security", "settings", "site",
  "sponsors", "stars", "topics", "trending", "users"
]);

let activeUrl = "";
let activeRepository: RepoIdentifier | null = null;
let routeGeneration = 0;
let mountObserver: MutationObserver | null = null;
let mountTimeout: number | null = null;

installStyles();
initializeProfileFeatures();
checkRoute();

for (const eventName of ["popstate", "hashchange", "turbo:load", "pjax:end"]) {
  window.addEventListener(eventName, checkRoute);
}
window.setInterval(checkRoute, ROUTE_CHECK_INTERVAL_MS);

function checkRoute(): void {
  if (location.href === activeUrl) {
    // GitHub can replace its React repository header without changing the URL.
    // Reconcile on the existing interval so removed or late headers recover too.
    if (activeRepository) tryMount(activeRepository, routeGeneration);
    return;
  }
  activeUrl = location.href;
  routeGeneration += 1;
  stopMountObserver();
  document.getElementById(WRAPPER_ID)?.remove();
  document.getElementById(TOAST_ID)?.remove();
  void syncProfileUi();

  activeRepository = parseRepositoryUrl(location.href);
  if (activeRepository) mountWhenReady(activeRepository, routeGeneration);
}

function parseRepositoryUrl(value: string): RepoIdentifier | null {
  const url = new URL(value);
  if (url.hostname !== "github.com") return null;
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length !== 2) return null;
  const [owner, name] = parts;
  if (!owner || !name || RESERVED_TOP_LEVEL_ROUTES.has(owner.toLowerCase())) return null;
  if (!/^[A-Za-z0-9-]{1,39}$/.test(owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(name)) return null;
  return { owner, name };
}

function mountWhenReady(repo: RepoIdentifier, generation: number): void {
  if (tryMount(repo, generation)) return;

  let queued = false;
  mountObserver = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    window.setTimeout(() => {
      queued = false;
      if (tryMount(repo, generation)) stopMountObserver();
    }, 120);
  });
  mountObserver.observe(document.body, { childList: true, subtree: true });
  mountTimeout = window.setTimeout(stopMountObserver, MOUNT_TIMEOUT_MS);
}

function tryMount(repo: RepoIdentifier, generation: number): boolean {
  if (generation !== routeGeneration || document.getElementById(WRAPPER_ID)) return true;

  const repositoryMeta = document.querySelector<HTMLMetaElement>(
    'meta[name="octolytics-dimension-repository_nwo"]'
  )?.content;
  if (repositoryMeta && repositoryMeta.toLowerCase() !== `${repo.owner}/${repo.name}`.toLowerCase()) {
    return false;
  }

  const placement = findPlacement(repo);
  if (!placement) return false;

  const wrapper = document.createElement(placement.listItem ? "li" : "span");
  wrapper.id = WRAPPER_ID;
  wrapper.className = "gps-wrapper";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "gps-button";
  button.disabled = true;
  button.textContent = "Private Star …";
  button.setAttribute("aria-label", `Loading Private Star status for ${repo.owner}/${repo.name}`);
  wrapper.append(button);

  if (placement.insertAfter) placement.container.insertAdjacentElement("afterend", wrapper);
  else placement.container.append(wrapper);

  void initializeButton(button, repo, generation);
  return true;
}

interface Placement {
  container: Element;
  insertAfter: boolean;
  listItem: boolean;
}

function findPlacement(repo: RepoIdentifier): Placement | null {
  // The React repository header owns this list independently of the native
  // Star button (which can be absent or have a different test ID when starred).
  const headerActions = document.querySelector('[data-testid="repo-header-actions"]');
  if (headerActions) {
    return { container: headerActions, insertAfter: false, listItem: headerActions.tagName === "UL" };
  }

  const starForm = document.querySelector(
    `form[action="/${repo.owner}/${repo.name}/star"], form[action="/${repo.owner}/${repo.name}/unstar"]`
  );
  const starButton = starForm ?? document.querySelector('[data-testid="star-button"]');
  if (starButton) {
    const anchor = starButton.closest("li") ?? starButton.closest(".BtnGroup") ?? starButton;
    return { container: anchor, insertAfter: true, listItem: anchor.tagName === "LI" };
  }

  const actions = document.querySelector(
    '[data-testid="repository-actions"], ul.pagehead-actions, #repository-details-container ul'
  );
  if (!actions) return null;
  return { container: actions, insertAfter: false, listItem: actions.tagName === "UL" };
}

async function initializeButton(
  button: HTMLButtonElement,
  repo: RepoIdentifier,
  generation: number
): Promise<void> {
  let starred = false;
  let configurationRequired = false;
  const response = await sendExtensionMessage({
    type: "GET_PRIVATE_STAR_STATUS",
    repo: `${repo.owner}/${repo.name}`
  });

  if (!button.isConnected || generation !== routeGeneration) return;
  if (response.ok) {
    starred = response.data.starred;
    renderButton(button, starred, false);
  } else {
    configurationRequired = response.error.code === "CONFIG_REQUIRED";
    renderButton(button, false, false);
    if (!configurationRequired) showToast(response.error.message, false);
  }

  button.addEventListener("click", async () => {
    if (configurationRequired) {
      showToast("Please configure GitHub Private Star first.", true);
      return;
    }

    const previous = starred;
    renderButton(button, starred, true);
    const toggleResponse = await sendExtensionMessage({ type: "TOGGLE_PRIVATE_STAR", repo });
    if (!button.isConnected || generation !== routeGeneration) return;

    if (toggleResponse.ok) {
      starred = toggleResponse.data.starred;
      renderButton(button, starred, false);
      showToast(starred ? "Added to Private Stars." : "Removed from Private Stars.", false);
    } else {
      starred = previous;
      configurationRequired = toggleResponse.error.code === "CONFIG_REQUIRED";
      renderButton(button, starred, false);
      showToast(toggleResponse.error.message, configurationRequired);
    }
  });
}

function renderButton(button: HTMLButtonElement, starred: boolean, loading: boolean): void {
  button.disabled = loading;
  button.setAttribute("aria-pressed", String(starred));
  button.setAttribute("aria-busy", String(loading));
  button.textContent = loading ? "Private Star …" : `${starred ? "★" : "☆"} Private Star`;
  button.classList.toggle("gps-button--starred", starred);
}

function showToast(message: string, showOptions: boolean): void {
  document.getElementById(TOAST_ID)?.remove();
  const toast = document.createElement("div");
  toast.id = TOAST_ID;
  toast.className = "gps-toast";
  toast.setAttribute("role", "status");
  const text = document.createElement("span");
  text.textContent = message;
  toast.append(text);

  if (showOptions) {
    const optionsButton = document.createElement("button");
    optionsButton.type = "button";
    optionsButton.textContent = "Open settings";
    optionsButton.addEventListener("click", () => {
      void sendExtensionMessage({ type: "OPEN_OPTIONS" });
    });
    toast.append(optionsButton);
  }

  document.body.append(toast);
  window.setTimeout(() => toast.remove(), showOptions ? 10_000 : 4_000);
}

function stopMountObserver(): void {
  mountObserver?.disconnect();
  mountObserver = null;
  if (mountTimeout !== null) window.clearTimeout(mountTimeout);
  mountTimeout = null;
}

function installStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .gps-wrapper { display: inline-flex; align-items: center; margin-left: 8px; list-style: none; }
    .gps-button {
      appearance: none; background: var(--button-default-bgColor-rest, var(--color-btn-bg, #f6f8fa));
      border: 1px solid var(--button-default-borderColor-rest, var(--color-btn-border, #d0d7de));
      border-radius: 6px; box-shadow: var(--button-default-shadow-rest, var(--color-btn-shadow, 0 1px 0 rgba(31,35,40,.04)));
      color: var(--button-default-fgColor-rest, var(--color-btn-text, #24292f)); cursor: pointer;
      font: 600 12px/20px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 3px 12px;
      white-space: nowrap;
    }
    .gps-button:hover:not(:disabled) { background: var(--button-default-bgColor-hover, var(--color-btn-hover-bg, #f3f4f6)); }
    .gps-button:disabled { cursor: wait; opacity: .65; }
    .gps-button--starred { color: var(--fgColor-accent, var(--color-accent-fg, #0969da)); }
    .gps-toast {
      align-items: center; background: var(--bgColor-default, var(--color-canvas-default, #fff));
      border: 1px solid var(--borderColor-default, var(--color-border-default, #d0d7de)); border-radius: 6px;
      bottom: 24px; box-shadow: 0 8px 24px rgba(140,149,159,.2); color: var(--fgColor-default, #1f2328);
      display: flex; gap: 12px; max-width: min(420px, calc(100vw - 32px)); padding: 12px 16px;
      position: fixed; right: 24px; z-index: 2147483647;
    }
    .gps-toast button { background: none; border: 0; color: var(--fgColor-accent, #0969da); cursor: pointer; font-weight: 600; padding: 0; }
  `;
  document.documentElement.append(style);
}
