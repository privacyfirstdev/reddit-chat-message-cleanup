(async () => {
  "use strict";

  const CFG = {
    /*
     * maxDeletesPerMinute is the one knob here with real
     * Reddit-side risk (server-side rate limiting/flagging) if
     * pushed too far, so it's raised more conservatively than
     * the rest. Dial it back toward 40 if you start seeing
     * rate-limit pauses or odd behavior from Reddit itself.
     */
    maxDeletesPerMinute: 70,
    deleteAttempts: 3,
    deleteVerifyMs: 4000,
    navigationWaitMs: 5500,
    scrollWaitMs: 350,
    delayAfterDeleteMs: 225,
    topStalls: 4,
    listStalls: 5,
    cleanupPasses: 2,
    autoConfirmPollMs: 40,
    /*
     * When true, a chat gets hidden (via its room settings) if
     * the sweep verified complete AND zero of your messages were
     * ever found in it — i.e. there was nothing to delete. Chats
     * where messages WERE found and deleted are left visible.
     * Set to false to disable entirely.
     */
    hideEmptyChats: true,
  };

  if (!/^https:\/\/www\.reddit\.com\/chat/i.test(location.href)) {
    throw new Error(
      "Open https://www.reddit.com/chat before running this script.",
    );
  }

  const entered = prompt(
    "Your Reddit username (without u/):",
    "",
  );

  const USERNAME = String(entered || "")
    .trim()
    .replace(/^u\//i, "");

  if (!USERNAME) {
    console.warn(
      "[Reddit cleanup] Cancelled: no username supplied.",
    );
    return;
  }

  const maxChatsEntered = prompt(
    "Max number of chats to process (leave blank for no limit):",
    "3",
  );

  const maxChatsRaw = String(maxChatsEntered ?? "").trim();

  let parsedMaxChats;

  if (maxChatsRaw === "") {
    parsedMaxChats = Infinity;
  } else {
    const asNumber = Number(maxChatsRaw);

    if (Number.isFinite(asNumber) && asNumber > 0) {
      parsedMaxChats = Math.floor(asNumber);
    } else {
      console.warn(
        `[Reddit cleanup] "${maxChatsRaw}" isn't a valid positive number — defaulting to no limit.`,
      );
      parsedMaxChats = Infinity;
    }
  }

  CFG.maxChats = parsedMaxChats;

  const maxChatsLabel =
    CFG.maxChats === Infinity
      ? "no limit"
      : String(CFG.maxChats);

  if (
    !confirm(
      `Permanently delete messages sent by u/${USERNAME}?\n\n` +
        `This run processes ${
          CFG.maxChats === Infinity
            ? "ALL chats (no limit)"
            : `at most ${maxChatsLabel} chats`
        } and cannot be undone.\n\n` +
        (CFG.hideEmptyChats
          ? "Chats with none of your messages will also be hidden (not deleted — just removed from your default chat list)."
          : ""),
    )
  ) {
    console.warn("[Reddit cleanup] Cancelled.");
    return;
  }

  if (window.__redditChatDeleteRunning) {
    console.warn(
      "[Reddit cleanup] Another cleanup run is already active.",
    );
    return;
  }

  window.__redditChatDeleteRunning = true;
  window.__redditChatDeleteStop = false;

  const results = {
    username: USERNAME,
    startedAt: new Date().toISOString(),
    chatsAttempted: 0,
    chatsComplete: 0,
    chatsHidden: 0,
    messagesDeleted: 0,
    confirmationsClicked: 0,
    failures: [],
  };

  window.__redditChatDeleteResults = results;

  const sleep = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const stopped = () =>
    window.__redditChatDeleteStop === true;

  const log = (message, ...rest) =>
    console.log(
      `[Reddit cleanup] ${message}`,
      ...rest,
    );

  const warn = (message, ...rest) =>
    console.warn(
      `[Reddit cleanup] ${message}`,
      ...rest,
    );

  const escapeRegExp = (value) =>
    String(value).replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );

  async function waitFor(
    fn,
    timeoutMs,
    intervalMs = 100,
  ) {
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      if (stopped()) {
        return null;
      }

      try {
        const value = fn();

        if (value) {
          return value;
        }
      } catch (_) {
        // Continue polling.
      }

      await sleep(intervalMs);
    }

    return null;
  }

  function* deepNodes(root = document) {
    if (!root) {
      return;
    }

    yield root;

    if (
      root instanceof Element &&
      root.shadowRoot
    ) {
      yield* deepNodes(root.shadowRoot);
    }

    if (!root.querySelectorAll) {
      return;
    }

    for (const element of root.querySelectorAll("*")) {
      if (element.shadowRoot) {
        yield* deepNodes(element.shadowRoot);
      }
    }
  }

  function deepQueryAll(
    selector,
    root = document,
  ) {
    const found = [];

    for (const node of deepNodes(root)) {
      if (!node.querySelectorAll) {
        continue;
      }

      try {
        found.push(...node.querySelectorAll(selector));
      } catch (_) {
        // Ignore unsupported selector/root combinations.
      }
    }

    return [...new Set(found)];
  }

  function localQuery(root, selector) {
    if (!root) {
      return null;
    }

    for (const node of deepNodes(root)) {
      if (!node.querySelector) {
        continue;
      }

      try {
        const found = node.querySelector(selector);

        if (found) {
          return found;
        }
      } catch (_) {
        // Ignore unsupported selector/root combinations.
      }
    }

    return null;
  }

  function isVisible(element) {
    if (
      !element ||
      !element.isConnected
    ) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
  }

  function parentAcrossShadow(node) {
    if (!node) {
      return null;
    }

    return node.parentNode instanceof ShadowRoot
      ? node.parentNode.host
      : node.parentElement;
  }

  function hasAncestorTag(
    element,
    tagName,
  ) {
    const target = String(tagName).toUpperCase();
    let current = element;

    while (current) {
      if (current.tagName === target) {
        return true;
      }

      current = parentAcrossShadow(current);
    }

    return false;
  }

  function deepText(element) {
    if (!element) {
      return "";
    }

    return [
      element.getAttribute?.("aria-label") || "",
      element.getAttribute?.("title") || "",
      element.getAttribute?.("icon") || "",
      element.getAttribute?.("data-testid") || "",
      element.innerText || "",
      element.textContent || "",
      element.shadowRoot?.textContent || "",
    ]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getScrollable(container) {
    let current = container;

    for (let i = 0; i < 18 && current; i += 1) {
      const element =
        current instanceof ShadowRoot
          ? current.host
          : current;

      if (element instanceof Element) {
        const style = getComputedStyle(element);

        if (
          /(auto|scroll)/.test(style.overflowY) &&
          element.scrollHeight > element.clientHeight + 2
        ) {
          return element;
        }
      }

      current = parentAcrossShadow(element);
    }

    return container instanceof Element
      ? container
      : document.scrollingElement;
  }

  function getMessageScrollable(container) {
    if (!container) {
      return null;
    }

    const candidates = [
      container,
      ...deepQueryAll("*", container),
    ].filter((element) => {
      if (
        !(element instanceof Element) ||
        !isVisible(element)
      ) {
        return false;
      }

      const style = getComputedStyle(element);

      return (
        element.scrollHeight > element.clientHeight + 2 &&
        /(auto|scroll)/.test(style.overflowY)
      );
    });

    candidates.sort((a, b) => {
      const aRange = a.scrollHeight - a.clientHeight;
      const bRange = b.scrollHeight - b.clientHeight;

      return bRange - aRange;
    });

    return candidates[0] || getScrollable(container);
  }

  function getRooms() {
    return deepQueryAll(
      "rs-rooms-nav-room",
    ).filter(isVisible);
  }

  function isOnChatListView() {
    /*
     * The rooms-nav panel itself is a much more stable signal for
     * "we're on the list view" than requiring actual room rows to
     * be present — an empty or still-rendering list would still
     * pass this, whereas getRooms().length can be 0 for reasons
     * unrelated to whether we're actually back on the list.
     */
    return (
      deepQueryAll("rs-rooms-nav").some(isVisible) ||
      getRooms().length > 0
    );
  }

  function roomId(room) {
    return room?.getAttribute?.("room") || null;
  }

  function roomName(room) {
    return (
      localQuery(room, ".room-name")?.textContent?.trim() ||
      room?.getAttribute?.("aria-label") ||
      roomId(room) ||
      "Unknown chat"
    );
  }

  function findFreshRoom(targetId) {
    return (
      getRooms().find(
        (room) =>
          roomId(room) === targetId &&
          room.isConnected,
      ) || null
    );
  }

  async function scrollListToFindRoom(targetId) {
    const direct = findFreshRoom(targetId);

    if (direct) {
      return direct;
    }

    /*
     * The chat list is virtualized — only a limited window of
     * rooms is actually mounted at a time. Returning to the list
     * resets scroll, which can unmount rooms further down that
     * were already discovered in an earlier scroll pass. Scroll
     * back through the list to re-locate this specific room
     * before giving up on it.
     */
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
        scroller.scrollTop +
          Math.max(
            500,
            scroller.clientHeight * 0.75,
          ),
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

  function findChatListScrollable() {
    const nav = deepQueryAll(
      "rs-rooms-nav",
    ).find(isVisible);

    const firstRoom = getRooms()[0];
    const roots = [nav, firstRoom].filter(Boolean);
    const candidates = [];

    for (const root of roots) {
      candidates.push(
        root,
        ...deepQueryAll("*", root),
      );
    }

    const scrollables = [
      ...new Set(candidates),
    ].filter((element) => {
      if (
        !(element instanceof Element) ||
        !isVisible(element)
      ) {
        return false;
      }

      return (
        element.scrollHeight > element.clientHeight + 2
      );
    });

    scrollables.sort((a, b) => {
      const aRange = a.scrollHeight - a.clientHeight;
      const bRange = b.scrollHeight - b.clientHeight;

      return bRange - aRange;
    });

    return (
      scrollables[0] ||
      (firstRoom ? getScrollable(firstRoom) : null)
    );
  }

  function findBackToListControl() {
    const candidates = deepQueryAll(
      [
        "button",
        '[role="button"]',
        "rs-icon-button",
        "rpl-button",
        "shreddit-button",
        "a",
      ].join(","),
    ).filter(isVisible);

    const scored = candidates.map((element) => {
      const text = deepText(element).toLowerCase();
      const href =
        element.href ||
        element.getAttribute?.("href") ||
        "";

      let score = 0;

      if (
        /^back$|back to chats|all chats|chat list/.test(text)
      ) {
        score = 100;
      } else if (/\bback\b/.test(text)) {
        score = 80;
      } else if (/\bchats\b/.test(text)) {
        score = 60;
      }

      try {
        const url = href
          ? new URL(href, location.href)
          : null;

        if (
          url &&
          url.pathname.replace(/\/$/, "") === "/chat"
        ) {
          score = Math.max(score, 90);
        }
      } catch (_) {
        // Ignore invalid URLs.
      }

      return {
        element,
        score,
      };
    });

    return (
      scored
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)[0]
        ?.element || null
    );
  }

  async function returnToChatList() {
    const ROUNDS = 3;

    for (let round = 1; round <= ROUNDS; round += 1) {
      if (isOnChatListView()) {
        return true;
      }

      const control = findBackToListControl();

      if (control) {
        const actual =
          localQuery(
            control,
            "button, a, [role='button']",
          ) || control;

        log(
          `Returning to chat list via: ${
            deepText(control).slice(0, 60) ||
            control.tagName
          } (attempt ${round}/${ROUNDS})`,
        );

        actual.click();

        if (
          await waitFor(
            () => isOnChatListView(),
            6000,
            75,
          )
        ) {
          return true;
        }
      }

      log(
        `Returning to chat list with browser history (attempt ${round}/${ROUNDS}).`,
      );
      history.back();

      if (
        await waitFor(
          () => isOnChatListView(),
          8000,
          100,
        )
      ) {
        return true;
      }

      if (round < ROUNDS) {
        warn(
          "Chat list still not visible — pausing briefly before trying again.",
        );

        await sleep(600);
      }
    }

    /*
     * One last direct check in case the list actually finished
     * rendering right as the final wait gave up.
     */
    return isOnChatListView();
  }

  function isReplyEvent(event) {
    return hasAncestorTag(
      event,
      "rs-thread-timeline",
    );
  }

  function getEvents(root) {
    return deepQueryAll(
      "rs-timeline-event",
      root,
    ).filter(isVisible);
  }

  function eventId(event) {
    return (
      event?.getAttribute?.("data-id") ||
      localQuery(event, "[data-id]")?.getAttribute?.(
        "data-id",
      ) ||
      "unknown-message"
    );
  }

  const ownLabel = new RegExp(
    `(?:^|[^\\w/])(?:u\\/)?${escapeRegExp(
      USERNAME,
    )}\\s+(?:said|sent)\\b`,
    "i",
  );

  function isOwnMessage(event) {
    if (!event) {
      return false;
    }

    const labels = [
      event.getAttribute?.("aria-label") || "",
      ...deepQueryAll(
        "[aria-label]",
        event,
      ).map(
        (element) =>
          element.getAttribute?.("aria-label") || "",
      ),
    ];

    return labels.some((label) =>
      ownLabel.test(
        String(label).trim(),
      ),
    );
  }

  function findReplyButton(event) {
    const button = localQuery(
      event,
      [
        "button.replies",
        'button[class*="replies"]',
        'button[aria-label*="repl" i]',
      ].join(","),
    );

    return button && isVisible(button)
      ? button
      : null;
  }

  function findReplyPane() {
    return (
      deepQueryAll(
        "rs-thread-timeline",
      ).find(isVisible) || null
    );
  }

  function findReplyCloseButton() {
    return (
      deepQueryAll(
        'button[aria-label*="Close thread" i], rs-thread header button',
      ).find(
        (button) =>
          isVisible(button) &&
          /close/i.test(deepText(button)),
      ) || null
    );
  }

  function findMainContainer() {
    /*
     * rs-timeline is the confirmed, purpose-built wrapper for a
     * room's whole conversation — prefer it outright rather than
     * inferring a container by counting messages, which breaks
     * down for rooms that only ever had a single message (the
     * "you sent it, nobody replied" case).
     */
    const timelines = deepQueryAll("rs-timeline").filter(
      (element) =>
        isVisible(element) &&
        !hasAncestorTag(element, "rs-thread-timeline"),
    );

    if (timelines.length) {
      return timelines[0];
    }

    const roomMessages = deepQueryAll(
      "rs-room-messages",
    ).filter(isVisible);

    if (roomMessages.length) {
      return roomMessages[0];
    }

    const virtualScroll = deepQueryAll(
      "rs-virtual-scroll-dynamic",
    ).find(
      (element) =>
        isVisible(element) &&
        hasAncestorTag(
          element,
          "rs-room",
        ) &&
        !hasAncestorTag(
          element,
          "rs-thread-timeline",
        ),
    );

    if (virtualScroll) {
      return virtualScroll;
    }

    const events = deepQueryAll(
      "rs-timeline-event",
    ).filter(
      (event) =>
        isVisible(event) &&
        !isReplyEvent(event),
    );

    if (!events.length) {
      return null;
    }

    /*
     * Last-resort fallback: walk up from the message's parent
     * (never the message itself) looking for the ancestor that
     * wraps the most top-level messages.
     */
    let current = parentAcrossShadow(events[0]);
    let best = current;
    let bestCount = current
      ? deepQueryAll(
          "rs-timeline-event",
          current,
        ).filter(
          (event) => !isReplyEvent(event),
        ).length
      : 0;

    for (let i = 0; i < 12 && current; i += 1) {
      const count = deepQueryAll(
        "rs-timeline-event",
        current,
      ).filter(
        (event) => !isReplyEvent(event),
      ).length;

      if (count >= bestCount) {
        best = current;
        bestCount = count;
      }

      current = parentAcrossShadow(current);
    }

    return best;
  }

  async function openRoom(
    targetId,
    targetName,
  ) {
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

    room.scrollIntoView?.({
      block: "center",
    });

    await sleep(60);

    const link = localQuery(room, "a");
    const clickable = link || room;

    log(`Clicking room: ${targetName}`);
    clickable.click();

    return await waitFor(
      () => {
        const container = findMainContainer();
        const listGone = getRooms().length === 0;

        const changed =
          container &&
          container !== beforeContainer;

        const urlChanged =
          location.href !== beforeUrl;

        const hasMessageUI =
          container &&
          (
            getEvents(container).length > 0 ||
            deepQueryAll(
              "rs-room-messages",
              container,
            ).length > 0
          );

        return (
          container &&
          (
            listGone ||
            changed ||
            urlChanged ||
            hasMessageUI
          )
            ? container
            : null
        );
      },
      CFG.navigationWaitMs,
      75,
    );
  }

  /*
   * Repeated automatic Yes/Delete confirmation.
   */

  let autoConfirmTimer = null;
  let confirmCandidateKey = null;
  let confirmCandidateFirstSeenAt = 0;
  let confirmLastClickAt = 0;
  let warnedChatWideDialog = false;

  function elementInsideDialog(element) {
    let current = element;

    while (current) {
      const tag = current.tagName || "";
      const role =
        current.getAttribute?.("role") || "";

      const className =
        typeof current.className === "string"
          ? current.className
          : "";

      if (
        role.toLowerCase() === "dialog" ||
        /dialog|modal/i.test(tag) ||
        /dialog|modal/i.test(className)
      ) {
        return true;
      }

      current = parentAcrossShadow(current);
    }

    return false;
  }

  function findYesDeleteButton() {
    const candidates = deepQueryAll(
      [
        "button",
        '[role="button"]',
        "rpl-button",
        "shreddit-button",
      ].join(","),
    ).filter(
      (element) =>
        isVisible(element) &&
        elementInsideDialog(element) &&
        !element.disabled &&
        element.getAttribute?.("aria-disabled") !== "true",
    );

    const matches = candidates
      .map((element) => ({
        element,
        text: deepText(element).toLowerCase().trim(),
        area:
          element.getBoundingClientRect().width *
          element.getBoundingClientRect().height,
      }))
      .filter(({ text }) => {
        const wordCount = text
          .split(/\s+/)
          .filter(Boolean).length;

        if (!text || wordCount > 4) {
          return false;
        }

        if (/\b(chat|conversation|thread)\b/.test(text)) {
          /*
           * Never auto-confirm something that reads like it
           * would remove the whole chat rather than a single
           * message — that stays a manual decision.
           */
          return false;
        }

        return /\b(delete|remove)\b/.test(text);
      })
      .sort((a, b) => {
        const aExact =
          /^yes\s*,?\s*(delete|remove)$/i.test(a.text)
            ? 1
            : 0;

        const bExact =
          /^yes\s*,?\s*(delete|remove)$/i.test(b.text)
            ? 1
            : 0;

        if (aExact !== bExact) {
          return bExact - aExact;
        }

        return a.area - b.area;
      });

    return matches[0]?.element || null;
  }

  function findChatWideDeleteButton() {
    const candidates = deepQueryAll(
      [
        "button",
        '[role="button"]',
        "rpl-button",
        "shreddit-button",
      ].join(","),
    ).filter(
      (element) =>
        isVisible(element) &&
        elementInsideDialog(element),
    );

    return (
      candidates.find((element) => {
        const text = deepText(element).toLowerCase();

        return (
          /\b(delete|remove)\b/.test(text) &&
          /\b(chat|conversation|thread)\b/.test(text)
        );
      }) || null
    );
  }

  function findDialogCloseControl() {
    const candidates = deepQueryAll(
      [
        'button[aria-label*="close" i]',
        'button[aria-label*="cancel" i]',
        '[role="button"][aria-label*="close" i]',
        '[role="button"][aria-label*="cancel" i]',
      ].join(","),
    ).filter(
      (element) =>
        isVisible(element) &&
        elementInsideDialog(element),
    );

    return candidates[0] || null;
  }

  async function dismissStrayDialog() {
    if (
      findYesDeleteButton() ||
      findChatWideDeleteButton()
    ) {
      /*
       * A real, in-flight confirmation is present — leave it
       * for the auto-confirm watcher (or a human) rather than
       * blindly dismissing it here.
       */
      return;
    }

    const close = findDialogCloseControl();

    if (close) {
      close.click();
      await sleep(100);
      return;
    }

    const stillOpen = deepQueryAll(
      '[role="dialog"]',
    ).some(isVisible);

    if (stillOpen) {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
        }),
      );

      await sleep(100);
    }
  }

  function findRoomSettingsButton() {
    const candidates = deepQueryAll(
      "rs-room-settings-button",
    ).filter(isVisible);

    if (candidates.length) {
      const clickable =
        localQuery(
          candidates[0],
          'button, [role="button"]',
        ) || candidates[0];

      return clickable;
    }

    /*
     * Fallback in case the tag name changes: any visible control
     * whose label reads like a room/chat settings entry point.
     */
    return (
      deepQueryAll(
        'button, [role="button"]',
      ).find(
        (el) =>
          isVisible(el) &&
          /\bsettings\b/i.test(
            deepText(el),
          ) &&
          !elementInsideDialog(el),
      ) || null
    );
  }

  function findHideChatControl() {
    const candidates = deepQueryAll(
      [
        '[role="menuitem"]',
        'rs-menu-item',
        'rs-dropdown-item',
        '[role="switch"]',
        'faceplate-switch-input',
        'button',
        '[role="button"]',
      ].join(","),
    ).filter(isVisible);

    return (
      candidates.find((el) => {
        const text = deepText(el).toLowerCase();

        return (
          /\bhide\b/.test(text) &&
          /\b(chat|conversation|thread|room)\b/.test(text) &&
          !/unhide|show/.test(text)
        );
      }) ||
      candidates.find((el) => {
        const text = deepText(el).toLowerCase().trim();
        return /^hide$/i.test(text);
      }) ||
      null
    );
  }

  function findHideConfirmButton() {
    const candidates = deepQueryAll(
      [
        "button",
        '[role="button"]',
        "rpl-button",
        "shreddit-button",
      ].join(","),
    ).filter(
      (element) =>
        isVisible(element) &&
        elementInsideDialog(element) &&
        !element.disabled &&
        element.getAttribute?.("aria-disabled") !== "true",
    );

    const matches = candidates
      .map((element) => ({
        element,
        text: deepText(element).toLowerCase().trim(),
      }))
      .filter(({ text }) => {
        const wordCount = text
          .split(/\s+/)
          .filter(Boolean).length;

        if (!text || wordCount > 4) {
          return false;
        }

        return /\bhide\b/.test(text) && !/unhide/.test(text);
      })
      .sort((a, b) => {
        const aExact = /^yes\s*,?\s*hide$/i.test(a.text) ? 1 : 0;
        const bExact = /^yes\s*,?\s*hide$/i.test(b.text) ? 1 : 0;
        return bExact - aExact;
      });

    return matches[0]?.element || null;
  }

  async function attemptHideChat(roomId, chatName) {
    const settingsButton = findRoomSettingsButton();

    if (!settingsButton) {
      warn(
        `Hide skipped for ${chatName}: couldn't find the room settings control.`,
      );
      return false;
    }

    log(`Opening room settings for ${chatName} to hide it…`);
    settingsButton.click();

    const hideControl = await waitFor(
      findHideChatControl,
      2000,
      75,
    );

    if (!hideControl) {
      warn(
        `Hide skipped for ${chatName}: no "Hide chat" option found in room settings.`,
      );
      await dismissStrayDialog();
      return false;
    }

    hideControl.click();

    /*
     * Some UIs confirm a toggle-style action immediately without a
     * separate dialog — only wait for a confirm button if one
     * actually appears.
     */
    const confirmButton = await waitFor(
      findHideConfirmButton,
      1500,
      75,
    );

    if (confirmButton) {
      log(`Confirming hide for ${chatName}…`);
      confirmButton.click();
    }

    const hidden = await waitFor(
      () => !findFreshRoom(roomId),
      4000,
      100,
    );

    if (!hidden) {
      warn(
        `Hide may not have completed for ${chatName} — the room is still listed after confirming.`,
      );
      await dismissStrayDialog();
      return false;
    }

    log(`Hid chat: ${chatName}`);
    return true;
  }

  function startAutoConfirm() {
    if (autoConfirmTimer) {
      clearInterval(autoConfirmTimer);
    }

    confirmCandidateKey = null;
    confirmCandidateFirstSeenAt = 0;
    confirmLastClickAt = 0;

    autoConfirmTimer = setInterval(() => {
      const candidate = findYesDeleteButton();
      const now = Date.now();

      if (!candidate) {
        const chatWide = findChatWideDeleteButton();

        if (chatWide) {
          if (!warnedChatWideDialog) {
            warnedChatWideDialog = true;

            warn(
              `A confirmation dialog mentioning the whole chat/conversation appeared (button: "${deepText(
                chatWide,
              ).slice(
                0,
                40,
              )}") — leaving it alone since it looks like it would remove more than one message. Close it manually, or press Stop if this keeps happening.`,
            );
          }
        } else {
          warnedChatWideDialog = false;
        }

        confirmCandidateKey = null;
        return;
      }

      warnedChatWideDialog = false;

      /*
       * Track how long THIS specific dialog has been continuously
       * present (by element reference). A brand-new dialog gets a
       * short settle window before we interact with it, since the
       * confirmation modal can take a moment to fully mount. If
       * Reddit reuses the same element for a later confirmation,
       * or if an earlier click simply didn't register, this design
       * naturally recovers — it just keeps retrying on a cooldown
       * rather than requiring a "must see it disappear first" gap
       * that can get permanently stuck.
       */
      if (candidate !== confirmCandidateKey) {
        confirmCandidateKey = candidate;
        confirmCandidateFirstSeenAt = now;
      }

      const stableForMs = now - confirmCandidateFirstSeenAt;
      const sinceLastClickMs = now - confirmLastClickAt;

      const SETTLE_MS = 150;
      const RETRY_MS = 400;

      if (stableForMs < SETTLE_MS) {
        return;
      }

      if (sinceLastClickMs < RETRY_MS) {
        return;
      }

      confirmLastClickAt = now;

      const actual =
        candidate.shadowRoot?.querySelector(
          'button, [role="button"]',
        ) ||
        candidate.querySelector?.(
          'button, [role="button"]',
        ) ||
        candidate;

      results.confirmationsClicked += 1;

      log(
        `Automatically clicking "Yes, delete" #${results.confirmationsClicked}`,
      );

      actual.scrollIntoView?.({
        block: "center",
      });

      actual.click();
    }, CFG.autoConfirmPollMs);
  }

  function stopAutoConfirm() {
    if (autoConfirmTimer) {
      clearInterval(autoConfirmTimer);
      autoConfirmTimer = null;
    }
  }

  window.stopRedditChatDelete = () => {
    window.__redditChatDeleteStop = true;
    stopAutoConfirm();

    console.warn(
      "[Reddit cleanup] Stop requested.",
    );
  };

  const deletionTimes = [];

  async function throttle() {
    const cutoff = Date.now() - 60_000;

    while (
      deletionTimes.length &&
      deletionTimes[0] < cutoff
    ) {
      deletionTimes.shift();
    }

    if (
      deletionTimes.length >=
      CFG.maxDeletesPerMinute
    ) {
      const waitMs = Math.max(
        0,
        deletionTimes[0] + 60_050 - Date.now(),
      );

      warn(
        `Rate-limit pause: ${Math.ceil(
          waitMs / 1000,
        )} seconds.`,
      );

      await sleep(waitMs);
      return throttle();
    }

    deletionTimes.push(Date.now());
  }

  function findDeleteMenuItem() {
    const items = deepQueryAll(
      '[role="menuitem"], rs-menu-item, rs-dropdown-item',
    ).filter(isVisible);

    return (
      [...items]
        .reverse()
        .find((item) => {
          const text =
            deepText(item).toLowerCase();

          return /delete message|^delete$|remove message|^remove$/.test(
            text,
          );
        }) || null
    );
  }

  function timelineEventAncestor(element) {
    let current = element;

    while (current) {
      if (current.tagName === "RS-TIMELINE-EVENT") {
        return current;
      }

      current = parentAcrossShadow(current);
    }

    return null;
  }

  async function revealMessageActions(event) {
    event.scrollIntoView({
      block: "center",
    });

    await sleep(75);

    const rect = event.getBoundingClientRect();
    const x = Math.max(rect.left + 1, rect.right - 12);
    const y = rect.top + rect.height / 2;

    for (const type of [
      "pointerover",
      "pointerenter",
      "pointermove",
      "mouseover",
      "mouseenter",
      "mousemove",
    ]) {
      const EventClass =
        type.startsWith("pointer")
          ? PointerEvent
          : MouseEvent;

      event.dispatchEvent(
        new EventClass(type, {
          bubbles: true,
          composed: true,
          clientX: x,
          clientY: y,
          pointerType: "mouse",
        }),
      );
    }

    event.focus?.();
    await sleep(150);

    return {
      x,
      y,
      rect,
    };
  }

  async function findDeleteButtonForEvent(event) {
    const { rect } = await revealMessageActions(event);

    const candidates = deepQueryAll(
      [
        'button[aria-label="Delete"]',
        'button[title="Delete"]',
        '[role="button"][aria-label="Delete"]',
        '[role="button"][title="Delete"]',
        "rs-timeline-event-delete-action button",
        "button",
      ].join(","),
    ).filter((button) => {
      if (!isVisible(button)) {
        return false;
      }

      const text = deepText(button)
        .replace(/\s+/g, " ")
        .trim();

      return /^delete$/i.test(text);
    });

    /*
     * Prefer a Delete button structurally attached to
     * this exact timeline event.
     */
    const exact = candidates.find(
      (button) =>
        timelineEventAncestor(button) === event,
    );

    if (exact) {
      return exact;
    }

    /*
     * Fallback: use the Delete button closest to the
     * vertical center of the target message.
     */
    const eventCenter =
      rect.top + rect.height / 2;

    return (
      candidates
        .map((button) => {
          const buttonRect =
            button.getBoundingClientRect();

          return {
            button,
            distance: Math.abs(
              buttonRect.top +
                buttonRect.height / 2 -
                eventCenter,
            ),
          };
        })
        .filter(
          ({ distance }) =>
            distance < 80,
        )
        .sort(
          (a, b) =>
            a.distance - b.distance,
        )[0]?.button || null
    );
  }

  async function findMoreButtonForEvent(event) {
    const { y } = await revealMessageActions(event);

    const candidates = deepQueryAll(
      [
        '[aria-label="More options"]',
        '[aria-label="More"]',
        '[title="More"]',
        'button[aria-haspopup="menu"]',
        '[role="button"][aria-haspopup="menu"]',
        'rs-icon-button[icon="more"]',
      ].join(","),
    ).filter(isVisible);

    const exact = candidates.find(
      (button) =>
        timelineEventAncestor(button) === event,
    );

    if (exact) {
      return exact;
    }

    return (
      candidates
        .map((button) => {
          const buttonRect =
            button.getBoundingClientRect();

          return {
            button,
            distance: Math.abs(
              buttonRect.top +
                buttonRect.height / 2 -
                y,
            ),
          };
        })
        .filter(
          ({ distance }) =>
            distance < 80,
        )
        .sort(
          (a, b) =>
            a.distance - b.distance,
        )[0]?.button || null
    );
  }

  async function deleteMessageOnce(event) {
    if (!event?.isConnected) {
      return true;
    }

    await throttle();
    await dismissStrayDialog();

    const directDelete =
      await findDeleteButtonForEvent(event);

    let usedPath = "none";

    if (directDelete) {
      log(
        `Clicking direct Delete control for ${eventId(event)}`,
      );

      usedPath = "direct";
      directDelete.click();
    } else {
      const more =
        await findMoreButtonForEvent(event);

      if (!more) {
        warn(
          `No Delete or More control found for ${eventId(
            event,
          )} (label: "${deepText(event).slice(0, 80)}").`,
        );

        return false;
      }

      more.click();

      const deleteItem = await waitFor(
        findDeleteMenuItem,
        1500,
        50,
      );

      if (!deleteItem) {
        warn(
          `More menu opened for ${eventId(event)} but no Delete item appeared in it.`,
        );

        await dismissStrayDialog();
        return false;
      }

      usedPath = "menu";
      deleteItem.click();
    }

    /*
     * The auto-confirm watcher handles the
     * Reddit "Yes, delete" modal.
     */
    let disappeared = await waitFor(
      () => !event.isConnected,
      CFG.deleteVerifyMs,
      50,
    );

    /*
     * Some messages — notably the first/initiating message in
     * a room — don't actually get removed by the quick delete
     * icon even though it's present and clickable. If that
     * happens, fall back to the full More-menu flow before
     * giving up on this attempt.
     */
    if (
      !disappeared &&
      usedPath === "direct" &&
      event.isConnected
    ) {
      warn(
        `Direct delete didn't remove ${eventId(event)} — falling back to the More menu.`,
      );

      await dismissStrayDialog();

      const more =
        await findMoreButtonForEvent(event);

      if (more) {
        more.click();

        const deleteItem = await waitFor(
          findDeleteMenuItem,
          1500,
          50,
        );

        if (deleteItem) {
          usedPath = "direct-then-menu";
          deleteItem.click();

          disappeared = await waitFor(
            () => !event.isConnected,
            CFG.deleteVerifyMs,
            50,
          );
        }
      }
    }

    if (!disappeared) {
      warn(
        `Delete did not confirm for ${eventId(
          event,
        )} (path: ${usedPath}, label: "${deepText(event).slice(
          0,
          80,
        )}").`,
      );

      await dismissStrayDialog();
    }

    await sleep(
      CFG.delayAfterDeleteMs,
    );

    return Boolean(disappeared);
  }

  async function deleteMessage(
    event,
    context,
  ) {
    const id = eventId(event);

    for (
      let attempt = 1;
      attempt <= CFG.deleteAttempts;
      attempt += 1
    ) {
      if (stopped()) {
        return false;
      }

      try {
        if (await deleteMessageOnce(event)) {
          results.messagesDeleted += 1;

          log(
            `Deleted ${id} (${context}). Total: ${results.messagesDeleted}`,
          );

          return true;
        }
      } catch (error) {
        warn(
          `Delete attempt ${attempt} failed for ${id}:`,
          error,
        );
      }

      await sleep(200 * attempt);
    }

    results.failures.push({
      type: "message",
      context,
      id,
    });

    warn(
      `Could not delete ${id} (${context}).`,
    );

    return false;
  }

  async function cleanThread(
    parentEvent,
    chatName,
  ) {
    const replyButton =
      findReplyButton(parentEvent);

    if (!replyButton || stopped()) {
      return;
    }

    replyButton.click();

    const pane = await waitFor(
      findReplyPane,
      1800,
      50,
    );

    if (!pane) {
      return;
    }

    const scroller =
      getMessageScrollable(pane);

    let stalls = 0;

    for (
      let cycle = 0;
      cycle < 500 && !stopped();
      cycle += 1
    ) {
      const own =
        getEvents(pane).filter(
          isOwnMessage,
        );

      if (own.length) {
        for (const event of own) {
          if (stopped()) {
            break;
          }

          await deleteMessage(
            event,
            `${chatName} / reply thread`,
          );
        }

        stalls = 0;
        continue;
      }

      const beforeTop =
        scroller?.scrollTop ?? 0;

      const beforeHeight =
        scroller?.scrollHeight ?? 0;

      if (scroller) {
        scroller.scrollTop =
          Math.max(
            0,
            beforeTop - 1200,
          );
      }

      await sleep(
        CFG.scrollWaitMs,
      );

      const unchanged =
        (scroller?.scrollTop ?? 0) === beforeTop &&
        (scroller?.scrollHeight ?? 0) === beforeHeight;

      const atTop =
        !scroller ||
        scroller.scrollTop <= 2;

      stalls =
        unchanged && atTop
          ? stalls + 1
          : 0;

      if (stalls >= CFG.topStalls) {
        break;
      }
    }

    const close =
      findReplyCloseButton();

    if (close) {
      close.click();
      await sleep(125);
    }
  }

  async function sweepCurrentChat(chatName) {
    let container = await waitFor(
      findMainContainer,
      CFG.navigationWaitMs,
      75,
    );

    if (!container) {
      return {
        complete: false,
        reason: "message container not found",
      };
    }

    for (
      let pass = 1;
      pass <= CFG.cleanupPasses && !stopped();
      pass += 1
    ) {
      container =
        findMainContainer() ||
        container;

      let scroller =
        getMessageScrollable(container);

      /*
       * Begin at the newest messages and progressively
       * scroll toward the beginning of the conversation.
       */
      if (scroller) {
        scroller.scrollTop =
          scroller.scrollHeight;

        await sleep(
          CFG.scrollWaitMs,
        );
      }

      let stalls = 0;

      for (
        let cycle = 0;
        cycle < 1500 && !stopped();
        cycle += 1
      ) {
        container =
          findMainContainer() ||
          container;

        const events =
          getEvents(container).filter(
            (event) =>
              !isReplyEvent(event),
          );

        for (const event of events) {
          if (stopped()) {
            break;
          }

          if (findReplyButton(event)) {
            await cleanThread(
              event,
              chatName,
            );
          }
        }

        const own =
          events.filter(
            isOwnMessage,
          );

        if (own.length) {
          for (const event of own) {
            if (stopped()) {
              break;
            }

            await deleteMessage(
              event,
              chatName,
            );
          }

          stalls = 0;
          continue;
        }

        scroller =
          getMessageScrollable(container);

        const beforeTop =
          scroller?.scrollTop ?? 0;

        const beforeHeight =
          scroller?.scrollHeight ?? 0;

        if (scroller) {
          scroller.scrollTop =
            Math.max(
              0,
              beforeTop - 1400,
            );
        }

        await sleep(
          CFG.scrollWaitMs,
        );

        const unchanged =
          (scroller?.scrollTop ?? 0) === beforeTop &&
          (scroller?.scrollHeight ?? 0) === beforeHeight;

        const atTop =
          !scroller ||
          scroller.scrollTop <= 2;

        stalls =
          unchanged && atTop
            ? stalls + 1
            : 0;

        if (stalls >= CFG.topStalls) {
          break;
        }
      }
    }

    /*
     * Full verification pass from newest to oldest.
     */
    container =
      findMainContainer() ||
      container;

    let verifyScroller =
      getMessageScrollable(container);

    if (verifyScroller) {
      verifyScroller.scrollTop =
        verifyScroller.scrollHeight;

      await sleep(
        CFG.scrollWaitMs,
      );
    }

    let verifyStalls = 0;

    for (
      let cycle = 0;
      cycle < 1500 && !stopped();
      cycle += 1
    ) {
      container =
        findMainContainer() ||
        container;

      const remaining =
        getEvents(container).some(
          (event) =>
            !isReplyEvent(event) &&
            isOwnMessage(event),
        );

      if (remaining) {
        return {
          complete: false,
          reason:
            "messages remain after full rescan",
        };
      }

      verifyScroller =
        getMessageScrollable(container);

      const beforeTop =
        verifyScroller?.scrollTop ?? 0;

      const beforeHeight =
        verifyScroller?.scrollHeight ?? 0;

      if (verifyScroller) {
        /*
         * Touch zero repeatedly to trigger Reddit's
         * lazy loading of the oldest conversation history.
         */
        if (beforeTop <= 2) {
          verifyScroller.scrollTop = 1;
          await sleep(40);
          verifyScroller.scrollTop = 0;
        } else {
          verifyScroller.scrollTop =
            Math.max(
              0,
              beforeTop - 1400,
            );
        }
      }

      await sleep(
        CFG.scrollWaitMs,
      );

      const unchanged =
        (verifyScroller?.scrollTop ?? 0) === beforeTop &&
        (verifyScroller?.scrollHeight ?? 0) === beforeHeight;

      const atTop =
        !verifyScroller ||
        verifyScroller.scrollTop <= 2;

      verifyStalls =
        unchanged && atTop
          ? verifyStalls + 1
          : 0;

      if (
        verifyStalls >=
        CFG.topStalls
      ) {
        break;
      }
    }

    return {
      complete: !stopped(),
      reason: stopped()
        ? "stopped"
        : null,
    };
  }

  try {
    startAutoConfirm();

    log(`Starting for u/${USERNAME}.`);

    log(
      `Single-pane navigation, repeatable confirmation, and initial-message deletion enabled; max ${maxChatsLabel} chats.`,
    );

    log(
      "Stop command: stopRedditChatDelete()",
    );

    if (!(await returnToChatList())) {
      throw new Error(
        "Could not reach the Reddit chat list.",
      );
    }

    const processed = new Set();
    let listStalls = 0;

    while (
      !stopped() &&
      results.chatsAttempted < CFG.maxChats &&
      listStalls < CFG.listStalls
    ) {
      if (!(await returnToChatList())) {
        throw new Error(
          "Could not return to the Reddit chat list.",
        );
      }

      const rooms = getRooms();

      log(
        `Found ${rooms.length} currently rendered chat rooms.`,
      );

      const snapshot = rooms
        .map((room) => ({
          id: roomId(room),
          name: roomName(room),
        }))
        .filter(
          (room) =>
            room.id &&
            !processed.has(room.id),
        );

      if (!snapshot.length) {
        const scroller =
          findChatListScrollable();

        if (!scroller) {
          break;
        }

        const beforeTop =
          scroller.scrollTop;

        const beforeHeight =
          scroller.scrollHeight;

        scroller.scrollTop =
          Math.min(
            scroller.scrollHeight,
            scroller.scrollTop +
              Math.max(
                500,
                scroller.clientHeight * 0.75,
              ),
          );

        await sleep(375);

        const moved =
          scroller.scrollTop !== beforeTop ||
          scroller.scrollHeight !== beforeHeight;

        listStalls =
          moved
            ? 0
            : listStalls + 1;

        continue;
      }

      for (const room of snapshot) {
        if (
          stopped() ||
          results.chatsAttempted >= CFG.maxChats
        ) {
          break;
        }

        processed.add(room.id);
        results.chatsAttempted += 1;

        log(
          `Opening chat ${results.chatsAttempted}: ${room.name} (${room.id})`,
        );

        const opened =
          await openRoom(
            room.id,
            room.name,
          );

        if (!opened) {
          results.failures.push({
            type: "chat",
            id: room.id,
            name: room.name,
            reason: "could not open room",
          });

          warn(
            `Could not open ${room.name}.`,
          );

          await returnToChatList();
          continue;
        }

        const messagesDeletedBefore =
          results.messagesDeleted;

        const outcome =
          await sweepCurrentChat(
            room.name,
          );

        const messagesDeletedThisChat =
          results.messagesDeleted -
          messagesDeletedBefore;

        if (outcome.complete) {
          results.chatsComplete += 1;

          log(
            `Verified complete: ${room.name}`,
          );

          if (
            CFG.hideEmptyChats &&
            messagesDeletedThisChat === 0 &&
            !stopped()
          ) {
            const hidden =
              await attemptHideChat(
                room.id,
                room.name,
              );

            if (hidden) {
              results.chatsHidden += 1;
            }
          }
        } else {
          results.failures.push({
            type: "chat",
            id: room.id,
            name: room.name,
            reason:
              outcome.reason ||
              "incomplete",
          });

          warn(
            `Incomplete: ${room.name} — ${
              outcome.reason ||
              "unknown reason"
            }`,
          );
        }

        if (!(await returnToChatList())) {
          throw new Error(
            `Deleted ${room.name}, but could not return to the chat list.`,
          );
        }

        await sleep(200);
      }
    }
  } catch (error) {
    results.failures.push({
      type: "script",
      reason: String(
        error?.message || error,
      ),
    });

    console.error(
      "[Reddit cleanup] Fatal error:",
      error,
    );
  } finally {
    stopAutoConfirm();

    results.finishedAt =
      new Date().toISOString();

    results.stopped =
      stopped();

    window.__redditChatDeleteRunning =
      false;

    console.group(
      "Reddit cleanup result",
    );

    console.table({
      chatsAttempted:
        results.chatsAttempted,
      chatsComplete:
        results.chatsComplete,
      chatsHidden:
        results.chatsHidden,
      messagesDeleted:
        results.messagesDeleted,
      confirmationsClicked:
        results.confirmationsClicked,
      failures:
        results.failures.length,
      stopped:
        results.stopped,
    });

    if (results.failures.length) {
      console.table(
        results.failures,
      );
    }

    console.log(
      "Full result object: window.__redditChatDeleteResults",
      results,
    );

    console.groupEnd();
  }
})();
