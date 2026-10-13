/*
 * Everything that depends on Reddit's markup or timing lives here.
 * Reddit's DOM changes without notice, so when a run breaks, this file
 * is the first place to look.
 */

export const TUNING = {
  /*
   * The one knob with real Reddit-side risk (rate limiting and account
   * flags). 40 is the public default. Lower it if you see rate-limit
   * pauses or odd behavior from Reddit.
   */
  maxDeletesPerMinute: 40,
  deleteAttempts: 3,
  deleteVerifyMs: 4000,
  navigationWaitMs: 5500,
  scrollWaitMs: 350,
  delayAfterDeleteMs: 225,
  topStalls: 4,
  listStalls: 5,
  cleanupPasses: 2,
  /** How often the "Yes, delete" watcher polls the page. */
  autoConfirmPollMs: 40,
  /** Settle time before clicking a newly appeared confirm dialog. */
  confirmSettleMs: 150,
  /** Minimum gap between confirm clicks on the same dialog. */
  confirmRetryMs: 400,
} as const;

export const ROOM_URL_PREFIX = "https://www.reddit.com/chat";

export const SELECTORS = {
  roomsNav: "rs-rooms-nav",
  room: "rs-rooms-nav-room",
  roomName: ".room-name",
  /** Real wrapper for a room's events. Preferred container. */
  timeline: "rs-timeline",
  /** Legacy fallback. Not seen on the current site. */
  legacyRoomMessages: "rs-room-messages",
  virtualScroll: "rs-virtual-scroll-dynamic",
  roomContainer: "rs-room",
  threadTimeline: "rs-thread-timeline",
  event: "rs-timeline-event",
  roomSettingsButton: "rs-room-settings-button",
  /** Elements whose presence we report in diagnostics. */
  diagnosticTags: [
    "rs-rooms-nav",
    "rs-rooms-nav-room",
    "rs-room",
    "rs-timeline",
    "rs-timeline-event",
    "rs-virtual-scroll-dynamic",
    "rs-timeline-event-menu",
    "rs-timeline-event-reactions",
    "rs-room-settings-button",
    "rs-message-composer",
    "rs-delete-message-modal",
    "rs-confirmation-modal",
    "rpl-dialog",
    "faceplate-switch-input",
  ],
} as const;

/** Elements that can act as buttons in Reddit's UI. */
export const ACTIONABLE =
  'button, [role="button"], rpl-button, shreddit-button';
