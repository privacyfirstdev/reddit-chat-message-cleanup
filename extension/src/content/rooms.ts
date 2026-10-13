import { ACTIONABLE, SELECTORS, TUNING } from "./config";
import {
  deepQueryAll,
  deepText,
  getScrollable,
  hasAncestorTag,
  isVisible,
  localQuery,
  parentAcrossShadow,
  sleep,
  waitFor,
} from "./dom";
import { log, warn } from "./state";
import { getEvents } from "./messages";

export function getRooms(): HTMLElement[] {
  return deepQueryAll<HTMLElement>(SELECTORS.room).filter(isVisible);
}

export function roomId(room: Element): string | null {
  return room.getAttribute("room") || null;
}

export function roomName(room: Element): string {
  return (
    localQuery(room, SELECTORS.roomName)?.textContent?.trim() ||
    room.getAttribute("aria-label") ||
    roomId(room) ||
    "Unknown chat"
  );
}

/*
 * The rooms-nav panel is a more stable "we're on the list" signal than
 * requiring room rows. An empty or still-rendering list would still
 * pass this check.
 */
export function isOnChatListView(): boolean {
  return (
    deepQueryAll(SELECTORS.roomsNav).some(isVisible) ||
    getRooms().length > 0
  );
}

export function findFreshRoom(targetId: string): HTMLElement | null {
  return (
    getRooms().find(
      (room) => roomId(room) === targetId && room.isConnected,
    ) || null
  );
}

export function findChatListScrollable(): Element | null {
  const nav = deepQueryAll(SELECTORS.roomsNav).find(isVisible);
  const firstRoom = getRooms()[0];
  const roots = [nav, firstRoom].filter(
    (root): root is HTMLElement => Boolean(root),
  );

  const candidates = new Set<Element>();

  for (const root of roots) {
    candidates.add(root);

    for (const element of deepQueryAll("*", root)) {
      candidates.add(element);
    }
  }

  const scrollables = [...candidates]
    .filter(
      (element) =>
        isVisible(element) &&
        element.scrollHeight > element.clientHeight + 2,
    )
    .sort(
      (a, b) =>
        b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight),
    );

  return (
    scrollables[0] ||
    (firstRoom ? getScrollable(firstRoom) : null)
  );
}

/*
 * The chat list is virtualized, so only a window of rooms is mounted at a
 * time. Returning to the list resets scroll, so a room that was found
 * earlier may need a fresh scroll pass to become mounted again.
 */
export async function scrollListToFindRoom(
  targetId: string,
): Promise<HTMLElement | null> {
  const direct = findFreshRoom(targetId);

  if (direct) {
    return direct;
  }

  let stalls = 0;

  for (let i = 0; i < 80; i += 1) {
    const found = findFreshRoom(targetId);

    if (found) {
      return found;
    }

    const scroller = findChatListScrollable();

    if (!scroller) {
      break;
    }

    const beforeTop = scroller.scrollTop;
    const beforeHeight = scroller.scrollHeight;

    scroller.scrollTop = Math.min(
      scroller.scrollHeight,
      scroller.scrollTop + Math.max(500, scroller.clientHeight * 0.75),
    );

    await sleep(300);

    const moved =
      scroller.scrollTop !== beforeTop ||
      scroller.scrollHeight !== beforeHeight;

    stalls = moved ? 0 : stalls + 1;

    if (stalls >= 4) {
      break;
    }
  }

  return findFreshRoom(targetId);
}

function findBackToListControl(): HTMLElement | null {
  const scored = deepQueryAll<HTMLElement>(ACTIONABLE + ", a")
    .filter(isVisible)
    .map((element) => {
      const text = deepText(element).toLowerCase();
      const href = element.getAttribute("href") || "";

      let score = 0;

      if (/^back$|back to chats|all chats|chat list/.test(text)) {
        score = 100;
      } else if (/\bback\b/.test(text)) {
        score = 80;
      } else if (/\bchats\b/.test(text)) {
        score = 60;
      }

      try {
        const url = href ? new URL(href, location.href) : null;

        if (url && url.pathname.replace(/\/$/, "") === "/chat") {
          score = Math.max(score, 90);
        }
      } catch {
        // Ignore invalid URLs.
      }

      return { element, score };
    });

  return (
    scored
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.element || null
  );
}

/** Gets back to the room list, trying the back control first and browser history second. */
export async function returnToChatList(): Promise<boolean> {
  const rounds = 3;

  for (let round = 1; round <= rounds; round += 1) {
    if (isOnChatListView()) {
      return true;
    }

    const control = findBackToListControl();

    if (control) {
      const actual =
        localQuery<HTMLElement>(control, ACTIONABLE) || control;

      log(
        `Returning to chat list via: ${
          deepText(control).slice(0, 60) || control.tagName
        } (attempt ${round}/${rounds})`,
      );

      actual.click();

      if (await waitFor(() => isOnChatListView(), 6000, 75)) {
        return true;
      }
    }

    log(
      `Returning to chat list with browser history (attempt ${round}/${rounds}).`,
    );
    history.back();

    if (await waitFor(() => isOnChatListView(), 8000, 100)) {
      return true;
    }

    if (round < rounds) {
      warn("Chat list still not visible. Pausing briefly before retrying.");
      await sleep(600);
    }
  }

  // One last check in case the list finished rendering during the final wait.
  return isOnChatListView();
}

/** The element that holds a room's conversation, or null if none is rendered. */
export function findMainContainer(): Element | null {
  const timelines = deepQueryAll(SELECTORS.timeline).filter(
    (element) =>
      isVisible(element) &&
      !hasThreadAncestor(element),
  );

  if (timelines.length) {
    return timelines[0];
  }

  const legacy = deepQueryAll(SELECTORS.legacyRoomMessages).filter(isVisible);

  if (legacy.length) {
    return legacy[0];
  }

  const virtualScroll = deepQueryAll(SELECTORS.virtualScroll).find(
    (element) =>
      isVisible(element) &&
      hasAncestorTag(element, SELECTORS.roomContainer) &&
      !hasThreadAncestor(element),
  );

  if (virtualScroll) {
    return virtualScroll;
  }

  /*
   * Last-resort fallback: walk up from the first message's parent (never
   * the message itself) to the ancestor that wraps the most messages.
   */
  const events = deepQueryAll(SELECTORS.event).filter(
    (event) => isVisible(event) && !hasThreadAncestor(event),
  );

  if (!events.length) {
    return null;
  }

  const countTopLevel = (node: Element) =>
    getEvents(node).filter((event) => !hasThreadAncestor(event)).length;

  let current: Element | null = parentAcrossShadow(events[0]);
  let best: Element | null = current;
  let bestCount = current ? countTopLevel(current) : 0;

  for (let i = 0; i < 12 && current; i += 1) {
    const count = countTopLevel(current);

    if (count >= bestCount) {
      best = current;
      bestCount = count;
    }

    current = parentAcrossShadow(current);
  }

  return best;
}

function hasThreadAncestor(element: Element): boolean {
  return hasAncestorTag(element, SELECTORS.threadTimeline);
}

/** Opens a room from the list. Returns its container, or null if it could not be opened. */
export async function openRoom(
  targetId: string,
  targetName: string,
): Promise<Element | null> {
  if (!(await returnToChatList())) {
    return null;
  }

  const room = await scrollListToFindRoom(targetId);

  if (!room) {
    warn(
      `Room is not currently rendered: ${targetName} (scrolled the full list and still couldn't find it)`,
    );
    return null;
  }

  const beforeContainer = findMainContainer();
  const beforeUrl = location.href;

  room.scrollIntoView({ block: "center" });
  await sleep(60);

  const clickable: HTMLElement = localQuery<HTMLElement>(room, "a") || room;

  log(`Clicking room: ${targetName}`);
  clickable.click();

  return waitFor(
    () => {
      const container = findMainContainer();

      if (!container) {
        return null;
      }

      /*
       * "List gone" is checked by the list's own visibility, not by counting
       * rows. A row count of 0 can mean the list is still rendering.
       */
      const listGone = !isOnChatListView();
      const changed = container !== beforeContainer;
      const urlChanged = location.href !== beforeUrl;
      const hasMessageUI =
        getEvents(container).length > 0 ||
        deepQueryAll(SELECTORS.legacyRoomMessages, container).length > 0;

      return listGone || changed || urlChanged || hasMessageUI
        ? container
        : null;
    },
    TUNING.navigationWaitMs,
    75,
  );
}
