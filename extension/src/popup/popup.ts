import type {
  ContentRequest,
  ContentResponse,
  PreflightCheck,
  RunOptions,
  RunSnapshot,
} from "../shared/types";
import { normalizeUsername, validateOptions } from "../shared/validation";

const PAGE_PREFIX = "https://www.reddit.com/chat";
const POLL_MS = 1000;

/** Plain-language names for the content script's internal phases. */
const PHASE_LABELS: Record<string, string> = {
  idle: "Idle",
  starting: "Starting",
  preflight: "Checking page",
  navigating: "Opening chats",
  listing: "Scanning chats",
  opening: "Scanning chats",
  returning: "Scanning chats",
  counting: "Counting matches",
  sweeping: "Deleting messages",
  hiding: "Hiding chats",
  stopped: "Stopped",
  finished: "Finished",
};

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);

  if (!el) {
    throw new Error(`Missing element #${id}`);
  }

  return el as T;
};

const ui = {
  pageState: $<HTMLElement>("page-state"),
  chatLink: $<HTMLAnchorElement>("chat-link"),
  warning: $<HTMLElement>("warning"),
  formSection: $<HTMLElement>("form-section"),
  statusSection: $<HTMLElement>("status-section"),
  username: $<HTMLInputElement>("username"),
  maxChats: $<HTMLInputElement>("max-chats"),
  testMode: $<HTMLInputElement>("test-mode"),
  hideEmpty: $<HTMLInputElement>("hide-empty"),
  modeNote: $<HTMLParagraphElement>("mode-note"),
  check: $<HTMLButtonElement>("check"),
  start: $<HTMLButtonElement>("start"),
  stop: $<HTMLButtonElement>("stop"),
  formError: $<HTMLParagraphElement>("form-error"),
  checkResult: $<HTMLElement>("check-result"),
  checkList: $<HTMLUListElement>("check-list"),
  checkSummary: $<HTMLParagraphElement>("check-summary"),
  checkTime: $<HTMLSpanElement>("check-time"),
  phase: $<HTMLElement>("phase"),
  modeLabel: $<HTMLElement>("mode-label"),
  chat: $<HTMLElement>("chat"),
  chats: $<HTMLElement>("chats"),
  countLabel: $<HTMLElement>("count-label"),
  count: $<HTMLElement>("count"),
  complete: $<HTMLElement>("complete"),
  failures: $<HTMLElement>("failures"),
  thanks: $<HTMLElement>("thanks"),
  thanksCount: $<HTMLElement>("thanks-count"),
  log: $<HTMLPreElement>("log"),
  diagnostics: $<HTMLButtonElement>("diagnostics"),
  diagResult: $<HTMLSpanElement>("diag-result"),
};

let tabId: number | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

/* ---------- Messaging ---------- */

async function activeRedditTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id || !tab.url?.startsWith(PAGE_PREFIX)) {
    return null;
  }

  return tab;
}

let injected = false;

/**
 * Sends a request to the content script. Injects it first if needed. Injection is
 * idempotent inside the script, and activeTab grants access while the popup is open.
 */
async function send<T = unknown>(request: ContentRequest): Promise<T> {
  if (tabId === null) {
    throw new Error("No Reddit chat tab is selected.");
  }

  if (!injected) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    injected = true;
  }

  let response: ContentResponse;

  try {
    response = (await chrome.tabs.sendMessage(tabId, request)) as ContentResponse;
  } catch (error) {
    // The page reloaded or the script is gone. Re-inject on the next call.
    injected = false;
    throw error;
  }

  if (!response.ok) {
    throw new Error(response.error);
  }

  return response.data as T;
}

/* ---------- Rendering ---------- */

function setError(message: string): void {
  ui.formError.textContent = message;
  ui.formError.hidden = !message;
}

function readForm(): RunOptions {
  const maxRaw = ui.maxChats.value.trim();

  return {
    username: normalizeUsername(ui.username.value),
    maxChats: maxRaw === "" ? null : Number(maxRaw),
    hideEmptyChats: ui.hideEmpty.checked,
    dryRun: ui.testMode.checked,
  };
}

/** The start button says what it will do: count in test mode, delete otherwise. */
function syncModeControls(): void {
  const testMode = ui.testMode.checked;

  ui.start.textContent = testMode ? "Count matches" : "Start deleting";
  ui.start.className = testMode ? "primary" : "danger";
  ui.modeNote.hidden = !testMode;
}

function render(snap: RunSnapshot): void {
  const running = snap.running;
  // While a run is active, show what it is doing. The run's own mode wins over the checkbox.
  const testRun = snap.options ? snap.options.dryRun : ui.testMode.checked;

  ui.formSection.hidden = running;
  ui.statusSection.hidden = !snap.running && snap.log.length === 0;
  ui.stop.hidden = !running;

  ui.phase.textContent = PHASE_LABELS[snap.phase] ?? snap.phase;
  ui.modeLabel.textContent = testRun ? "Test mode" : "Live";
  ui.chat.textContent = snap.currentChat ?? "-";
  ui.chats.textContent = String(snap.chatsAttempted);
  ui.countLabel.textContent = testRun ? "Would delete" : "Deleted";
  ui.count.textContent = String(testRun ? snap.wouldDelete : snap.messagesDeleted);
  ui.complete.textContent = String(snap.chatsComplete);
  ui.failures.textContent = String(snap.failures.length);

  // Ask for support only at the moment of value: a live run that finished and deleted something.
  const finishedLive = !snap.running && !snap.stopped && !!snap.finishedAt && !testRun;
  ui.thanks.hidden = !(finishedLive && snap.messagesDeleted > 0);
  ui.thanksCount.textContent = String(snap.messagesDeleted);

  // Keep scrolled to the bottom only if the user was already there.
  const atBottom =
    ui.log.scrollTop + ui.log.clientHeight >= ui.log.scrollHeight - 8;

  ui.log.textContent = snap.log.slice(-200).join("\n");

  if (atBottom) {
    ui.log.scrollTop = ui.log.scrollHeight;
  }
}

function renderChecks(checks: PreflightCheck[]): void {
  const items = checks.map((check) => {
    const item = document.createElement("li");

    const icon = document.createElement("span");
    icon.className = `check-icon ${check.ok ? "ok" : "fail"}`;
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = check.ok ? "✓" : "×";

    // check.name is an internal id, so the popup shows only the readable detail.
    const text = document.createElement("span");

    const verdict = document.createElement("b");
    verdict.className = check.ok ? "" : "fail-name";
    verdict.textContent = check.ok ? "OK." : "Fail.";

    const detail = document.createElement("span");
    detail.className = "detail";
    detail.textContent = check.detail;

    text.append(verdict, " ", detail);
    item.append(icon, text);

    return item;
  });

  const failed = checks.filter((check) => !check.ok).length;

  ui.checkList.replaceChildren(...items);
  ui.checkTime.textContent = "Ran just now";
  ui.checkSummary.textContent =
    failed === 0
      ? "All checks passed."
      : `${failed} ${failed === 1 ? "check" : "checks"} failed. Don't start deleting until it passes.`;
  ui.checkResult.hidden = false;
}

/* ---------- Polling ---------- */

async function refresh(): Promise<void> {
  if (tabId === null) {
    return;
  }

  try {
    const snap = await send<RunSnapshot>({ type: "status" });
    render(snap);

    // Running state is the source of truth. Re-fill the form from the last run.
    if (snap.options && !ui.username.value) {
      ui.username.value = snap.options.username;
    }
  } catch {
    // Not reachable (page reloading, or the content script has not loaded yet). Retry on the next tick.
  }
}

/* ---------- Actions ---------- */

async function onStart(): Promise<void> {
  setError("");

  const options = readForm();
  const problem = validateOptions(options);

  if (problem) {
    setError(problem);
    return;
  }

  try {
    await send({ type: "start", options });
    await refresh();
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  }
}

async function onCheck(): Promise<void> {
  setError("");

  try {
    renderChecks(await send<PreflightCheck[]>({ type: "preflight" }));
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  }
}

async function onStop(): Promise<void> {
  try {
    await send({ type: "stop" });
    await refresh();
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  }
}

async function onDiagnostics(): Promise<void> {
  try {
    const data = await send<Record<string, unknown>>({ type: "diagnostics" });

    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    ui.diagResult.textContent = "Copied. No names or message text included.";
  } catch (error) {
    ui.diagResult.textContent =
      error instanceof Error ? error.message : "Copy failed.";
  }
}

/* ---------- Init ---------- */

async function init(): Promise<void> {
  const tab = await activeRedditTab();

  if (!tab?.id) {
    ui.pageState.hidden = false;
    ui.warning.hidden = true;
    ui.formSection.classList.add("grayed");
    // Send the current tab to the chat page, then close the popup.
    ui.chatLink.addEventListener("click", (event) => {
      event.preventDefault();
      chrome.tabs.update({ url: `${PAGE_PREFIX}` }).then(() => window.close());
    });
    ui.check.disabled = true;
    ui.start.disabled = true;
    ui.diagnostics.disabled = true;
    ui.username.disabled = true;
    ui.maxChats.disabled = true;
    ui.testMode.disabled = true;
    ui.hideEmpty.disabled = true;
    return;
  }

  tabId = tab.id;

  ui.check.addEventListener("click", onCheck);
  ui.start.addEventListener("click", onStart);
  ui.stop.addEventListener("click", onStop);
  ui.diagnostics.addEventListener("click", onDiagnostics);
  ui.testMode.addEventListener("change", syncModeControls);
  syncModeControls();

  await refresh();
  pollTimer = setInterval(refresh, POLL_MS);
}

window.addEventListener("unload", () => {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
  }
});

init().catch((error: unknown) => {
  setError(error instanceof Error ? error.message : String(error));
});
