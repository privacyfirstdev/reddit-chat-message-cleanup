# Chat Message Cleanup for Reddit (Chrome extension)

Manifest V3 port of `../reddit-chat-cleanup.js`. Deletes your own messages from your Reddit chats and can hide chats that had none. Not affiliated with Reddit.

## Build

Requires Node 18 or newer. Node 22 is not needed. This uses esbuild and TypeScript rather than WXT, because WXT requires Node 22.

```bash
npm install
npm run typecheck
npm run build
```

## Load it (developer mode)

1. Open `chrome://extensions` and turn on Developer mode.
2. Click "Load unpacked" and choose the `dist/` folder.
3. Open https://www.reddit.com/chat in a tab, then click the extension icon.

## How it works

- No host permissions. The extension gets access to the active tab only when you open the popup (`activeTab`). The content script is injected on demand with `chrome.scripting`.
- The content script owns the run. Closing the popup does not stop it. Reopening the popup asks the running script for its state.
- **Test mode is on by default.** It counts matches and deletes nothing. The button reads "Count matches". Turn test mode off and the button reads "Start deleting", which deletes straight away with no second confirmation.
- The "Yes, delete" confirmations for single messages are clicked automatically. Anything that mentions a whole chat or conversation is left for you.
- Runs pause while the tab is hidden.

## Layout

| File | Purpose |
| --- | --- |
| `src/content/config.ts` | Timing, rate limit, and every Reddit selector. Fix breakage here first. |
| `src/content/dom.ts` | Shadow-DOM-aware query helpers. |
| `src/content/rooms.ts` | Chat list: find, scroll, open, return. |
| `src/content/messages.ts` | Own-message detection, delete flow, rate limit, hidden-tab pause. |
| `src/content/confirm.ts` | "Yes, delete" watcher and stray-dialog cleanup. |
| `src/content/sweep.ts` | Per-chat scan, including test-mode counting. |
| `src/content/hide-chat.ts` | Hide-chat flow (unverified, opt-in). |
| `src/content/preflight.ts` | Page checks and the diagnostics report. |
| `src/content/run.ts` | Run loop. |
| `src/popup/*` | Popup UI, styled to the privacy-first-dev design (light theme only). |
| `src/popup/fonts/` | Figtree, self-hosted (OFL). No remote fonts. |
| `src/icons/` | R icon for the toolbar and Web Store listing, from privacy-first-dev. |

## Known gaps

- **Not tested against live Reddit.** The DOM logic was ported from the console script. Use "Check page" and test mode before any live run.
- Test mode does not open reply threads, so it undercounts. It also never hides chats.
- Test-mode dedupe keys on message `data-id`. If a message has no `data-id`, the counts can merge.
- `openRoom()` now detects "list gone" by list visibility, not by counting rows. This changed the original logic and needs checking against the live site.
- Hide-chat is unverified. Keep `hideEmptyChats` off unless you have tested it.
- Store listing still needs a privacy policy URL, screenshots, and permission justifications.
