import { ACTIONABLE, TUNING } from "./config";
import {
  deepQueryAll,
  deepText,
  isVisible,
  parentAcrossShadow,
  sleep,
} from "./dom";
import { log, state, warn } from "./state";

/*
 * Confirmation dialogs ("Yes, delete") for single-message deletes.
 * Whole-chat deletion is deliberately never auto-confirmed.
 */

export function elementInsideDialog(element: Element): boolean {
  let current: Element | null = element;

  while (current) {
    const role = current.getAttribute("role") || "";
    const className =
      typeof current.className === "string" ? current.className : "";

    if (
      role.toLowerCase() === "dialog" ||
      /dialog|modal/i.test(current.tagName) ||
      /dialog|modal/i.test(className)
    ) {
      return true;
    }

    current = parentAcrossShadow(current);
  }

  return false;
}

function enabledDialogButtons(): HTMLElement[] {
  return deepQueryAll<HTMLElement>(ACTIONABLE).filter(
    (element) =>
      isVisible(element) &&
      elementInsideDialog(element) &&
      !(element as HTMLButtonElement).disabled &&
      element.getAttribute("aria-disabled") !== "true",
  );
}

const CHAT_WORD = /\b(chat|conversation|thread)\b/;

export function findYesDeleteButton(): HTMLElement | null {
  const matches = enabledDialogButtons()
    .map((element) => {
      const rect = element.getBoundingClientRect();

      return {
        element,
        text: deepText(element).toLowerCase().trim(),
        area: rect.width * rect.height,
      };
    })
    .filter(({ text }) => {
      const wordCount = text.split(/\s+/).filter(Boolean).length;

      if (!text || wordCount > 4) {
        return false;
      }

      // Anything that reads like it removes the whole chat stays manual.
      if (CHAT_WORD.test(text)) {
        return false;
      }

      return /\b(delete|remove)\b/.test(text);
    })
    .sort((a, b) => {
      const aExact = /^yes\s*,?\s*(delete|remove)$/i.test(a.text) ? 1 : 0;
      const bExact = /^yes\s*,?\s*(delete|remove)$/i.test(b.text) ? 1 : 0;

      if (aExact !== bExact) {
        return bExact - aExact;
      }

      return a.area - b.area;
    });

  return matches[0]?.element || null;
}

export function findChatWideDeleteButton(): HTMLElement | null {
  return (
    enabledDialogButtons().find((element) => {
      const text = deepText(element).toLowerCase();

      return /\b(delete|remove)\b/.test(text) && CHAT_WORD.test(text);
    }) || null
  );
}

function findDialogCloseControl(): HTMLElement | null {
  return (
    deepQueryAll<HTMLElement>(
      [
        'button[aria-label*="close" i]',
        'button[aria-label*="cancel" i]',
        '[role="button"][aria-label*="close" i]',
        '[role="button"][aria-label*="cancel" i]',
      ].join(","),
    ).find((element) => isVisible(element) && elementInsideDialog(element)) ||
    null
  );
}

/** Closes a leftover dialog from a failed step. Leaves real confirmations for the watcher. */
export async function dismissStrayDialog(): Promise<void> {
  if (findYesDeleteButton() || findChatWideDeleteButton()) {
    return;
  }

  const close = findDialogCloseControl();

  if (close) {
    close.click();
    await sleep(100);
    return;
  }

  const stillOpen = deepQueryAll('[role="dialog"]').some(isVisible);

  if (stillOpen) {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await sleep(100);
  }
}

/* ---------- Watcher ---------- */

let pollTimer: ReturnType<typeof setInterval> | null = null;
let candidate: HTMLElement | null = null;
let candidateFirstSeenAt = 0;
let lastClickAt = 0;
let warnedChatWide = false;

function clickThrough(button: HTMLElement): void {
  // Some confirm buttons wrap a real <button> inside a shadow root.
  const actual =
    button.shadowRoot?.querySelector<HTMLElement>('button, [role="button"]') ||
    button.querySelector<HTMLElement>('button, [role="button"]') ||
    button;

  actual.scrollIntoView({ block: "center" });
  actual.click();
}

function pollOnce(): void {
  const now = Date.now();
  const button = findYesDeleteButton();

  if (!button) {
    const chatWide = findChatWideDeleteButton();

    if (chatWide && !warnedChatWide) {
      warnedChatWide = true;
      warn(
        `A confirmation dialog mentioning the whole chat appeared ("${deepText(chatWide).slice(0, 40)}"). Left alone. Close it or confirm it yourself.`,
      );
    } else if (!chatWide) {
      warnedChatWide = false;
    }

    candidate = null;
    return;
  }

  warnedChatWide = false;

  // A new dialog gets a short settle window before we click it.
  if (button !== candidate) {
    candidate = button;
    candidateFirstSeenAt = now;
  }

  if (now - candidateFirstSeenAt < TUNING.confirmSettleMs) {
    return;
  }

  // Retry on a cooldown if the dialog is still there after a click.
  if (now - lastClickAt < TUNING.confirmRetryMs) {
    return;
  }

  lastClickAt = now;
  state.confirmationsClicked += 1;
  log(`Automatically clicking "Yes, delete" #${state.confirmationsClicked}`);
  clickThrough(button);
}

export function startConfirmWatcher(): void {
  stopConfirmWatcher();

  candidate = null;
  candidateFirstSeenAt = 0;
  lastClickAt = 0;
  warnedChatWide = false;

  pollTimer = setInterval(pollOnce, TUNING.autoConfirmPollMs);
}

export function stopConfirmWatcher(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
