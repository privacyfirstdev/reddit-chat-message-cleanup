# Privacy Policy: Chat Message Cleanup for Reddit

**Effective date:** [EFFECTIVE DATE]
**Developer contact:** [CONTACT EMAIL]

> DRAFT. Have a lawyer review before publishing. Not legal advice.

## Summary

The extension does not collect, store, transmit, sell, or share any personal data. It has no accounts, no analytics, no advertising, and no servers. Everything it does happens inside the browser tab you choose, on your own machine.

## What the extension processes (locally only)

When you use the extension on a Reddit chat page, it processes the following inside your browser:

- **Your Reddit username**, which you type into the popup. It is kept in memory for the duration of a run and is never saved to disk or sent anywhere.
- **Chat list and message content** as it appears on the page. The extension reads this in order to find your messages and delete them. It does not copy or store message text.
- **A run log** shown in the popup, which may include chat names and short message identifiers. It is held in memory and cleared when the tab reloads or the browser closes.

## What the extension does not do

- It does not send any data to the developer or to any third party.
- It does not use `localStorage`, `chrome.storage`, cookies, or IndexedDB to save your data.
- It does not make network requests of its own. Its only effect on Reddit is the same actions you would take through Reddit's own interface (deleting messages, and optionally hiding chats).
- It does not load or run remote code.

## Diagnostics

The "Copy diagnostics" button builds a report on your clipboard when you click it. The report includes the extension version, browser user agent, page path shape, and element counts. It does not include usernames, chat names, room IDs, or message text. Nothing is sent anywhere; you decide whether to paste the report somewhere.

## Permissions and why they are needed

- **activeTab:** Grants access to the Reddit chat tab you have open, and only after you click the extension icon. It is what lets the extension act on that one tab.
- **scripting:** Injects the extension's script into that tab so it can read the page and perform deletions.

The extension does not request access to all websites.

## Reddit's data handling

Reddit's own privacy policy and user agreement govern your data on Reddit. This policy does not change them. Deleting a message through this extension has the same effect as deleting it through Reddit.

## Children

The extension is not directed at children under 13 and does not knowingly process their data.

## Changes to this policy

If the extension's data handling changes, we will update this policy and the version history, and we will tell users through the store listing and in release notes before the change takes effect. Any change that adds data collection requires a new consent step in the extension.

## Contact

[CONTACT EMAIL]
