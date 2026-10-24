# Shared assignment lists

Choose **+ → Assignments** in a Nest where you can post. Start with one item and add up to 20 before sharing. A list has a title, optional description and date, and **Allow Nest members to add assignments** (off by default). Each item has a title, one responsible member or Open to volunteers, optional notes and an optional date overriding the list date. Dates are calendar days and do not shift between time zones. Lists support up to 100 active items; removed IDs cannot be reused.

The coordinated blue-and-gold bird pair holding a clipboard identifies the chat card and composer option. Cards share the Poll/RSVP card frame and show the title and completion count. See the [illustration gallery](../public/brand/activities/README.md). Open the card or **the header Nest → Assignments** for the shared tracker; completed items follow unfinished items. The library lists newest shared lists first and returns to the category when the tracker closes.

Creators and Nest admins can add/edit/reassign/remove items and change list settings at any time. When member additions are enabled, other eligible members can add open items or assign a new item to themselves; they cannot assign work to someone else or edit/remove existing items. Members can claim an unfinished unassigned item, complete/reopen their own items, or release their own unfinished items. Managers can complete/reopen any item. These actions work in announcement-only Nests. Only creation of a whole list requires posting rights.

Collaboration changes apply immediately to open clients. Disabling additions preserves existing tasks and claiming/completion rights. Two users cannot claim the same item: the first committed update wins. All mutations use a revision check; conflicts refresh the list with an error instead of silently overwriting other work. An editor opened before a change must be closed/reopened to review the latest list before saving its draft. Server-accepted retries with the same signed ciphertext and operation are idempotent.

## Encryption and access

The initial definition is an immutable signed encrypted `assignments` message. Subsequent signed `assignment_op` messages contain settings, item text or state changes. A second detached signature binds each encrypted message to the operation/creation metadata enforced by the server. Labels, descriptions, notes and dates remain encrypted. Normal metadata includes list/item IDs, assignee IDs, completion/removal states, collaboration policy and revision numbers; the server uses it to authorize updates and count progress.

The initial message uses the Nest’s managed/self-managed key behavior. Updates encrypt to currently eligible original list recipients, excluding later joiners and people who leave/rejoin. Members who cannot access the original list cannot retrieve its state, operations or recipient roster. Adding a new Nest member does not share an old list with them; create a new list if the audience changes. Unavailable former assignees can be reassigned by a manager.

The tracker replays and verifies paginated encrypted operations against a fixed revision snapshot and checks the result against server control state. Verification errors are displayed explicitly. Metadata can show a compact card count, but opening the tracker verifies the complete contents. Updates trigger live refreshes without creating chat bubbles, unread counts or push notifications. Operation messages cannot be edited/deleted through generic chat endpoints. Deleting the original list clears encrypted operation contents and cascades control records. The current release has no assignment reminders, recurring tasks or multiple people per item.

## Checks

`npm run check` includes validation, signed permissions, original-audience restrictions, atomic competing claims, collaboration toggling, quiet updates, multi-page history, persistence and deletion. `npx playwright test -c playwright.encryption.config.js e2e/assignments.spec.js` covers the two-user encrypted UI on desktop/iPhone-sized/Android-sized Chromium. `tests/container-smoke.mjs` verifies persistence across container replacement and production browser/CSP behavior.
