import { TUNING } from "./config";
import { sleep } from "./dom";
import { attemptHideChat } from "./hide-chat";
import { openRoom, findChatListScrollable, getRooms, returnToChatList, roomId, roomName } from "./rooms";
import { runPreflight } from "./preflight";
import { configureOwnLabel, resetThrottle } from "./messages";
import { startConfirmWatcher, stopConfirmWatcher } from "./confirm";
import { sweepCurrentChat } from "./sweep";
import { isStopped, log, resetState, state, warn } from "./state";
import type { RunOptions } from "../shared/types";

/*
 * Owns one cleanup run. Only one run can be active at a time, and it keeps
 * going even if the popup is closed. The popup rehydrates by asking this
 * script for its state.
 */

export function stopRun(): void {
  if (!state.running) {
    return;
  }

  state.stopRequested = true;
  stopConfirmWatcher();
  log("Stop requested.");
}

export async function startRun(options: RunOptions): Promise<void> {
  resetState(options);
  resetThrottle();
  configureOwnLabel(options.username);

  const maxChats = options.maxChats ?? Infinity;
  const maxLabel = options.maxChats === null ? "no limit" : String(options.maxChats);
  const modeLabel = options.dryRun
    ? "TEST MODE (nothing will be deleted)"
    : "LIVE (messages will be deleted)";

  startConfirmWatcher();

  try {
    state.phase = "preflight";

    const failed = runPreflight().filter((check) => !check.ok);

    if (failed.length) {
      throw new Error(`Preflight failed: ${failed.map((check) => check.detail).join(" ")}`);
    }

    log(`Starting for u/${options.username}. ${modeLabel}. Max chats: ${maxLabel}.`);

    state.phase = "navigating";

    if (!(await returnToChatList())) {
      throw new Error("Could not reach the Reddit chat list.");
    }

    const processed = new Set<string>();
    let listStalls = 0;

    while (
      !isStopped() &&
      state.chatsAttempted < maxChats &&
      listStalls < TUNING.listStalls
    ) {
      state.phase = "listing";

      if (!(await returnToChatList())) {
        throw new Error("Could not return to the Reddit chat list.");
      }

      const snapshot: { id: string; name: string }[] = [];

      for (const room of getRooms()) {
        const id = roomId(room);

        if (id && !processed.has(id)) {
          snapshot.push({ id, name: roomName(room) });
        }
      }

      if (!snapshot.length) {
        // Nothing new is rendered. Scroll the virtualized list to load more.
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

        await sleep(375);

        const moved =
          scroller.scrollTop !== beforeTop ||
          scroller.scrollHeight !== beforeHeight;

        listStalls = moved ? 0 : listStalls + 1;
        continue;
      }

      for (const room of snapshot) {
        if (isStopped() || state.chatsAttempted >= maxChats) {
          break;
        }

        processed.add(room.id);
        state.chatsAttempted += 1;
        state.currentChat = room.name;
        state.phase = "opening";

        log(`Opening chat ${state.chatsAttempted}: ${room.name}`);

        const opened = await openRoom(room.id, room.name);

        if (!opened) {
          state.failures.push({
            type: "chat",
            id: room.id,
            name: room.name,
            reason: "could not open room",
          });
          warn(`Could not open ${room.name}.`);

          await returnToChatList();
          continue;
        }

        const deletedBefore = state.messagesDeleted;

        state.phase = options.dryRun ? "counting" : "sweeping";

        const outcome = await sweepCurrentChat(room.name, options.dryRun);

        const deletedThisChat = state.messagesDeleted - deletedBefore;

        if (outcome.complete) {
          state.chatsComplete += 1;
          log(`Verified complete: ${room.name}`);

          // Hiding is never done in test mode, and only for chats with nothing to delete.
          if (
            options.hideEmptyChats &&
            !options.dryRun &&
            deletedThisChat === 0 &&
            !isStopped()
          ) {
            state.phase = "hiding";

            if (await attemptHideChat(room.id, room.name)) {
              state.chatsHidden += 1;
            }
          }
        } else {
          state.failures.push({
            type: "chat",
            id: room.id,
            name: room.name,
            reason: outcome.reason || "incomplete",
          });
          warn(`Incomplete: ${room.name}. ${outcome.reason || "unknown reason"}`);
        }

        state.phase = "returning";

        if (!(await returnToChatList())) {
          throw new Error(
            `Finished ${room.name}, but could not return to the chat list.`,
          );
        }

        await sleep(200);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    state.failures.push({ type: "script", reason: message });
    warn(`Run ended with an error: ${message}`);
  } finally {
    stopConfirmWatcher();

    state.running = false;
    state.phase = state.stopRequested ? "stopped" : "finished";
    state.currentChat = null;
    state.finishedAt = new Date().toISOString();

    log(
      `Done. Chats: ${state.chatsAttempted} (complete ${state.chatsComplete}, hidden ${state.chatsHidden}). ` +
        `Deleted: ${state.messagesDeleted}. Would delete: ${state.wouldDelete}. ` +
        `Confirmations: ${state.confirmationsClicked}. Failures: ${state.failures.length}.`,
    );
  }
}
