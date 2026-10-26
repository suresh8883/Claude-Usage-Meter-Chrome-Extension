# Usage Meter for Claude (Chrome extension)

Shows the signed-in user's Claude **5-hour** and **weekly** usage as a small bar above the
composer on claude.ai, so they stop opening Settings → Usage. Open source (MIT), published by
Suresh (suresh8883). Live on the Chrome Web Store since June 2026:
https://chromewebstore.google.com/detail/jlohkbicmcebjejobahelcfbdmhjfdie (support = this repo's issues).
Store-facing copy (name, description, PRIVACY) is reviewed by Google; ask before changing it.

**Read this file first. It replaces exploring the project.**

## Orientation

| | |
|---|---|
| Stack | Manifest V3, plain ES5-style JS, CSS. No build step, no dependencies, no package.json. |
| Entry points | `src/content.js` (fetch + render, all logic), `popup.html`/`popup.js` (toolbar popup), `manifest.json` |
| Test | `node test/parse.test.js` (13 checks, ~0.1 s; Node 24 on this Mac via `mise`) |
| Run locally | `chrome://extensions` → Developer mode → Load unpacked → this folder → reload claude.ai |
| Deploy | Manual: zip the folder, upload in the Chrome Web Store developer dashboard. No CI. |

Version lives in `manifest.json` (`"version"`); bump it in the same commit as any user-visible
change (commit history: `Fix: ...; v0.3.5`).

## Hard rules

1. **Privacy promises in `PRIVACY.md` are a contract.** No network request to any origin other
   than `claude.ai` (same-origin `fetch` only), no analytics, no new data in `chrome.storage`
   beyond settings, org id and the latest usage numbers. If a change needs more, update
   `PRIVACY.md` and `privacy.html` (kept identical in content) in the same PR. Advisory, no hook.
2. **Permissions stay minimal:** `storage` plus host access to `https://claude.ai/*` and
   `https://*.claude.ai/*`. Adding a permission triggers a new store review and a user warning;
   do not add one casually. The popup uses `chrome.tabs.query`/`sendMessage` without the `tabs`
   permission on purpose: host permissions already expose the URL for claude.ai tabs.
3. **`utilization` from the usage API is already 0-100.** Never rescale it (the "fraction"
   heuristic once rendered 1% as 100%). `test/parse.test.js` guards this; keep it green.
4. **The content script runs in the ISOLATED world at `document_start`** and must stay
   self-contained (one IIFE, no modules, no imports). The test extracts `oneNode()` from the
   source by brace-matching, so keep that function name and shape.
5. **Not affiliated with Anthropic.** Keep the trademark disclaimer in README, PRIVACY.md and
   privacy.html; never phrase copy as official Claude functionality.

## How it works (open `src/content.js` first)

- `GET /api/organizations` (prefers the org with the `chat` capability) → `GET
  /api/organizations/{id}/usage` → `five_hour` / `seven_day` `{utilization, resets_at}`.
  Unofficial endpoint; `parseUsage()` has a fallback key scan in case Anthropic renames fields.
- Anchor = the composer (`div[contenteditable]` / `textarea`, then its `form`/`fieldset`). Bar
  is inserted before it and re-attached on DOM mutations; built once, then only mutated.
- Polls every `pollSeconds` (min 10) while visible, refreshes after a reply (stop → send
  button transition), caches in `chrome.storage.local` for instant paint next load.
- Popup ↔ content messages: `cum-poll`, `cum-status`. All DOM ids/classes are prefixed `cum-`.
- Theming follows `html[data-mode]` on claude.ai, then `prefers-color-scheme`.

## Workflow

- Branch from `main`, open a PR; agents may commit and push on feature branches, never to `main`.
- Definition of done: `node test/parse.test.js` green, extension reloaded unpacked and the bar
  verified on claude.ai in light and dark mode, version bumped, PRIVACY.md still accurate.
- Known rough edges (fix only when asked): `PRIVACY.md`/`privacy.html` contact is a
  `<your-contact-email>` placeholder; `.github/ISSUE_TEMPLATE/bug_report.md` is the GitHub
  default (asks about smartphones); `staleMinutes` is not exposed in the popup.
