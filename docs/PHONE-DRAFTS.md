# Churp-first messaging and personal-phone drafts

Twilio/provider sending is retired. Production forces the old SMS integration to **disabled**, regardless of `SMS_MODE`, Twilio credentials or pilot flags left in Railway. No new provider account, sender number, enrollment form, R-code, shared-number STOP footer or SMS budget is needed for this flow. Existing provider records are retained; queued provider texts cannot dispatch and old scheduled SMS parts wait for review/cancellation. The app does not cancel a user's separately rented Twilio number or its billing.

## Compose

**Messages → Compose → New Message / Send Many Individually** reuses the existing Tree, optional Nest, Contacts and Birdhouse selectors. Linked, authorized Churp members receive separate encrypted private messages through the existing private-chat service. Phone-only saved contacts get separate drafts, not automatic sends. A linked Churp contact never falls back to phone texting after an error, block or missing parent approval. Recipients do not see the other selected people. The combined composition supports up to 50 recipients.

The review shows exactly how many messages go through Churp and how many become phone drafts. Churp recipients retain the usual per-person send results and idempotent retries. Phone results say **Phone draft ready** or **Phone reminder scheduled**, never Sent. Phone drafts are saved first with an idempotent request ID; a failed in-app send does not create duplicate phone drafts when retried. Churp sends and phone reminders are separate saved operations; editing one later does not change the other.

Tree filters apply to known Churp memberships and supply invitation context for phone contacts. Unlinked saved phone contacts have no known Tree/Nest membership: they can appear under Contacts/Birdhouses when a Tree is selected, but a Nest filter excludes them. Phone numbers are never guessed into Churp identities.

## First-name personalization

Write `Hi [first name], ...` in Send Many Individually, or use **Insert first name** at the cursor. Review shows a separate expanded message for each recipient before sending. Churp uses the first word of the member’s display name or the saved phone contact’s name, preserving spelling, accents and punctuation; an unavailable/blank name uses `there`. Case and spacing variants such as `[First Name]`, `[firstname]` and `[first_name]` work too. Other bracketed text remains literal. Check previews for names that begin with a title or a family/group label.

Churp messages are personalized in the browser before each independently encrypted send. New scheduled batches retain the original template and a conversation-to-name snapshot inside the sender-only encrypted draft, so editing/rescheduling regenerates each recipient’s correct ciphertext and faded preview. Phone drafts store the template and reviewed recipient-name snapshots under the existing managed vault and expand at handoff. Editing a phone draft refreshes those snapshots from the saved contacts. Existing pre-feature queued ciphertext and phone drafts remain unchanged unless edited; no migration rewrites previously prepared messages. Expanded messages must remain within the existing 10,000-character limit.

## Phone handoff

Open **Messages → Phone drafts**, or select **Open phone drafts** in the compose results. Saved cards survive refresh and device changes. Review a recipient to see the complete text, their phone number, the sender's name and the short Tree invitation (or Churp sign-in URL when no Tree was selected). Tree invitations reuse Churp's existing service, including member-invitation admin approval and admin invitation privileges. A fresh invitation is made at review so a future reminder does not reuse an expired original link.

**Open in Messages** is a directly tapped `sms:` link with **one recipient only**, using the iOS/Android body separator. The phone's messaging app selects its configured sending account/number. The user reviews it and taps Send. Churp cannot silently send, pick the user's SIM/account, attach files through this link, or observe sending, cancellation, delivery, reading or replies. The phone/app decides whether it uses SMS, RCS or iMessage. Replies stay in that app. Copy message, Copy number and selectable text provide fallbacks on desktop or unsupported browsers.

Opening the link records only **Opening requested · send not confirmed**. **I sent this text** records **Marked sent by you**, a manual statement, not a delivery receipt. Skipped/finished recipients cannot accidentally be reopened from the saved batch. Cancelling remaining drafts cannot recall text already copied or opened in another app. Draft edits/rescheduling are allowed before a handoff has begun. If the user cancels in their phone messaging app, I didn’t send it explicitly returns the recipient to an unsent draft for editing. Once marked sent, create a new draft rather than silently changing that text.

## Scheduling

Churp messages retain automatic scheduled delivery and faded sender-only previews in their conversations. Phone-only destinations instead have **reminders**: the saved draft becomes ready at the chosen time and Churp queues one generic device notification through the existing notification preferences and 30-second cooldown. Notification delivery depends on normal browser/device support, permissions and server availability. No provider text is sent and no phone messaging app is opened automatically. Reminders persist across server restarts and are also shown under **Your corner → Scheduled messages → Phone draft reminders**. Edit, reschedule or cancel there or from Phone drafts. The user still reviews and sends manually.

## Permissions and storage

Drafts are owner-only and use the existing Churp-managed vault for authenticated encryption at rest. Draft text and recipient snapshots do not use a self-managed messaging identity and do not get the E2EE shield. Authenticated owner checks, same-origin checks and rate limits apply to all draft APIs. Contacts must belong to the sender; sender Tree membership/source-Nest admin permissions are checked at creation and again at handoff. Changed/deleted numbers or contacts stop the handoff for review. Known live-provider opt-out suppression remains respected. Explicitly linked Churp contacts must use Churp, including youth/parent and block rules; externally messaging unlinked numbers is not a way to verify or supervise those identities. Phone draft creation/handoff is limited to adult accounts. The user remains responsible for having permission to contact saved external numbers.

The additive `phone_drafts` table holds encrypted payloads, owner/idempotency IDs, reminder time, revision and cancellation/notification markers. The existing Railway Volume and key-vault master must be preserved. No private messages, provider history, contact records or existing keys are deleted by this change. Legacy provider test adapters remain available only to explicit isolated server test fixtures; production cannot activate them.

## Validation and deployment

`tests/phone-drafts.test.js` covers one-recipient URI encoding, Unicode/newlines, persistence, encrypted storage, idempotency, owner isolation, reminders, edits/cancellation, fresh invitations, revoked permissions, changed numbers, linked/youth exclusion and production provider disablement. `e2e/sms.spec.js` now covers the replacement flow: real encrypted Churp fan-out, separate phone handoffs, honest states, copying, saved drafts and scheduled reminders. Tests intercept external app launches and never send a real text. Check actual iPhone Home Screen/Safari and Android messaging apps after deployment; browser emulation cannot establish how a phone's messaging app handles its URI.

Deploy normally. No Twilio environment variables are needed. They may be removed separately from Railway; leaving them present does not enable provider sending. To stop a Twilio number's rental charges, release it in Twilio separately after reviewing that account's active resources.
