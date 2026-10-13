import { ROOM_URL_PREFIX, SELECTORS } from "./config";
import { deepQueryAll, isVisible } from "./dom";
import { getRooms, isOnChatListView } from "./rooms";
import type { PreflightCheck } from "../shared/types";

/**
 * Confirms the page looks like the Reddit chat list before any run starts.
 * Used by Start and by the "Check page" button. Makes no changes to the page.
 */
export function runPreflight(): PreflightCheck[] {
  const onChatUrl = location.href
    .toLowerCase()
    .startsWith(ROOM_URL_PREFIX.toLowerCase());

  const navVisible = deepQueryAll(SELECTORS.roomsNav).some(isVisible);
  const roomCount = getRooms().length;

  return [
    {
      name: "url",
      ok: onChatUrl,
      detail: onChatUrl
        ? "On reddit.com/chat."
        : "Open https://www.reddit.com/chat in this tab first.",
    },
    {
      name: "rooms-nav",
      ok: navVisible,
      detail: navVisible
        ? "Chat list panel found."
        : "Chat list panel not found. Reddit may have changed its layout, or the list has not loaded yet.",
    },
    {
      name: "rooms-rendered",
      ok: roomCount > 0 && isOnChatListView(),
      detail:
        roomCount > 0
          ? `${roomCount} chat(s) rendered in the list.`
          : "No chats rendered. Wait for the list to load, then try again.",
    },
  ];
}

/**
 * Environment report for bug reports. Contains no usernames, room names,
 * room ids, or message text.
 */
export function collectDiagnostics(): Record<string, unknown> {
  const tagCounts = Object.fromEntries(
    SELECTORS.diagnosticTags.map((tag) => [
      tag,
      deepQueryAll(tag).length,
    ]),
  );

  return {
    generatedAt: new Date().toISOString(),
    extensionVersion: chrome.runtime.getManifest().version,
    userAgent: navigator.userAgent,
    pathShape: location.pathname.replace(/\/room\/[^/]+/, "/room/<redacted>"),
    onChatList: isOnChatListView(),
    roomsRendered: getRooms().length,
    elementCounts: tagCounts,
    note: "No usernames, room names, or message text are included.",
  };
}
