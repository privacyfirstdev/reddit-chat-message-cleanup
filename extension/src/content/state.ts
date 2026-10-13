import type { Failure, RunOptions, RunSnapshot } from "../shared/types";

/*
 * Module-level run state. Replaces the old window.__redditChatDelete* globals.
 * Only the content script touches this. The popup reads it through messages.
 */

const LOG_LIMIT = 300;

export const state = {
  running: false,
  stopRequested: false,
  phase: "idle",
  options: null as RunOptions | null,
  startedAt: null as string | null,
  finishedAt: null as string | null,
  currentChat: null as string | null,
  chatsAttempted: 0,
  chatsComplete: 0,
  chatsHidden: 0,
  messagesDeleted: 0,
  wouldDelete: 0,
  confirmationsClicked: 0,
  failures: [] as Failure[],
  log: [] as string[],
  /** Test mode only: "eventId|chatName" keys already counted, so re-scrolls do not double count. */
  dryRunSeen: new Set<string>(),
};

export function resetState(options: RunOptions): void {
  state.running = true;
  state.stopRequested = false;
  state.phase = "starting";
  state.options = options;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.currentChat = null;
  state.chatsAttempted = 0;
  state.chatsComplete = 0;
  state.chatsHidden = 0;
  state.messagesDeleted = 0;
  state.wouldDelete = 0;
  state.confirmationsClicked = 0;
  state.failures = [];
  state.log = [];
  state.dryRunSeen = new Set();
}

export function isStopped(): boolean {
  return state.stopRequested;
}

function addLog(level: "info" | "warn", message: string): void {
  const time = new Date().toLocaleTimeString();
  state.log.push(`${time} ${level === "warn" ? "!" : "-"} ${message}`);

  if (state.log.length > LOG_LIMIT) {
    state.log.splice(0, state.log.length - LOG_LIMIT);
  }

  const output = level === "warn" ? console.warn : console.log;
  output(`[Chat cleanup] ${message}`);
}

export const log = (message: string): void => addLog("info", message);
export const warn = (message: string): void => addLog("warn", message);

export function snapshot(): RunSnapshot {
  return {
    running: state.running,
    stopped: state.stopRequested,
    phase: state.phase,
    options: state.options,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    currentChat: state.currentChat,
    chatsAttempted: state.chatsAttempted,
    chatsComplete: state.chatsComplete,
    chatsHidden: state.chatsHidden,
    messagesDeleted: state.messagesDeleted,
    wouldDelete: state.wouldDelete,
    confirmationsClicked: state.confirmationsClicked,
    failures: state.failures,
    log: state.log,
  };
}
