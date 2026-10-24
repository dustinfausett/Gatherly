# RSVP invitations

In a Nest where you can post, choose **+ → RSVP**. Add a title, date/time or all-day date, optional end, location/link, description and optional response deadline. Timed inputs use the device's time zone and are saved as absolute instants alongside the event zone. Readers see their local time; all-day dates stay the same across zones.

The chat invitation uses the coordinated blue-and-gold birds holding a closed envelope, with the title and date beside the illustration. Touching it shows the matching opened envelope for 250 milliseconds before opening the invitation. Polls use the same bird pair holding a ballot, and Assignments use them with a clipboard. See the [coordinated illustration gallery](../public/brand/activities/README.md).

Each response option starts as an egg. Selecting Going hatches a happy bird, Maybe a questioning bird, and Can’t go a sad bird. These generated assets match the activity set’s blue bird and cream egg with gold speckles; the hatch respects reduced motion. Going/Maybe reveal an **Additional guests** box (0–99, excluding the member). Can’t go always saves zero guests. Save response or Update response persists one current response per member. Changing a response moves its entire party between categories. No chat bubbles, notifications, pushes or unread eggs are created by response updates.

## Results and management

Open the invitation from chat or **the Nest in the chat header → RSVPs**. Shared invitations are newest first. Closing an invitation opened from shared items returns to that category, with one active dialog at a time.

The Responses tab shows Going, Maybe and Can’t go separately. Going/Maybe each show responding members + additional guests and a party total. All eligible Nest members can see totals. Creator/admin views also provide named lists and a No response list of current memberships that can access the original invitation. Removed, later-joining and rejoining memberships are excluded from No response. Existing valid responses remain in totals if their member subsequently leaves; they are still event commitments.

Creators and Nest admins can edit event details, close/reopen responses or cancel/restore the event. Cancellation leaves the invitation visible and disables responses. A passed deadline is enforced by the server, not just the screen; edit/clear the deadline to allow responses again. Edits preserve responses and the original invitation’s history boundary. Concurrent edits and responses against an outdated event version are rejected so the user can review current details. Event editing by an admin preserves the original author and records the admin’s signature on the revised contents.

## Storage and privacy

Definitions (`rsvp`) and responses (`rsvp_response`) use signed encrypted Nest messages. Titles, dates, locations, descriptions, choices and guest counts live in encrypted contents. The server stores invitation open/canceled state, the response deadline (for enforcement), latest-response references and normal message metadata. It never needs plaintext event details or answer contents. Managed/self-managed key behavior follows the Nest’s existing encryption rules.

Only members who can access the original invitation can read its responses or respond, including in announcement-only Nests. Joining later or leaving/rejoining does not unlock an old invitation. The server rechecks access, deadline, event version, closure and recipient roster after async signature checks. Responding twice updates the current-response pointer; signed retries are idempotent. Response revisions remain encrypted in storage; deleting the invitation scrubs their contents and pointers.

As with Polls, responses are encrypted for Nest readers, not anonymous votes. The named-list layout is an interface distinction, not a cryptographic promise that other Nest recipients can never associate a response with its sender. Unverifiable responses are explicitly excluded from totals. This release has no payments, recurring events, volunteer assignments, calendar sync or automatic reminders.

Run `npm run check`, and `npx playwright test -c playwright.encryption.config.js e2e/rsvps.spec.js` for API validation/access tests and desktop/iPhone-sized/Android-sized encrypted RSVP flows.
