import type { RunOptions } from "./types";

/** Reddit usernames: 3-20 characters, letters, digits, underscore, hyphen. */
const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,20}$/;

export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^u\//i, "");
}

/** Returns an error message, or null if the options can be used for a run. */
export function validateOptions(options: RunOptions): string | null {
  if (!USERNAME_PATTERN.test(options.username)) {
    return "Enter a valid Reddit username (3-20 letters, digits, _ or -).";
  }

  if (
    options.maxChats !== null &&
    (!Number.isInteger(options.maxChats) || options.maxChats < 1)
  ) {
    return "Max chats must be a whole number of 1 or more, or blank for no limit.";
  }

  return null;
}
