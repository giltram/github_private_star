# Architecture

GitHub Private Star is a Manifest V3 Chrome extension. All code is bundled by
`scripts/build.mjs` into three independent entry points in `dist/`.

## Modules and dependency direction

- `src/content/index.ts` owns repository route detection, button placement, status,
  and toggle UI. It calls the profile UI and the shared message client.
- `src/content/profile.ts` owns profile tabs, the private stars dashboard, and user
  menu integration. It calls only shared messages/types.
- `src/options/index.ts` owns configuration and connection testing, using shared
  configuration and messages.
- `src/background/index.ts` handles runtime messages, validates the configured
  account for dashboard requests, and orchestrates storage and repository metadata.
- `src/storage/privateStars.ts` owns `stars.json`, the local cache, schema validation,
  and conflict retries. It depends on the GitHub client and shared types.
- `src/github/api.ts` owns authenticated HTTP requests and API error translation;
  `src/github/types.ts` defines the responses it consumes.
- `src/shared/` owns configuration, runtime message contracts, and stored data types.

Content/options communicate with background through the typed contract in
`src/shared/messages.ts`. GitHub credentials remain in trusted extension storage;
content scripts do not read them. Dependencies point from entry points to storage,
GitHub, and shared contracts. Lower layers must not import their consumers.

## Repository button lifecycle

`checkRoute` runs initially, on navigation events, and every 800 ms. A URL change
increments a generation counter, removes obsolete UI, and starts mounting for a
repository root URL (`/owner/name`). Async responses are ignored if their button
was detached or their generation is obsolete.

The initial mount observes DOM changes for up to 15 seconds. The regular route
check also reconciles a missing button when the URL stays unchanged: GitHub's React
header may replace injected DOM, or arrive after the initial observer expires.
Existing buttons are reused; reconciliation does not issue requests while mounted.
Repository metadata, when present, must match the active route before mounting.

Placement prefers `[data-testid="repo-header-actions"]` (observed on GitHub on
2026-10-27), then legacy star/unstar forms, `star-button`, and old actions lists.
Avoid generated React CSS class names. The injected wrapper is an `li` inside a
list and a `span` otherwise. Repository subpages are currently outside the button's
supported routes.

## Verification

`npm test` bundles the real content entry point and runs it against isolated JSDOM
pages with mocked Chrome messages. Tests cover current/legacy headers, replacement,
late arrival, route transitions, metadata guards, deduplication, and button behavior.
No test makes GitHub requests or changes private bookmarks.

The header replacement and late-arrival scenarios reproduced missing buttons with
the original content entry point. These are controlled DOM regressions, not proof
of the timing of GitHub's rollout or a specific user's browser behavior.

Run `npm run typecheck` and `npm run build` before reloading the unpacked extension.
