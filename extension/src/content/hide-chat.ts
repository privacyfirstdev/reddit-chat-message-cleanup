import { ACTIONABLE, SELECTORS } from "./config";
import { deepQueryAll, deepText, isVisible, localQuery, waitFor } from "./dom";
import { findFreshRoom } from "./rooms";
import { dismissStrayDialog, elementInsideDialog } from "./confirm";
import { log, warn } from "./state";

/*
 * UNVERIFIED against the live site. The selectors are broad text matches
 * and the hide toggle may be a faceplate-switch-input. Only runs when
 * hideEmptyChats is turned on in the popup.
 */

function findRoomSettingsButton(): HTMLElement | null {
  const candidate = deepQueryAll<HTMLElement>(SELECTORS.roomSettingsButton).find(
    isVisible,
  );

  if (candidate) {
    return localQuery<HTMLElement>(candidate, 'button, [role="button"]') || candidate;
  }

  // Fallback in case the tag name changes.
  return (
    deepQueryAll<HTMLElement>('button, [role="button"]').find(
      (element) =>
        isVisible(element) &&
        /\bsettings\b/i.test(deepText(element)) &&
        !elementInsideDialog(element),
    ) || null
  );
}

function findHideChatControl(): HTMLElement | null {
  const candidates = deepQueryAll<HTMLElement>(
    [
      '[role="menuitem"]',
      "rs-menu-item",
      "rs-dropdown-item",
      '[role="switch"]',
      "faceplate-switch-input",
      "button",
      '[role="button"]',
    ].join(","),
  ).filter(isVisible);

  return (
    candidates.find((element) => {
      const text = deepText(element).toLowerCase();

      return (
        /\bhide\b/.test(text) &&
        /\b(chat|conversation|thread|room)\b/.test(text) &&
        !/unhide|show/.test(text)
      );
    }) ||
    candidates.find((element) => /^hide$/i.test(deepText(element).trim())) ||
    null
  );
}

function findHideConfirmButton(): HTMLElement | null {
  const matches = deepQueryAll<HTMLElement>(ACTIONABLE)
    .filter(
      (element) =>
        isVisible(element) &&
        elementInsideDialog(element) &&
        !(element as HTMLButtonElement).disabled &&
        element.getAttribute("aria-disabled") !== "true",
    )
    .map((element) => ({
      element,
      text: deepText(element).toLowerCase().trim(),
    }))
    .filter(({ text }) => {
      const wordCount = text.split(/\s+/).filter(Boolean).length;

      if (!text || wordCount > 4) {
        return false;
      }

      return /\bhide\b/.test(text) && !/unhide/.test(text);
    })
    .sort((a, b) => {
      const aExact = /^yes\s*,?\s*hide$/i.test(a.text) ? 1 : 0;
      const bExact = /^yes\s*,?\s*hide$/i.test(b.text) ? 1 : 0;
      return bExact - aExact;
    });

  return matches[0]?.element || null;
}

/** Hides a chat through its room settings. Returns true only if the room disappears from the list. */
export async function attemptHideChat(
  roomId: string,
  chatName: string,
): Promise<boolean> {
  const settingsButton = findRoomSettingsButton();

  if (!settingsButton) {
    warn(`Hide skipped for ${chatName}: couldn't find the room settings control.`);
    return false;
  }

  log(`Opening room settings for ${chatName} to hide it.`);
  settingsButton.click();

  const hideControl = await waitFor(findHideChatControl, 2000, 75);

  if (!hideControl) {
    warn(`Hide skipped for ${chatName}: no "Hide chat" option found in room settings.`);
    await dismissStrayDialog();
    return false;
  }

  hideControl.click();

  // Some UIs hide immediately with no confirm dialog.
  const confirmButton = await waitFor(findHideConfirmButton, 1500, 75);

  if (confirmButton) {
    log(`Confirming hide for ${chatName}.`);
    confirmButton.click();
  }

  const hidden = await waitFor(() => !findFreshRoom(roomId), 4000, 100);

  if (!hidden) {
    warn(`Hide may not have completed for ${chatName}: the room is still listed.`);
    await dismissStrayDialog();
    return false;
  }

  log(`Hid chat: ${chatName}`);
  return true;
}
