import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { setImmediate as flushMessages } from "node:timers/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const source = await readFile("src/content/index.ts", "utf8");
const bundle = await build({
  stdin: { contents: source, resolveDir: resolve("src/content"), loader: "ts" },
  bundle: true,
  write: false,
  format: "iife",
  target: "chrome120"
});
const script = bundle.outputFiles[0].text;
const repository = "KodySimpson/minecraft-plugin-tutorial";
const wrapperId = "github-private-star-wrapper";
const meta = `<meta name="octolytics-dimension-repository_nwo" content="${repository}">`;
// Minimal structure observed on GitHub on 2026-10-27. No generated CSS classes.
const reactHeader = '<ul data-testid="repo-header-actions"><li><button data-testid="star-button">Star</button></li></ul>';

function startPage(t, html = reactHeader, path = repository) {
  const dom = new JSDOM(`${meta}<body>${html}</body>`, {
    url: `https://github.com/${path}`,
    runScripts: "outside-only"
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  const intervals = [];
  const timeouts = [];
  const messages = [];
  window.setInterval = (callback) => intervals.push(callback);
  window.setTimeout = (callback, delay) => timeouts.push({ callback, delay });
  window.clearTimeout = () => {};
  window.chrome = { runtime: { sendMessage: async (message) => {
    messages.push(message);
    if (message.type === "GET_PRIVATE_STAR_STATUS") return { ok: true, data: { starred: false } };
    if (message.type === "TOGGLE_PRIVATE_STAR") return { ok: true, data: { starred: true } };
    throw new Error(`Unexpected message: ${message.type}`);
  } } };
  window.eval(script);
  return {
    window,
    document: window.document,
    messages,
    tick: () => intervals.forEach((callback) => callback()),
    expireMount: () => timeouts.filter(({ delay }) => delay === 15_000).forEach(({ callback }) => callback())
  };
}

function button(document) {
  const element = document.querySelector(`#${wrapperId} button`);
  assert.ok(element, "Private Star button should be mounted");
  return element;
}

test("mounts one button beside the native React repository actions", async (t) => {
  const page = startPage(t);
  await flushMessages();
  page.tick();
  page.tick();
  assert.equal(page.document.querySelectorAll(`#${wrapperId}`).length, 1);
  assert.equal(button(page.document).disabled, false);
  assert.equal(page.document.getElementById(wrapperId).parentElement.dataset.testid, "repo-header-actions");
  assert.equal(page.messages.length, 1);
});

test("uses the new actions list even when the native Star test ID is absent", (t) => {
  const page = startPage(t, '<ul data-testid="repo-header-actions"><li><button>Unstar</button></li></ul>');
  button(page.document);
});

test("restores the button after React replaces the header at the same URL", async (t) => {
  const page = startPage(t);
  await flushMessages();
  page.document.querySelector('[data-testid="repo-header-actions"]').outerHTML = reactHeader;
  assert.equal(page.document.getElementById(wrapperId), null);
  page.tick();
  await flushMessages();
  assert.equal(button(page.document).disabled, false);
  assert.equal(page.messages.length, 2);
});

test("recovers when the header arrives after the initial mount timeout", (t) => {
  const page = startPage(t, "<main>Loading repository</main>");
  page.expireMount();
  page.document.body.insertAdjacentHTML("afterbegin", reactHeader);
  page.tick();
  button(page.document);
});

test("preserves legacy form and pagehead placements", (t) => {
  for (const html of [
    `<ul><li><form action="/${repository}/star"></form></li></ul>`,
    `<ul><li><form action="/${repository}/unstar"></form></li></ul>`,
    '<ul class="pagehead-actions"></ul>'
  ]) {
    const page = startPage(t, html);
    button(page.document);
    assert.equal(page.document.getElementById(wrapperId).tagName, "LI");
  }
});

test("removes the button when navigating away and mounts for the next repository", async (t) => {
  const page = startPage(t);
  await flushMessages();
  page.window.history.pushState({}, "", "/explore");
  page.tick();
  assert.equal(page.document.getElementById(wrapperId), null);
  page.tick();
  assert.equal(page.document.getElementById(wrapperId), null);
  page.window.history.pushState({}, "", "/octocat/Hello-World");
  page.document.querySelector('meta[name="octolytics-dimension-repository_nwo"]').content = "octocat/Hello-World";
  page.tick();
  await flushMessages();
  button(page.document);
  assert.equal(page.messages.at(-1).repo, "octocat/Hello-World");
});

test("waits for matching repository metadata during navigation", async (t) => {
  const page = startPage(t);
  await flushMessages();
  page.window.history.pushState({}, "", "/octocat/Hello-World");
  page.tick();
  assert.equal(page.document.getElementById(wrapperId), null);
  page.document.querySelector('meta[name="octolytics-dimension-repository_nwo"]').content = "octocat/Hello-World";
  page.tick();
  button(page.document);
});

test("the restored button still sends toggle messages and updates its state", async (t) => {
  const page = startPage(t);
  await flushMessages();
  page.document.getElementById(wrapperId).remove();
  page.tick();
  await flushMessages();
  button(page.document).click();
  await flushMessages();
  assert.equal(button(page.document).getAttribute("aria-pressed"), "true");
  assert.deepEqual(JSON.parse(JSON.stringify(page.messages.at(-1))), {
    type: "TOGGLE_PRIVATE_STAR",
    repo: { owner: "KodySimpson", name: "minecraft-plugin-tutorial" }
  });
});
