import { TUNING } from "./config";
import { getMessageScrollable, sleep, waitFor } from "./dom";
import { findMainContainer } from "./rooms";
import { isStopped, state } from "./state";
import {
  deleteMessage,
  eventId,
  findReplyButton,
  findReplyCloseButton,
  findReplyPane,
  getEvents,
  isOwnMessage,
  isReplyEvent,
} from "./messages";

export interface SweepOutcome {
  complete: boolean;
  reason: string | null;
}

/** Test mode: count a match once per chat, however many times it is re-scanned. */
function countWouldDelete(event: Element, chatName: string): void {
  const key = `${eventId(event)}|${chatName}`;

  if (!state.dryRunSeen.has(key)) {
    state.dryRunSeen.add(key);
    state.wouldDelete += 1;
  }
}

async function cleanThread(parentEvent: Element, chatName: string): Promise<void> {
  const replyButton = findReplyButton(parentEvent);

  if (!replyButton || isStopped()) {
    return;
  }

  replyButton.click();

  const pane = await waitFor(findReplyPane, 1800, 50);

  if (!pane) {
    return;
  }

  const scroller = getMessageScrollable(pane);
  let stalls = 0;

  for (let cycle = 0; cycle < 500 && !isStopped(); cycle += 1) {
    const own = getEvents(pane).filter(isOwnMessage);

    if (own.length) {
      for (const event of own) {
        if (isStopped()) {
          break;
        }

        await deleteMessage(event, `${chatName} / reply thread`);
      }

      stalls = 0;
      continue;
    }

    const beforeTop = scroller?.scrollTop ?? 0;
    const beforeHeight = scroller?.scrollHeight ?? 0;

    if (scroller) {
      scroller.scrollTop = Math.max(0, beforeTop - 1200);
    }

    await sleep(TUNING.scrollWaitMs);

    const unchanged =
      (scroller?.scrollTop ?? 0) === beforeTop &&
      (scroller?.scrollHeight ?? 0) === beforeHeight;
    const atTop = !scroller || scroller.scrollTop <= 2;

    stalls = unchanged && atTop ? stalls + 1 : 0;

    if (stalls >= TUNING.topStalls) {
      break;
    }
  }

  findReplyCloseButton()?.click();
  await sleep(125);
}

/**
 * Scans the open chat from newest to oldest, deleting your messages.
 * In test mode it only counts them. Reply threads are not opened in test mode.
 */
export async function sweepCurrentChat(
  chatName: string,
  dryRun: boolean,
): Promise<SweepOutcome> {
  let container = await waitFor(findMainContainer, TUNING.navigationWaitMs, 75);

  if (!container) {
    return { complete: false, reason: "message container not found" };
  }

  for (let pass = 1; pass <= TUNING.cleanupPasses && !isStopped(); pass += 1) {
    container = findMainContainer() || container;

    let scroller = getMessageScrollable(container);

    // Start at the newest messages and scroll toward the oldest.
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
      await sleep(TUNING.scrollWaitMs);
    }

    let stalls = 0;

    for (let cycle = 0; cycle < 1500 && !isStopped(); cycle += 1) {
      container = findMainContainer() || container;

      const events = getEvents(container).filter((event) => !isReplyEvent(event));

      if (!dryRun) {
        for (const event of events) {
          if (isStopped()) {
            break;
          }

          if (findReplyButton(event)) {
            await cleanThread(event, chatName);
          }
        }
      }

      const own = events.filter(isOwnMessage);

      if (own.length && !dryRun) {
        for (const event of own) {
          if (isStopped()) {
            break;
          }

          await deleteMessage(event, chatName);
        }

        stalls = 0;
        continue;
      }

      if (dryRun) {
        own.forEach((event) => countWouldDelete(event, chatName));
      }

      scroller = getMessageScrollable(container);

      const beforeTop = scroller?.scrollTop ?? 0;
      const beforeHeight = scroller?.scrollHeight ?? 0;

      if (scroller) {
        scroller.scrollTop = Math.max(0, beforeTop - 1400);
      }

      await sleep(TUNING.scrollWaitMs);

      const unchanged =
        (scroller?.scrollTop ?? 0) === beforeTop &&
        (scroller?.scrollHeight ?? 0) === beforeHeight;
      const atTop = !scroller || scroller.scrollTop <= 2;

      stalls = unchanged && atTop ? stalls + 1 : 0;

      if (stalls >= TUNING.topStalls) {
        break;
      }
    }
  }

  // Verification pass: scroll back through the chat and confirm nothing is left.
  container = findMainContainer() || container;

  let verifyScroller = getMessageScrollable(container);

  if (verifyScroller) {
    verifyScroller.scrollTop = verifyScroller.scrollHeight;
    await sleep(TUNING.scrollWaitMs);
  }

  let verifyStalls = 0;

  for (let cycle = 0; cycle < 1500 && !isStopped(); cycle += 1) {
    container = findMainContainer() || container;

    const remaining = getEvents(container).some(
      (event) => !isReplyEvent(event) && isOwnMessage(event),
    );

    if (remaining && !dryRun) {
      return { complete: false, reason: "messages remain after full rescan" };
    }

    verifyScroller = getMessageScrollable(container);

    const beforeTop = verifyScroller?.scrollTop ?? 0;
    const beforeHeight = verifyScroller?.scrollHeight ?? 0;

    if (verifyScroller) {
      /*
       * Touch zero repeatedly to trigger Reddit's lazy loading of the
       * oldest history.
       */
      if (beforeTop <= 2) {
        verifyScroller.scrollTop = 1;
        await sleep(40);
        verifyScroller.scrollTop = 0;
      } else {
        verifyScroller.scrollTop = Math.max(0, beforeTop - 1400);
      }
    }

    await sleep(TUNING.scrollWaitMs);

    const unchanged =
      (verifyScroller?.scrollTop ?? 0) === beforeTop &&
      (verifyScroller?.scrollHeight ?? 0) === beforeHeight;
    const atTop = !verifyScroller || verifyScroller.scrollTop <= 2;

    verifyStalls = unchanged && atTop ? verifyStalls + 1 : 0;

    if (verifyStalls >= TUNING.topStalls) {
      break;
    }
  }

  return {
    complete: !isStopped(),
    reason: isStopped() ? "stopped" : null,
  };
}
