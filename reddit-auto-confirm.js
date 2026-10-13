(() => {
  "use strict";

  if (window.__redditAutoConfirmTimer) {
    clearInterval(window.__redditAutoConfirmTimer);
  }

  let candidateKey = null;
  let candidateFirstSeenAt = 0;
  let lastClickAt = 0;
  let clickCount = 0;
  let warnedChatWide = false;

  function* roots(root = document) {
    if (!root) return;

    yield root;

    if (!root.querySelectorAll) return;

    for (const element of root.querySelectorAll("*")) {
      if (element.shadowRoot) {
        yield* roots(element.shadowRoot);
      }
    }
  }

  function queryAllDeep(selector) {
    const results = [];

    for (const root of roots()) {
      try {
        results.push(...root.querySelectorAll(selector));
      } catch (_) {
        // Ignore unsupported selector/root combinations.
      }
    }

    return [...new Set(results)];
  }

  function visible(element) {
    if (!element?.isConnected) return false;

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

  function insideDialog(element) {
    let current = element;

    while (current) {
      const tag = current.tagName || "";
      const role = current.getAttribute?.("role") || "";
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

  function textOf(element) {
    return [
      element.getAttribute?.("aria-label") || "",
      element.getAttribute?.("title") || "",
      element.innerText || "",
      element.textContent || "",
      element.shadowRoot?.textContent || "",
    ]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function dialogButtons() {
    return queryAllDeep(
      [
        "button",
        '[role="button"]',
        "rpl-button",
        "shreddit-button",
      ].join(","),
    ).filter(
      (element) =>
        visible(element) &&
        insideDialog(element) &&
        !element.disabled &&
        element.getAttribute?.("aria-disabled") !== "true",
    );
  }

  function findYesDeleteButton() {
    const matches = dialogButtons()
      .map((element) => ({
        element,
        text: textOf(element),
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

        /*
         * Never auto-confirm a dialog that reads like it would
         * delete the whole chat/conversation rather than a
         * single message — that stays a manual decision.
         */
        if (/\b(chat|conversation|thread)\b/.test(text)) {
          return false;
        }

        return /\b(delete|remove)\b/.test(text);
      })
      .sort((a, b) => {
        const aExact =
          /^yes\s*,?\s*(delete|remove)$/i.test(a.text) ? 1 : 0;
        const bExact =
          /^yes\s*,?\s*(delete|remove)$/i.test(b.text) ? 1 : 0;

        if (aExact !== bExact) {
          return bExact - aExact;
        }

        return a.area - b.area;
      });

    return matches[0]?.element || null;
  }

  function findChatWideDeleteButton() {
    return (
      dialogButtons().find((element) => {
        const text = textOf(element);

        return (
          /\b(delete|remove)\b/.test(text) &&
          /\b(chat|conversation|thread)\b/.test(text)
        );
      }) || null
    );
  }

  function clickButton(candidate) {
    const actual =
      candidate.shadowRoot?.querySelector(
        'button, [role="button"]',
      ) ||
      candidate.querySelector?.(
        'button, [role="button"]',
      ) ||
      candidate;

    actual.scrollIntoView?.({
      block: "center",
    });

    actual.click();
  }

  window.__redditAutoConfirmTimer = setInterval(() => {
    const button = findYesDeleteButton();
    const now = Date.now();

    if (!button) {
      const chatWide = findChatWideDeleteButton();

      if (chatWide) {
        if (!warnedChatWide) {
          warnedChatWide = true;

          console.warn(
            `[Reddit cleanup] A dialog mentioning the whole chat/conversation appeared (button: "${textOf(
              chatWide,
            ).slice(
              0,
              40,
            )}") — leaving it alone. Confirm it yourself if you really mean to delete the whole chat.`,
          );
        }
      } else {
        warnedChatWide = false;
      }

      candidateKey = null;
      return;
    }

    warnedChatWide = false;

    /*
     * Track how long THIS specific dialog has been continuously
     * present. A brand-new dialog gets a short settle window
     * before we click it, since the modal can take a moment to
     * fully mount. If it's still open a while after our last
     * click, we retry — no state that can get permanently stuck
     * refusing to click a dialog that's sitting right there.
     */
    if (button !== candidateKey) {
      candidateKey = button;
      candidateFirstSeenAt = now;
    }

    const stableForMs = now - candidateFirstSeenAt;
    const sinceLastClickMs = now - lastClickAt;

    const SETTLE_MS = 150;
    const RETRY_MS = 400;

    if (stableForMs < SETTLE_MS) {
      return;
    }

    if (sinceLastClickMs < RETRY_MS) {
      return;
    }

    lastClickAt = now;
    clickCount += 1;

    console.log(
      `[Reddit cleanup] Automatically clicking "Yes, delete" #${clickCount}`,
    );

    clickButton(button);
  }, 60);

  window.stopRedditAutoConfirm = () => {
    clearInterval(window.__redditAutoConfirmTimer);
    delete window.__redditAutoConfirmTimer;

    console.log(
      `[Reddit cleanup] Automatic confirmation stopped after ${clickCount} clicks.`,
    );
  };

  console.log(
    "[Reddit cleanup] Repeatable automatic confirmation enabled. Run stopRedditAutoConfirm() to stop it.",
  );
})();
