import type { ContentRequest, ContentResponse } from "../shared/types";
import { validateOptions } from "../shared/validation";
import { collectDiagnostics, runPreflight } from "./preflight";
import { startRun, stopRun } from "./run";
import { snapshot, state } from "./state";

/*
 * Injected on demand by the popup (chrome.scripting.executeScript). Keep a
 * guard so re-injecting does not add a second message listener. The guard
 * lives on this isolated world's global, not on the page's window.
 */
const GUARD = "__chatCleanupContentInstalled";
const scope = globalThis as unknown as Record<string, unknown>;

function handle(request: ContentRequest): ContentResponse {
  switch (request.type) {
    case "status":
      return { ok: true, data: snapshot() };

    case "preflight":
      return { ok: true, data: runPreflight() };

    case "diagnostics":
      return { ok: true, data: collectDiagnostics() };

    case "stop":
      stopRun();
      return { ok: true };

    case "start": {
      if (state.running) {
        return { ok: false, error: "A run is already active on this page." };
      }

      const problem = validateOptions(request.options);

      if (problem) {
        return { ok: false, error: problem };
      }

      // Not awaited. The popup polls status for progress.
      startRun(request.options).catch((error: unknown) => {
        console.error("[Chat cleanup] Unexpected failure:", error);
      });

      return { ok: true };
    }

    default:
      return { ok: false, error: "Unknown request." };
  }
}

if (!scope[GUARD]) {
  scope[GUARD] = true;

  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse: (response: ContentResponse) => void) => {
      try {
        sendResponse(handle(message as ContentRequest));
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return false;
    },
  );
}
