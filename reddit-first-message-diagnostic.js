(async () => {
  "use strict";

  /*
   * READ-ONLY diagnostic. Does not delete or confirm anything.
   * Open the SPECIFIC chat you're having trouble with (not the
   * chat list) before running this.
   */

  if (!/^https:\/\/www\.reddit\.com\/chat/i.test(location.href)) {
    throw new Error(
      "Open the specific chat you want to diagnose at https://www.reddit.com/chat before running this script.",
    );
  }

  const entered = prompt(
    "Your Reddit username (without u/) — only used to test the own-message pattern match:",
    "",
  );

  const USERNAME = String(entered || "")
    .trim()
    .replace(/^u\//i, "");

  if (!USERNAME) {
    console.warn("[Reddit diagnostic] Cancelled: no username supplied.");
    return;
  }

  const sleep = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const escapeRegExp = (value) =>
    String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function* deepNodes(root = document) {
    if (!root) return;

    yield root;

    if (root instanceof Element && root.shadowRoot) {
      yield* deepNodes(root.shadowRoot);
    }

    if (!root.querySelectorAll) return;

    for (const element of root.querySelectorAll("*")) {
      if (element.shadowRoot) {
        yield* deepNodes(element.shadowRoot);
      }
    }
  }

  function deepQueryAll(selector, root = document) {
    const found = [];

    for (const node of deepNodes(root)) {
      if (!node.querySelectorAll) continue;

      try {
        found.push(...node.querySelectorAll(selector));
      } catch (_) {
        // Ignore unsupported selector/root combinations.
      }
    }

    return [...new Set(found)];
  }

  function isVisible(element) {
    if (!element || !element.isConnected) return false;

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
    if (!node) return null;

    return node.parentNode instanceof ShadowRoot
      ? node.parentNode.host
      : node.parentElement;
  }

  function hasAncestorTag(element, tagName) {
    const target = String(tagName).toUpperCase();
    let current = element;

    while (current) {
      if (current.tagName === target) return true;
      current = parentAcrossShadow(current);
    }

    return false;
  }

  function isDescendantOf(element, ancestor) {
    let current = element;

    while (current) {
      if (current === ancestor) return true;
      current = parentAcrossShadow(current);
    }

    return false;
  }

  function deepText(element) {
    if (!element) return "";

    return [
      element.getAttribute?.("aria-label") || "",
      element.getAttribute?.("title") || "",
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
        current instanceof ShadowRoot ? current.host : current;

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
    if (!container) return null;

    const candidates = [container, ...deepQueryAll("*", container)].filter(
      (element) => {
        if (!(element instanceof Element) || !isVisible(element)) {
          return false;
        }

        const style = getComputedStyle(element);

        return (
          element.scrollHeight > element.clientHeight + 2 &&
          /(auto|scroll)/.test(style.overflowY)
        );
      },
    );

    candidates.sort((a, b) => {
      const aRange = a.scrollHeight - a.clientHeight;
      const bRange = b.scrollHeight - b.clientHeight;
      return bRange - aRange;
    });

    return candidates[0] || getScrollable(container);
  }

  function isReplyEvent(event) {
    return hasAncestorTag(event, "rs-thread-timeline");
  }

  function getEvents(root) {
    return deepQueryAll("rs-timeline-event", root).filter(isVisible);
  }

  function eventId(event) {
    return (
      event?.getAttribute?.("data-id") ||
      event?.querySelector?.("[data-id]")?.getAttribute?.("data-id") ||
      "unknown-message"
    );
  }

  function findMainContainer() {
    const timelines = deepQueryAll("rs-timeline").filter(
      (element) =>
        isVisible(element) && !hasAncestorTag(element, "rs-thread-timeline"),
    );

    if (timelines.length) return timelines[0];

    const roomMessages = deepQueryAll("rs-room-messages").filter(isVisible);
    if (roomMessages.length) return roomMessages[0];

    const virtualScroll = deepQueryAll("rs-virtual-scroll-dynamic").find(
      (element) =>
        isVisible(element) &&
        hasAncestorTag(element, "rs-room") &&
        !hasAncestorTag(element, "rs-thread-timeline"),
    );

    if (virtualScroll) return virtualScroll;

    const events = deepQueryAll("rs-timeline-event").filter(
      (event) => isVisible(event) && !isReplyEvent(event),
    );

    if (!events.length) return null;

    let current = parentAcrossShadow(events[0]);
    let best = current;
    let bestCount = current
      ? deepQueryAll("rs-timeline-event", current).filter(
          (event) => !isReplyEvent(event),
        ).length
      : 0;

    for (let i = 0; i < 12 && current; i += 1) {
      const count = deepQueryAll("rs-timeline-event", current).filter(
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

  const oldAnchoredPattern = new RegExp(
    `^(?:u\\/)?${escapeRegExp(USERNAME)}\\s+(?:said|sent)\\b`,
    "i",
  );

  const newUnanchoredPattern = new RegExp(
    `(?:^|[^\\w/])(?:u\\/)?${escapeRegExp(USERNAME)}\\s+(?:said|sent)\\b`,
    "i",
  );

  function labelsFor(event) {
    return [
      event.getAttribute?.("aria-label") || "",
      ...deepQueryAll("[aria-label]", event).map(
        (el) => el.getAttribute?.("aria-label") || "",
      ),
    ].filter(Boolean);
  }

  async function revealMessageActions(event) {
    event.scrollIntoView({ block: "center" });
    await sleep(150);

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
      const EventClass = type.startsWith("pointer")
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
    await sleep(300);
  }

  function describeElement(el) {
    if (!el) return null;

    return {
      tag: el.tagName,
      ariaLabel: el.getAttribute?.("aria-label") || null,
      title: el.getAttribute?.("title") || null,
      className: typeof el.className === "string" ? el.className : null,
      text: deepText(el).slice(0, 80),
    };
  }

  function findDeleteButtonForEvent(event) {
    const candidates = deepQueryAll(
      [
        'button[aria-label="Delete"]',
        'button[title="Delete"]',
        '[role="button"][aria-label="Delete"]',
        '[role="button"][title="Delete"]',
        "rs-timeline-event-delete-action button",
        "button",
      ].join(","),
    ).filter(
      (button) =>
        isVisible(button) &&
        /^delete$/i.test(deepText(button).replace(/\s+/g, " ").trim()),
    );

    return (
      candidates.find((button) => isDescendantOf(button, event)) ||
      candidates[0] ||
      null
    );
  }

  function findMoreButtonForEvent(event) {
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

    return (
      candidates.find((button) => isDescendantOf(button, event)) ||
      candidates[0] ||
      null
    );
  }

  function findMenuItems() {
    return deepQueryAll(
      '[role="menuitem"], rs-menu-item, rs-dropdown-item',
    )
      .filter(isVisible)
      .map((item) => deepText(item));
  }

  function closeAnyMenu() {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    document.dispatchEvent(
      new KeyboardEvent("keyup", { key: "Escape", bubbles: true }),
    );
  }

  async function inspect(event, label) {
    await revealMessageActions(event);

    const result = {
      label,
      eventId: eventId(event),
      ariaLabels: labelsFor(event),
      matchesOldAnchoredPattern: labelsFor(event).some((l) =>
        oldAnchoredPattern.test(l.trim()),
      ),
      matchesNewUnanchoredPattern: labelsFor(event).some((l) =>
        newUnanchoredPattern.test(l.trim()),
      ),
    };

    const directDelete = findDeleteButtonForEvent(event);
    result.directDeleteButton = describeElement(directDelete);

    const moreButton = findMoreButtonForEvent(event);
    result.moreButton = describeElement(moreButton);

    if (moreButton) {
      moreButton.click();
      await sleep(400);
      result.moreMenuItems = findMenuItems();
      closeAnyMenu();
      await sleep(200);
    } else {
      result.moreMenuItems = [];
    }

    return result;
  }

  console.log("[Reddit diagnostic] Locating this chat's message container…");

  let container = findMainContainer();

  if (!container) {
    console.error(
      "[Reddit diagnostic] Couldn't find a message container. Make sure the specific chat is open, not the chat list.",
    );
    return;
  }

  console.log("[Reddit diagnostic] Scrolling to the top to load the first message…");

  let stalls = 0;

  for (let i = 0; i < 300; i += 1) {
    container = findMainContainer() || container;

    const scroller = getMessageScrollable(container);
    const beforeTop = scroller?.scrollTop ?? 0;
    const beforeHeight = scroller?.scrollHeight ?? 0;

    if (scroller) {
      scroller.scrollTop = Math.max(0, beforeTop - 1400);
    }

    await sleep(300);

    const unchanged =
      (scroller?.scrollTop ?? 0) === beforeTop &&
      (scroller?.scrollHeight ?? 0) === beforeHeight;
    const atTop = !scroller || scroller.scrollTop <= 2;

    stalls = unchanged && atTop ? stalls + 1 : 0;

    if (stalls >= 4) break;
  }

  container = findMainContainer() || container;

  const events = getEvents(container).filter((e) => !isReplyEvent(e));

  if (!events.length) {
    console.warn(
      "[Reddit diagnostic] No top-level rs-timeline-event messages found via the normal path. " +
        "Gathering a broader fallback report — this chat may be using a different UI " +
        "(e.g. a pending/unaccepted chat request) rather than the normal timeline.",
    );

    const allTimelineEventsInDoc = deepQueryAll("rs-timeline-event");
    const replyClassifiedCount = allTimelineEventsInDoc.filter(isReplyEvent).length;

    const customTagsInContainer = [
      ...new Set(
        deepQueryAll("*", container)
          .filter((el) => el.tagName && el.tagName.includes("-"))
          .map((el) => el.tagName.toLowerCase()),
      ),
    ];

    const customTagsAnywhereOnPage = [
      ...new Set(
        deepQueryAll("*")
          .filter((el) => el.tagName && el.tagName.includes("-"))
          .map((el) => el.tagName.toLowerCase()),
      ),
    ];

    const visibleButtonsOnPage = deepQueryAll(
      'button, [role="button"], rpl-button, shreddit-button',
    )
      .filter(isVisible)
      .map((el) => ({
        tag: el.tagName,
        ariaLabel: el.getAttribute?.("aria-label") || null,
        title: el.getAttribute?.("title") || null,
        text: deepText(el).slice(0, 60),
      }))
      .filter((b) => b.text || b.ariaLabel || b.title);

    const fallbackReport = {
      url: location.href,
      containerTag: container?.tagName || null,
      containerId: container?.id || null,
      containerClassName:
        typeof container?.className === "string"
          ? container.className
          : null,
      containerOuterHtmlSnippet:
        container?.outerHTML?.slice(0, 1200) || null,
      containerVisibleTextSnippet: deepText(container).slice(0, 600),
      customTagsInContainer,
      customTagsAnywhereOnPage,
      totalRsTimelineEventsAnywhereOnPage: allTimelineEventsInDoc.length,
      ofThoseClassifiedAsReply: replyClassifiedCount,
      visibleButtonsOnPage,
    };

    window.__redditFirstMessageDiagnostic = fallbackReport;

    console.group(
      "[Reddit diagnostic] Fallback report (no timeline events found)",
    );
    console.log(fallbackReport);
    console.groupEnd();

    console.log(
      "[Reddit diagnostic] Saved to window.__redditFirstMessageDiagnostic. " +
        "Try copy(window.__redditFirstMessageDiagnostic) to copy it as JSON " +
        "(review it first — it may include the other participant's name/message text — " +
        "redact anything you'd rather not share before pasting it back).",
    );

    return;
  }

  console.log(
    `[Reddit diagnostic] Found ${events.length} top-level messages. Inspecting the first (oldest) one…`,
  );

  const firstEvent = events[0];

  const report = {
    totalTopLevelMessages: events.length,
    firstMessage: await inspect(firstEvent, "first message"),
    firstMessageOuterHtmlSnippet: firstEvent.outerHTML?.slice(0, 1500) || null,
    firstMessageAttributes: [...(firstEvent.attributes || [])].map(
      (a) => `${a.name}="${a.value}"`,
    ),
    previousSibling: firstEvent.previousElementSibling
      ? {
          tag: firstEvent.previousElementSibling.tagName,
          text: deepText(firstEvent.previousElementSibling).slice(0, 200),
        }
      : null,
  };

  const laterOwnEvent = events
    .slice(1)
    .find((e) =>
      labelsFor(e).some((l) => newUnanchoredPattern.test(l.trim())),
    );

  report.comparisonLaterOwnMessage = laterOwnEvent
    ? await inspect(laterOwnEvent, "comparison — later own message")
    : null;

  window.__redditFirstMessageDiagnostic = report;

  console.group("[Reddit diagnostic] Report");
  console.log(report);
  console.groupEnd();

  console.log(
    "[Reddit diagnostic] Saved to window.__redditFirstMessageDiagnostic. " +
      "Try copy(window.__redditFirstMessageDiagnostic) to copy it as JSON " +
      "(review it first — it may include the other participant's name/message text — " +
      "redact anything you'd rather not share before pasting it back).",
  );
})();
