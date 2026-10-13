# Account-Risk Notes: Chat Message Cleanup for Reddit

**Read this before you use the Extension.** It is also a disclosure to include in the store listing.

> DRAFT. Reddit's current rules are not verified in this document. Read them yourself (see section 2).

## 1. What can go wrong

- **Account action by Reddit.** Automated activity can be detected. Reddit may rate-limit your account, restrict certain actions, flag it for review, or suspend it. Restrictions may be temporary or permanent, and we cannot predict or prevent them.
- **Irreversible deletion.** Messages deleted through the Extension are generally not recoverable. Mistakes cannot be undone.
- **No second confirmation.** Once test mode is off, pressing "Start deleting" begins deleting straight away. Check the test-mode count before you turn test mode off.
- **Partial or wrong deletion.** Reddit's page layout changes without notice. The Extension may skip messages, fail to find them, or act on the wrong element. A run can end partway through, leaving some messages and chats unprocessed.
- **Unknown effect on recipients.** We have not verified whether deleting your messages also removes them from other participants' views, or what notifications Reddit sends. Assume that deletion is not invisible to others.
- **Hidden chats.** The hide-chat feature is unverified and off by default. Hiding a chat may have effects on the chat that we have not tested.
- **Breakage.** A Reddit update can stop the Extension from working, or make it behave differently. It may stop without finishing.

## 2. Reddit's rules

We have not confirmed Reddit's current wording on automated tools. Before you use the Extension, read Reddit's:

- User Agreement
- Content Policy
- Developer or Data API terms, if they apply to automated tools

Pay particular attention to any clauses on automated access, bots, scripts, third-party tools, interfering with normal use of the service, and deleting content. Reddit has publicly said that automated activity is a major source of account flags. Treat any violation of its terms as a serious risk.

## 3. What the Extension does to reduce risk

- **Test mode is on by default.** It counts matches and deletes nothing. The start button reads "Count matches" while test mode is on.
- **Two steps to go live.** A live run starts only after you turn test mode off and press "Start deleting". There is no further confirmation.
- **Rate limit.** It deletes at most 40 messages per minute, with pauses when that limit is reached.
- **Max-chats cap.** You can limit a run to a set number of chats.
- **Stop button.** You can stop a run at any time.
- **Pauses in background tabs.** A run pauses while its tab is hidden.
- **No whole-chat deletion.** Confirmation dialogs that would delete a whole chat are left for you to handle.
- **No credentials.** The Extension never asks for or stores your password or session tokens. It acts in the browser session you already have.
- **Hiding is opt-in and off by default.**

These measures reduce the chance of problems. They do not remove the risk.

## 4. Recommendations

1. Start in test mode on your own account, and compare the count against what you expect.
2. Run a small live test first, with a max-chats cap of 1 or 2, and watch the result.
3. Keep the rate limit at the default or lower. Do not raise it.
4. Do not run the Extension in several browsers or on several accounts at once.
5. If you see rate-limit warnings, errors, or unexpected behavior, stop the run and wait before trying again.
6. Keep a record of what you ran and when, in case you need to contact Reddit about your account.

## 5. Developer's position

We do not operate Reddit accounts, and we cannot restore messages or reverse account actions. Your account and your decision to use the Extension are your responsibility.

## 6. Store listing use

The store listing must link to this document or include the key points above in its description, so users see this risk before they install.
