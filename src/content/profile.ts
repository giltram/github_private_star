import { sendExtensionMessage } from "../shared/messages";
import type { RepoMetadata } from "../shared/types";

const PROFILE_TAB_CLASS = "gps-profile-tab";
const MENU_ITEM_CLASS = "gps-user-menu-item";
const DASHBOARD_ID = "github-private-stars-dashboard";
const HIDDEN_CLASS = "gps-profile-content-hidden";
const SUPPRESSED_TAB_CLASS = "gps-native-tab-suppressed";
const PROFILE_STYLE_ID = "github-private-stars-profile-styles";

let profileGeneration = 0;
let dashboardRoot: ShadowRoot | null = null;
let profileNavObserver: MutationObserver | null = null;
let profileNavSyncQueued = false;
let userMenuObserver: MutationObserver | null = null;
let userMenuSyncQueued = false;

export function initializeProfileFeatures(): void {
  installProfileStyles();
  document.addEventListener("click", handlePotentialMenuOpen, true);
  document.addEventListener("keydown", handlePotentialMenuKey, true);
  observeUserMenu();
}

export async function syncProfileUi(attempt = 0): Promise<void> {
  const generation = ++profileGeneration;
  cleanupDashboard();

  const profileLogin = parseProfileLogin(location.href);
  if (!profileLogin) return;
  const webLogin = readWebSessionLogin() ?? inferLoginFromOwnProfile(profileLogin);
  if (!webLogin) return;
  if (generation !== profileGeneration) return;

  void syncUserMenu(webLogin);
  if (!sameLogin(profileLogin, webLogin)) return;

  const starTabs = findStarTabs();
  if (starTabs.length === 0) {
    if (attempt < 4) window.setTimeout(() => void syncProfileUi(attempt + 1), 150 * (attempt + 1));
    return;
  }
  for (const starTab of starTabs) injectPrivateStarsTab(starTab, webLogin);

  if (new URL(location.href).searchParams.get("tab") === "private-stars") {
    mountDashboard(webLogin, starTabs);
  }
}

function handlePotentialMenuOpen(event: MouseEvent): void {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest('button[aria-label*="user navigation" i], button[aria-label*="profile" i]')) {
    scheduleUserMenuSync();
  }
}

function handlePotentialMenuKey(event: KeyboardEvent): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (!(event.target instanceof Element)) return;
  if (event.target.closest('button[aria-label*="user navigation" i], button[aria-label*="profile" i]')) {
    scheduleUserMenuSync();
  }
}

function scheduleUserMenuSync(): void {
  for (const delay of [0, 100, 300, 700, 1_500]) {
    window.setTimeout(() => void syncUserMenu(), delay);
  }
}

async function syncUserMenu(knownViewer?: string): Promise<void> {
  const existingItems = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(`.${MENU_ITEM_CLASS}`)
  );
  for (const item of existingItems) {
    if (isProfileNavigationLink(item)) removeInjectedLink(item);
  }
  if (existingItems.some((item) => item.isConnected && !isProfileNavigationLink(item))) return;

  const starsLink = findUserMenuStarsLink(knownViewer);
  if (!starsLink) return;
  const viewerLogin = knownViewer ?? readLoginFromStarsLink(starsLink);
  if (!viewerLogin) return;

  const link = starsLink.cloneNode(true) as HTMLAnchorElement;
  sanitizeClonedLink(link);
  sanitizeClonedMenuContents(link);
  link.classList.add(MENU_ITEM_CLASS);
  link.href = `/${encodeURIComponent(viewerLogin)}?tab=private-stars`;
  link.setAttribute("aria-label", "Private stars");
  replaceMenuIconWithLock(link);
  replaceMenuLabel(link);
  link.addEventListener("click", navigateFromUserMenu);

  const originalItem = starsLink.closest("li");
  if (originalItem?.parentElement) {
    const item = originalItem.cloneNode(false) as HTMLLIElement;
    for (const attribute of ["aria-current", "data-active", "data-menu-item", "data-selected"]) {
      item.removeAttribute(attribute);
    }
    item.hidden = false;
    item.append(link);
    originalItem.insertAdjacentElement("afterend", item);
  } else {
    starsLink.insertAdjacentElement("afterend", link);
  }
}

function observeUserMenu(): void {
  if (userMenuObserver || !document.body) return;
  userMenuObserver = new MutationObserver(() => {
    if (userMenuSyncQueued) return;

    const existingMenuItem = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(`.${MENU_ITEM_CLASS}`)
    ).some((item) => !isProfileNavigationLink(item));
    if (existingMenuItem) return;

    if (!findUserMenuStarsLink()) return;
    userMenuSyncQueued = true;
    window.setTimeout(() => {
      userMenuSyncQueued = false;
      void syncUserMenu();
    });
  });
  userMenuObserver.observe(document.body, { childList: true, subtree: true });
}

function findUserMenuStarsLink(viewerLogin?: string): HTMLAnchorElement | undefined {
  const candidates = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a[href*="tab=stars"]')
  );
  return candidates.find((link) => {
    const label = link.textContent?.trim().toLowerCase() ?? "";
    const url = new URL(link.href);
    return (
      /^(your )?stars(?:\s|$)/.test(label) &&
      url.searchParams.get("tab") === "stars" &&
      (!viewerLogin || sameLogin(decodeURIComponent(url.pathname.slice(1)), viewerLogin)) &&
      !isProfileNavigationLink(link)
    );
  });
}

function readLoginFromStarsLink(link: HTMLAnchorElement): string | null {
  const url = new URL(link.href);
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.hostname !== "github.com" || parts.length !== 1) return null;
  const login = decodeURIComponent(parts[0] ?? "");
  return /^[A-Za-z0-9-]{1,39}$/.test(login) ? login : null;
}

function isProfileNavigationLink(link: HTMLAnchorElement): boolean {
  if (link.dataset.turboFrame === "user-profile-frame") return true;
  return Boolean(link.closest("nav")?.querySelector('a[data-turbo-frame="user-profile-frame"]'));
}

function removeInjectedLink(link: HTMLAnchorElement): void {
  const item = link.parentElement;
  if (item?.tagName === "LI" && item.children.length === 1) item.remove();
  else link.remove();
}

function sanitizeClonedMenuContents(link: HTMLAnchorElement): void {
  link.removeAttribute("aria-labelledby");
  link.removeAttribute("id");
  for (const element of link.querySelectorAll<HTMLElement>("[id]")) element.removeAttribute("id");
}

function replaceMenuIconWithLock(link: HTMLAnchorElement): void {
  const icon = link.querySelector<SVGSVGElement>("svg");
  if (!icon) {
    link.prepend(createLockIcon());
    return;
  }
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.replaceChildren(createLockPath());
}

function replaceMenuLabel(link: HTMLAnchorElement): void {
  const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    if (/^(your )?stars$/i.test(current.textContent?.trim() ?? "")) {
      current.textContent = (current.textContent ?? "").replace(/(your )?stars/i, "Private stars");
      return;
    }
    current = walker.nextNode();
  }
}

function findStarTabs(): HTMLAnchorElement[] {
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('nav a[href*="tab=stars"]')
  );
  return links.filter((link) => {
    const url = new URL(link.href);
    return (
      url.searchParams.get("tab") === "stars" &&
      (link.dataset.tabItem === "stars" || link.dataset.turboFrame === "user-profile-frame")
    );
  });
}

function injectPrivateStarsTab(starsTab: HTMLAnchorElement, viewerLogin: string): void {
  const existing = starsTab.closest("nav")?.querySelector<HTMLAnchorElement>(`.${PROFILE_TAB_CLASS}`);
  if (existing) {
    setTabSelection(existing);
    return;
  }

  const tab = starsTab.cloneNode(false) as HTMLAnchorElement;
  sanitizeClonedLink(tab);
  tab.classList.add(PROFILE_TAB_CLASS);
  tab.dataset.tabItem = "private-stars";
  tab.href = `/${encodeURIComponent(viewerLogin)}?tab=private-stars`;
  tab.append(createLockIcon(), document.createTextNode(" Private stars"));
  tab.addEventListener("click", navigateInsideGitHub);
  setTabSelection(tab);

  const originalItem = starsTab.parentElement;
  if (originalItem?.tagName === "LI" && originalItem.parentElement) {
    const item = originalItem.cloneNode(false) as HTMLLIElement;
    item.append(tab);
    originalItem.insertAdjacentElement("afterend", item);
  } else {
    starsTab.insertAdjacentElement("afterend", tab);
  }
}

function setTabSelection(tab: HTMLAnchorElement): void {
  const selected = new URL(location.href).searchParams.get("tab") === "private-stars";
  tab.classList.toggle("selected", selected);
  if (selected && tab.getAttribute("aria-current") !== "page") tab.setAttribute("aria-current", "page");
  if (!selected && tab.hasAttribute("aria-current")) tab.removeAttribute("aria-current");
}

function createLockIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("height", "16");
  svg.setAttribute("width", "16");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", "octicon UnderlineNav-octicon hide-sm");
  svg.append(createLockPath());
  return svg;
}

function createLockPath(): SVGPathElement {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M4.75 6V4a3.25 3.25 0 0 1 6.5 0v2h.5A2.25 2.25 0 0 1 14 8.25v5.5A2.25 2.25 0 0 1 11.75 16h-7.5A2.25 2.25 0 0 1 2 13.75v-5.5A2.25 2.25 0 0 1 4.25 6Zm1.5 0h3.5V4a1.75 1.75 0 1 0-3.5 0Zm-2 1.5a.75.75 0 0 0-.75.75v5.5c0 .414.336.75.75.75h7.5a.75.75 0 0 0 .75-.75v-5.5a.75.75 0 0 0-.75-.75Z");
  return path;
}

function mountDashboard(viewerLogin: string, starTabs: HTMLAnchorElement[]): void {
  const contentMain = findProfileContentMain(starTabs);
  if (!contentMain) return;

  startProfileSelectionGuard(viewerLogin, starTabs);

  for (const child of Array.from(contentMain.children)) {
    if (!child.querySelector('nav[aria-label="User profile"]')) child.classList.add(HIDDEN_CLASS);
  }

  const host = document.createElement("section");
  host.id = DASHBOARD_ID;
  host.setAttribute("aria-label", "Private stars");
  dashboardRoot = host.attachShadow({ mode: "closed" });
  contentMain.append(host);
  renderDashboardShell(dashboardRoot, viewerLogin);
  void loadDashboardStars(dashboardRoot, viewerLogin);
}

function startProfileSelectionGuard(viewerLogin: string, starTabs: HTMLAnchorElement[]): void {
  profileNavObserver?.disconnect();
  profileNavObserver = null;
  profileNavSyncQueued = false;

  enforceProfileSelection(viewerLogin);
  const nav = starTabs[0]?.closest("nav");
  if (!nav) return;

  profileNavObserver = new MutationObserver(() => {
    if (profileNavSyncQueued) return;
    profileNavSyncQueued = true;
    window.setTimeout(() => {
      profileNavSyncQueued = false;
      if (new URL(location.href).searchParams.get("tab") === "private-stars") {
        enforceProfileSelection(viewerLogin);
      }
    });
  });
  profileNavObserver.observe(nav, {
    attributes: true,
    attributeFilter: ["aria-current", "class", "data-active", "data-selected"],
    childList: true,
    subtree: true
  });
}

function enforceProfileSelection(viewerLogin: string): void {
  const starTabs = findStarTabs();
  for (const starsTab of starTabs) injectPrivateStarsTab(starsTab, viewerLogin);

  const profileTabs = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(`nav .${PROFILE_TAB_CLASS}`)
  );
  for (const privateTab of profileTabs) setTabSelection(privateTab);

  for (const privateTab of profileTabs) {
    const nav = privateTab.closest("nav");
    if (!nav) continue;
    for (const nativeTab of nav.querySelectorAll<HTMLAnchorElement>(
      `a:not(.${PROFILE_TAB_CLASS})`
    )) {
      if (
        nativeTab.classList.contains("selected") ||
        nativeTab.classList.contains("js-selected-navigation-item") ||
        nativeTab.getAttribute("aria-current") === "page"
      ) {
        nativeTab.classList.add(SUPPRESSED_TAB_CLASS);
        nativeTab.classList.remove("selected", "js-selected-navigation-item");
        nativeTab.removeAttribute("aria-current");
      }
    }
  }
}

function findProfileContentMain(starTabs: HTMLAnchorElement[]): Element | null {
  const profileFrame = document.querySelector("turbo-frame#user-profile-frame");
  if (profileFrame) return profileFrame;
  const mobileTab = starTabs.find((tab) => tab.closest(".user-profile-nav"));
  if (mobileTab) return mobileTab.closest(".Layout-main");
  const profileMains = Array.from(document.querySelectorAll("main .Layout-main"));
  return profileMains.at(-1) ?? null;
}

function renderDashboardShell(root: ShadowRoot, viewerLogin: string): void {
  const style = document.createElement("style");
  style.textContent = dashboardStyles;
  const shell = document.createElement("div");
  shell.className = "shell";
  shell.innerHTML = `
    <header>
      <div><h1>Private stars</h1><p>Only visible in this browser while signed in as <strong></strong>.</p></div>
      <span class="count" aria-live="polite">Loading…</span>
    </header>
    <label class="search"><span>Search</span><input type="search" placeholder="Find a private star…" disabled></label>
    <div class="notice" role="status" aria-live="polite"></div>
    <div class="list"><div class="loading">Loading your private stars…</div></div>
  `;
  const account = shell.querySelector("strong");
  if (account) account.textContent = `@${viewerLogin}`;
  root.append(style, shell);
}

async function loadDashboardStars(root: ShadowRoot, viewerLogin: string): Promise<void> {
  const response = await sendExtensionMessage({ type: "GET_PRIVATE_STARS", viewerLogin });
  if (!dashboardRoot || dashboardRoot !== root) return;
  if (!response.ok) {
    renderDashboardError(root, response.error.message);
    return;
  }

  let stars = response.data.stars;
  const input = root.querySelector<HTMLInputElement>("input[type=search]");
  if (input) {
    input.disabled = false;
    input.addEventListener("input", () => renderStarList(root, filterStars(stars, input.value), stars.length));
  }
  renderStarList(root, stars, stars.length);

  root.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.dataset.repo) return;
    target.disabled = true;
    const removeResponse = await sendExtensionMessage({
      type: "REMOVE_PRIVATE_STAR",
      repo: target.dataset.repo,
      viewerLogin
    });
    if (removeResponse.ok) {
      stars = stars.filter((star) => star.repo.toLowerCase() !== target.dataset.repo?.toLowerCase());
      if (input) input.value = "";
      renderStarList(root, stars, stars.length);
      showDashboardNotice(root, "Removed from Private Stars.", false);
    } else {
      target.disabled = false;
      showDashboardNotice(root, removeResponse.error.message, true);
    }
  });
}

function renderStarList(root: ShadowRoot, visibleStars: RepoMetadata[], total: number): void {
  const count = root.querySelector<HTMLElement>(".count");
  const list = root.querySelector<HTMLElement>(".list");
  if (!count || !list) return;
  count.textContent = `${total} private star${total === 1 ? "" : "s"}`;
  list.replaceChildren();

  if (visibleStars.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = total === 0
      ? "No Private Stars yet. Add one from a repository page."
      : "No Private Stars match this search.";
    list.append(empty);
    return;
  }

  for (const star of visibleStars) list.append(createStarCard(star));
}

function createStarCard(star: RepoMetadata): HTMLElement {
  const article = document.createElement("article");
  const body = document.createElement("div");
  body.className = "body";
  const link = document.createElement("a");
  link.href = star.url;
  link.textContent = star.repo;
  const description = document.createElement("p");
  description.textContent = star.description || "No description provided.";
  const metadata = document.createElement("div");
  metadata.className = "meta";
  const language = star.language ? `${star.language} · ` : "";
  metadata.textContent = `${language}Privately starred ${formatDate(star.starredAt)}`;
  body.append(link, description, metadata);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.dataset.repo = star.repo;
  remove.textContent = "Remove";
  remove.setAttribute("aria-label", `Remove ${star.repo} from Private Stars`);
  article.append(body, remove);
  return article;
}

function renderDashboardError(root: ShadowRoot, message: string): void {
  const count = root.querySelector<HTMLElement>(".count");
  const list = root.querySelector<HTMLElement>(".list");
  if (count) count.textContent = "Unavailable";
  if (list) {
    list.replaceChildren();
    const error = document.createElement("div");
    error.className = "empty error";
    error.textContent = message;
    list.append(error);
  }
}

function showDashboardNotice(root: ShadowRoot, message: string, error: boolean): void {
  const notice = root.querySelector<HTMLElement>(".notice");
  if (!notice) return;
  notice.textContent = message;
  notice.classList.toggle("error", error);
  window.setTimeout(() => {
    if (notice.textContent === message) notice.textContent = "";
  }, 4_000);
}

function filterStars(stars: RepoMetadata[], query: string): RepoMetadata[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return stars;
  return stars.filter((star) =>
    `${star.repo} ${star.description} ${star.language}`.toLowerCase().includes(normalized)
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function cleanupDashboard(): void {
  profileNavObserver?.disconnect();
  profileNavObserver = null;
  profileNavSyncQueued = false;
  dashboardRoot = null;
  document.getElementById(DASHBOARD_ID)?.remove();
  for (const element of document.querySelectorAll(`.${HIDDEN_CLASS}`)) element.classList.remove(HIDDEN_CLASS);
  for (const tab of document.querySelectorAll<HTMLAnchorElement>(`.${PROFILE_TAB_CLASS}`)) {
    const item = tab.parentElement;
    if (item?.tagName === "LI" && item.children.length === 1) item.remove();
    else tab.remove();
  }
  for (const tab of document.querySelectorAll<HTMLAnchorElement>(`.${SUPPRESSED_TAB_CLASS}`)) {
    tab.classList.remove(SUPPRESSED_TAB_CLASS);
    tab.classList.add("selected");
    tab.setAttribute("aria-current", "page");
  }
}

function readWebSessionLogin(): string | null {
  const metaSelectors = [
    'meta[name="user-login"]',
    'meta[name="octolytics-actor-login"]'
  ];
  for (const selector of metaSelectors) {
    const value = document.querySelector<HTMLMetaElement>(selector)?.content.trim();
    if (value) return value;
  }

  const avatar = document.querySelector<HTMLImageElement>(
    'button[aria-label*="user navigation" i] img[alt^="@"]'
  )?.alt.slice(1).trim();
  return avatar || null;
}

function inferLoginFromOwnProfile(profileLogin: string): string | null {
  const ownsProfile = Boolean(
    document.querySelector('a[href="/account"]#upload-avatar-link')
  );
  return ownsProfile ? profileLogin : null;
}

function parseProfileLogin(value: string): string | null {
  const url = new URL(value);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 1) return null;
  return decodeURIComponent(parts[0] ?? "") || null;
}

function sameLogin(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sanitizeClonedLink(link: HTMLAnchorElement): void {
  for (const attribute of Array.from(link.attributes)) {
    if (attribute.name.startsWith("data-hydro-") || attribute.name === "data-selected-links") {
      link.removeAttribute(attribute.name);
    }
  }
  link.removeAttribute("aria-current");
  link.classList.remove("selected", "js-selected-navigation-item");
}

function navigateInsideGitHub(event: MouseEvent): void {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  const link = event.currentTarget;
  if (!(link instanceof HTMLAnchorElement)) return;
  event.preventDefault();
  history.pushState({}, "", link.href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function navigateFromUserMenu(event: MouseEvent): void {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  const link = event.currentTarget;
  if (!(link instanceof HTMLAnchorElement)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  window.location.assign(link.href);
}

function installProfileStyles(): void {
  if (document.getElementById(PROFILE_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = PROFILE_STYLE_ID;
  style.textContent = `
    .${HIDDEN_CLASS} { display: none !important; }
    .${MENU_ITEM_CLASS} { white-space: nowrap !important; }
    nav .${SUPPRESSED_TAB_CLASS}::after { display: none !important; }
    nav .${PROFILE_TAB_CLASS}[aria-current="page"]::after {
      background-color: var(--underlineNav-borderColor-active, var(--borderColor-accent-emphasis, #fd8c73)) !important;
      display: block !important;
      opacity: 1 !important;
    }
  `;
  document.documentElement.append(style);
}

const dashboardStyles = `
  :host { color-scheme: light dark; display: block; }
  * { box-sizing: border-box; }
  .shell { color: var(--fgColor-default, #1f2328); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 24px 0 48px; }
  header { align-items: flex-start; border-bottom: 1px solid var(--borderColor-default, #d0d7de); display: flex; justify-content: space-between; padding-bottom: 20px; }
  h1 { font-size: 24px; font-weight: 600; line-height: 1.25; margin: 0 0 4px; }
  header p { color: var(--fgColor-muted, #656d76); margin: 0; }
  .count { background: var(--bgColor-neutral-muted, rgba(175,184,193,.2)); border-radius: 20px; color: var(--fgColor-muted, #656d76); font-size: 12px; font-weight: 600; padding: 3px 9px; white-space: nowrap; }
  .search { display: block; margin: 20px 0 8px; }
  .search span { display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px; }
  input { background: var(--bgColor-default, #fff); border: 1px solid var(--borderColor-default, #d0d7de); border-radius: 6px; color: inherit; font: inherit; max-width: 360px; padding: 7px 10px; width: 100%; }
  input:focus { border-color: var(--focus-outlineColor, #0969da); box-shadow: 0 0 0 3px rgba(9,105,218,.2); outline: none; }
  .notice { color: var(--fgColor-success, #1a7f37); min-height: 24px; padding: 4px 0; }
  .notice.error, .error { color: var(--fgColor-danger, #cf222e); }
  article { align-items: flex-start; border-top: 1px solid var(--borderColor-muted, #d8dee4); display: flex; gap: 24px; justify-content: space-between; padding: 24px 0; }
  article:first-child { border-top: 0; }
  .body { min-width: 0; }
  article a { color: var(--fgColor-accent, #0969da); font-size: 18px; font-weight: 600; text-decoration: none; }
  article a:hover { text-decoration: underline; }
  article p { color: var(--fgColor-muted, #656d76); margin: 8px 0; overflow-wrap: anywhere; }
  .meta { color: var(--fgColor-muted, #656d76); font-size: 12px; }
  button { background: var(--button-default-bgColor-rest, #f6f8fa); border: 1px solid var(--button-default-borderColor-rest, #d0d7de); border-radius: 6px; color: var(--fgColor-danger, #cf222e); cursor: pointer; font-family: inherit; font-size: 12px; font-weight: 600; line-height: 20px; padding: 3px 12px; }
  button:disabled { cursor: wait; opacity: .65; }
  .loading, .empty { border: 1px dashed var(--borderColor-default, #d0d7de); border-radius: 8px; color: var(--fgColor-muted, #656d76); margin-top: 16px; padding: 48px 24px; text-align: center; }
  @media (max-width: 600px) { .shell { padding-inline: 16px; } header { gap: 12px; } article { gap: 12px; } }
`;
