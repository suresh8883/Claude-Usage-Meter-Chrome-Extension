# Privacy Policy — Usage Meter for Claude

_Last updated: 19 June 2026_

Usage Meter for Claude ("the extension") is a browser extension that displays
your own Claude usage on claude.ai. This policy explains exactly what it does
with data.

## What the extension accesses

When you are signed in to claude.ai, the extension calls Claude's own usage
endpoints using your existing browser session:

- `GET https://claude.ai/api/organizations` — to find your organization id.
- `GET https://claude.ai/api/organizations/{id}/usage` — to read your 5-hour and
  weekly usage percentages and reset times.

This is the same data shown on claude.ai's own Settings → Usage page.

## What it stores

The extension stores the following **locally on your device only**, using the
browser's `chrome.storage.local`:

- Your display settings (refresh interval, minimized/hidden state).
- Your Claude organization id and the most recent usage numbers (so the bar can
  appear instantly the next time you open claude.ai).

## What it does NOT do

- It does **not** send any data to the developer or to any third-party server.
- It does **not** use analytics, tracking, advertising, or fingerprinting.
- It does **not** sell or share any data with anyone.
- It does **not** store your password or your session cookies.
- It does **not** collect names, emails, or other personal information.

All processing happens inside your own browser, between your browser and
claude.ai. Nothing leaves your machine.

## Permissions

- `storage` — to save your settings and cache the latest usage numbers locally.
- Host access to `https://claude.ai/*` — to read your usage from Claude's API.

## Data retention and removal

Cached usage and settings remain in your browser until you clear them. Removing
the extension deletes all of its locally stored data.

## Contact

Questions about this policy: `<your-contact-email>`

## Disclaimer

This extension is an independent project and is **not affiliated with, endorsed
by, or sponsored by Anthropic**. "Claude" is a trademark of Anthropic.
