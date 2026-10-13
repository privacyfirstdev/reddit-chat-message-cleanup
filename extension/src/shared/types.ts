// Shared between the popup and the content script. Keep this file free of DOM code.

export interface RunOptions {
  username: string;
  /** null means no limit. */
  maxChats: number | null;
  /** Hide chats that were verified complete with zero of your messages found. Off by default. */
  hideEmptyChats: boolean;
  /** Detect and count your messages without deleting anything. */
  dryRun: boolean;
}

export interface Failure {
  type: "message" | "chat" | "script";
  id?: string;
  name?: string;
  context?: string;
  reason?: string;
}

export interface RunSnapshot {
  running: boolean;
  stopped: boolean;
  phase: string;
  options: RunOptions | null;
  startedAt: string | null;
  finishedAt: string | null;
  currentChat: string | null;
  chatsAttempted: number;
  chatsComplete: number;
  chatsHidden: number;
  messagesDeleted: number;
  wouldDelete: number;
  confirmationsClicked: number;
  failures: Failure[];
  log: string[];
}

export interface PreflightCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export type ContentRequest =
  | { type: "status" }
  | { type: "preflight" }
  | { type: "diagnostics" }
  | { type: "start"; options: RunOptions }
  | { type: "stop" };

export type ContentResponse =
  | { ok: true; data?: unknown }
  | { ok: false; error: string };
