# Polls in Churp

In a Nest where you can post, tap **+ → Poll** in the message composer. Enter a title, one question, and at least two choices. **Add another question** adds to the same poll. Each question offers either one answer or multiple answers; there are no separate Survey, short-text or yes/no types. The builder supports up to ten questions and ten choices per question, within the encrypted message size limit.

The posted message shows a closed envelope with only the poll title. Opening it animates the flap and reveals one question at a time. Selecting an option drops an egg into its basket. **Submit answers** saves all questions together. A member can reopen the envelope and update the same response until the creator or a Nest admin closes the poll. Those people can also reopen it. Results appear after responding, or when the poll is closed. Responses are linked to accounts; this release does not offer anonymous voting, deadlines, reminders, exports, or RSVPs.

Members can vote in an announcement-only Nest even when they cannot post messages. They must already have had access to the poll when it was sent. Later joining, leaving/rejoining, removal from a Tree, and private Nest membership use the existing encrypted history rules. A member without access to the original poll cannot read its results or vote.

## Storage and privacy

Poll titles, questions, choices and answers use the existing signed encrypted message format. The encrypted `contentType` binds the contents to a poll or response. Existing managed-key and self-managed-key behavior is preserved; a poll is not automatically advertised as end-to-end encrypted in a Nest containing managed-key members.

`messages.message_kind` distinguishes normal chat, poll envelopes, and encrypted responses. The `polls` table holds the message reference and open/closed status. `poll_votes` holds one current response reference per member per poll. Retried encrypted submissions are idempotent; subsequent submissions replace that reference. Response revisions remain encrypted in storage. Ballots never appear as chat messages or thread replies and do not create notification records or unread counts. Poll deletion clears its response contents and current-response references.

The server enforces account membership, original poll access, creation/management privileges, one current response per account, and closure, rechecking access after cryptographic verification. As with encrypted messages, recipients verify and validate the contents on their devices. Invalid or unverifiable answers are excluded from results with an explicit warning. All currently eligible readers can retrieve encrypted responses; showing results after voting is a presentation choice, not a cryptographic restriction.

## Artwork and checks

Generated artwork is in `public/brand/polls/`: `basket.png`, `egg.png`, and `envelope.png`. The original generated files are retained in the workspace. Motion respects the device's reduced-motion setting, choices use native radio/checkbox semantics, and dialogs use the app's existing focus handling.

Run `npm run check` for validation and encrypted API/history/permissions tests. Run `npx playwright test -c playwright.encryption.config.js e2e/polls.spec.js` for the two-user encrypted poll workflow on desktop, iPhone-sized and Android-sized browsers. The encryption browser suite also covers ordinary messages and attachments, recovery, key transitions and history conversion.
