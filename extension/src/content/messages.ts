import { SELECTORS, TUNING } from "./config";
import {
  deepQueryAll,
  deepText,
  escapeRegExp,
  hasAncestorTag,
  isVisible,
  localQuery,
  parentAcrossShadow,
  sleep,
  waitFor,
} from "./dom";
import { dismissStrayDialog } from "./confirm";
import { isStopped, log, state, warn } from "./state";

/* ---------- Own-message detection ---------- */

let ownLabel: RegExp | null = null;

/** Must be called once per run, before any detection. */
export function configureOwnLabel(username: string): void {
  // Matches "u/name said" / "name sent", anywhere in the label.
  ownLabel = new RegExp(
    `(?:^|[^\\w/])(?:u\\/)?${escapeRegExp(username)}\\s+(?:said|sent)\\b`,
    "i",
  );
}

export function getEvents(root: Element): Element[] {
  return deepQueryAll(SELECTORS.event, root).filter(isVisible);
}

export function isReplyEvent(event: Element): boolean {
  return hasAncestorTag(event, SELECTORS.threadTimeline);
}

export function eventId(event: Element | null): string {
  return (
    event?.getAttribute("data-id") ||
    localQuery(event, "[data-id]")?.getAttribute("data-id") ||
    "unknown-message"
  );
}

export function isOwnMessage(event: Element): boolean {
  if (!ownLabel) {
    return false;
  }

  const labels = [
    event.getAttribute("aria-label") || "",
    ...deepQueryAll("[aria-label]", event).map(
      (element) => element.getAttribute("aria-label") || "",
    ),
  ];

  return labels.some((label) => ownLabel!.test(label.trim()));
}

/* ---------- Reply threads ---------- */

export function findReplyButton(event: Element): HTMLElement | null {
  const button = localQuery<HTMLElement>(
    event,
    [
      "button.replies",
      'button[class*="replies"]',
      'button[aria-label*="repl" i]',
    ].join(","),
  );

  return button && isVisible(button) ? button : null;
}

export function findReplyPane(): Element | null {
  return deepQueryAll(SELECTORS.threadTimeline).find(isVisible) || null;
}

export function findReplyCloseButton(): HTMLElement | null {
  return (
    deepQueryAll<HTMLElement>(
      'button[aria-label*="Close thread" i], rs-thread header button',
    ).find(
      (button) => isVisible(button) && /close/i.test(deepText(button)),
    ) || null
  );
}

/* ---------- Rate limiting and pausing ---------- */

const deletionTimes: number[] = [];

export function resetThrottle(): void {
  deletionTimes.length = 0;
}

/** Waits until another delete fits in the per-minute budget, then records it. */
export async function throttle(): Promise<void> {
  for (;;) {
    const cutoff = Date.now() - 60_000;

    while (deletionTimes.length && deletionTimes[0] < cutoff) {
      deletionTimes.shift();
    }

    if (deletionTimes.length < TUNING.maxDeletesPerMinute) {
      break;
    }

    const waitMs = Math.max(0, deletionTimes[0] + 60_050 - Date.now());

    warn(`Rate-limit pause: ${Math.ceil(waitMs / 1000)} seconds.`);
    await sleep(waitMs);

    if (isStopped()) {
      return;
    }
  }

  deletionTimes.push(Date.now());
}

/** Pauses while the tab is hidden. Chrome throttles timers in background tabs, so clicks would be unreliable. */
export async function waitWhileHidden(): Promise<void> {
  let announced = false;

  while (document.hidden && !isStopped()) {
    if (!announced) {
      announced = true;
      warn("Tab is hidden. Paused until you return to it.");
    }

    await sleep(500);
  }
}

/* ---------- Delete flow ---------- */

function findDeleteMenuItem(): HTMLElement | null {
  const items = deepQueryAll<HTMLElement>(
    '[role="menuitem"], rs-menu-item, rs-dropdown-item',
  ).filter(isVisible);

  return (
    [...items].reverse().find((item) =>
      /delete message|^delete$|remove message|^remove$/.test(
        deepText(item).toLowerCase(),
      ),
    ) || null
  );
}

function timelineEventAncestor(element: Element): Element | null {
  let current: Element | null = element;

  while (current) {
    if (current.tagName === SELECTORS.event.toUpperCase()) {
      return current;
    }

    current = parentAcrossShadow(current);
  }

  return null;
}

async function revealMessageActions(event: Element): Promise<{
  x: number;
  y: number;
  rect: DOMRect;
}> {
  event.scrollIntoView({ block: "center" });
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
    const init = {
      bubbles: true,
      composed: true,
      clientX: x,
      clientY: y,
    };

    event.dispatchEvent(
      type.startsWith("pointer")
        ? new PointerEvent(type, { ...init, pointerType: "mouse" })
        : new MouseEvent(type, init),
    );
  }

  (event as HTMLElement).focus?.();
  await sleep(150);

  return { x, y, rect };
}

/** Picks the candidate closest to a vertical position, within 80px. */
function closestByY(candidates: HTMLElement[], y: number): HTMLElement | null {
  return (
    candidates
      .map((button) => {
        const buttonRect = button.getBoundingClientRect();

        return {
          button,
          distance: Math.abs(buttonRect.top + buttonRect.height / 2 - y),
        };
      })
      .filter(({ distance }) => distance < 80)
      .sort((a, b) => a.distance - b.distance)[0]?.button || null
  );
}

async function findDeleteButtonForEvent(
  event: Element,
): Promise<HTMLElement | null> {
  const { rect } = await revealMessageActions(event);

  const candidates = deepQueryAll<HTMLElement>(
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

  // Prefer a Delete button structurally attached to this exact event.
  const exact = candidates.find(
    (button) => timelineEventAncestor(button) === event,
  );

  return exact || closestByY(candidates, rect.top + rect.height / 2);
}

async function findMoreButtonForEvent(
  event: Element,
): Promise<HTMLElement | null> {
  const { y } = await revealMessageActions(event);

  const candidates = deepQueryAll<HTMLElement>(
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
    (button) => timelineEventAncestor(button) === event,
  );

  return exact || closestByY(candidates, y);
}

async function deleteMessageOnce(event: Element): Promise<boolean> {
  if (!event.isConnected) {
    return true;
  }

  await waitWhileHidden();

  if (isStopped()) {
    return false;
  }

  await throttle();
  await dismissStrayDialog();

  const directDelete = await findDeleteButtonForEvent(event);

  let usedPath = "none";

  if (directDelete) {
    log(`Clicking direct Delete control for ${eventId(event)}`);
    usedPath = "direct";
    directDelete.click();
  } else {
    const more = await findMoreButtonForEvent(event);

    if (!more) {
      warn(`No Delete or More control found for ${eventId(event)}.`);
      return false;
    }

    more.click();

    const deleteItem = await waitFor(findDeleteMenuItem, 1500, 50);

    if (!deleteItem) {
      warn(`More menu opened for ${eventId(event)} but no Delete item appeared.`);
      await dismissStrayDialog();
      return false;
    }

    usedPath = "menu";
    deleteItem.click();
  }

  // The confirm watcher handles the "Yes, delete" dialog.
  let disappeared = await waitFor(
    () => !event.isConnected,
    TUNING.deleteVerifyMs,
    50,
  );

  /*
   * Some messages, notably a room's first message, are not removed by the
   * quick Delete icon even though it is clickable. Fall back to the More
   * menu before giving up on this attempt.
   */
  if (!disappeared && usedPath === "direct" && event.isConnected) {
    warn(`Direct delete didn't remove ${eventId(event)}. Falling back to the More menu.`);

    await dismissStrayDialog();

    const more = await findMoreButtonForEvent(event);

    if (more) {
      more.click();

      const deleteItem = await waitFor(findDeleteMenuItem, 1500, 50);

      if (deleteItem) {
        usedPath = "direct-then-menu";
        deleteItem.click();

        disappeared = await waitFor(
          () => !event.isConnected,
          TUNING.deleteVerifyMs,
          50,
        );
      }
    }
  }

  if (!disappeared) {
    warn(`Delete did not confirm for ${eventId(event)} (path: ${usedPath}).`);
    await dismissStrayDialog();
  }

  await sleep(TUNING.delayAfterDeleteMs);

  return Boolean(disappeared);
}

/** Deletes one of your messages with retries. Records a failure if every attempt fails. */
export async function deleteMessage(
  event: Element,
  context: string,
): Promise<boolean> {
  const id = eventId(event);

  for (let attempt = 1; attempt <= TUNING.deleteAttempts; attempt += 1) {
    if (isStopped()) {
      return false;
    }

    try {
      if (await deleteMessageOnce(event)) {
        state.messagesDeleted += 1;
        log(`Deleted ${id} (${context}). Total: ${state.messagesDeleted}`);
        return true;
      }
    } catch (error) {
      warn(`Delete attempt ${attempt} failed for ${id}: ${String(error)}`);
    }

    await sleep(200 * attempt);
  }

  state.failures.push({ type: "message", context, id });
  warn(`Could not delete ${id} (${context}).`);

  return false;
}
