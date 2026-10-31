# Scheduled messages

## Where to find it

- **Nest messages, thread replies and private chats:** use the clock beside Send, choose a local date and time, then select **Schedule message**.
- **Polls, RSVPs, Assignments, Send Many Individually and phone drafts:** turn on **Schedule send** in the existing creation/review screen. Attachments in supported in-app messages are included.
- **In the conversation:** scheduled messages appear as faded, sender-only previews in their Nest, private chat or phone text conversation. They show the send time and **Not sent yet**, with Edit, Reschedule and Cancel send controls available by holding the preview for ¾ of a second. Scheduled replies also appear in their thread. Polls, RSVPs and Assignments keep their branded artwork but cannot receive responses before posting.
- **Your corner → Scheduled messages:** the central list remains available to view upcoming sends, edit their contents, reschedule or cancel. Messages has a Scheduled messages shortcut. Phone reminders are listed under Phone drafts and in the same outbox. **All sends** includes history.

The first scheduled date can be up to a year ahead; optional recurring rules continue the series from that date. The picker uses the device's time zone; Churp stores an absolute UTC instant and displays its saved zone in the outbox. A batch can contain up to 500 private recipients, and each account can have up to 100 active scheduled sends. Send now continues to use the existing message flow.

Recipients cannot see queued drafts or their attachments. Attachments are uploaded and encrypted when scheduled; their filenames appear in the sender's preview, and recipients gain access only when the message posts. Editing a scheduled Poll, RSVP or Assignment reopens its original builder. RSVP deadlines must fall after the send time. Once delivery starts, completed messages cannot be edited or cancelled through the scheduler; remaining parts of a partially completed batch can be cancelled. The faded preview disappears when its message posts or is cancelled. For Send Many Individually and phone draft reminders, the preview appears in each selected conversation; its controls clearly state that changes affect the whole batch.

## Encryption and permission checks

The browser signs and encrypts in-app messages for their current recipients before scheduling. An additional sender-only encrypted draft supports editing; self-managed private keys are never uploaded. Queue packets, including phone text payloads, are encrypted at rest using the existing key-vault master. Preserve `/data/key-vault.key` (or the deployment's existing `CHURP_KEY_VAULT_SECRET`) along with SQLite and encrypted uploads. No login cookie or session token is stored in a scheduled send.

At delivery, Churp checks the scheduling device's approval, the sender's current access, posting permissions, recipient membership and keys, blocking and youth/parent approvals through the existing message services. A changed encryption roster or key holds the affected send as **Needs review**. Edit or reschedule it from an approved device to encrypt it for the current audience. A private batch keeps the selected recipients rather than silently adding new Tree or Nest members.

Phone-only contacts use [personal-phone draft reminders](PHONE-DRAFTS.md), not automatic SMS. Reminders become ready and can notify the sender, who opens each text in their own messaging app and taps Send. Phone reminder edits/cancellation are separate from in-app scheduled messages. Provider texting is retired; existing provider SMS schedules are held for cancellation and cannot dispatch.

## Running on Railway

The existing Node service processes due sends; no separate cron service or browser session is required. Keep **one replica**, the persistent Volume mounted at `/data`, and the original vault key. Per-message receipts are saved in the same transaction as message creation, so restarting does not post a completed message twice. Pending work resumes after restart.

For on-time sends, the service must stay running. In **Railway → Churp's app service → Settings**, disable the option named **Serverless** or **App Sleeping** if it is enabled. A sleeping service does not wake itself just because a scheduled time arrives. This account-level setting cannot be verified or changed from the repository. While the service is stopped, sleeping or redeploying, sends remain pending and run after it resumes; exact delivery time during downtime is not guaranteed.

## Verification

`tests/scheduling.test.js` covers encrypted files, self-managed keys, no early recipient access, restart recovery, duplicate prevention, owner and conversation isolation, versioned edits, cancellation, membership/device/block holds, structured posts and mock SMS with fresh invitations. Browser checks in `e2e/scheduling.spec.js` cover desktop and phone layouts, all creation controls and draft management, retrying after a lost response, sender-only conversation previews, inline editing, thread placement and replacement with one active message at delivery. Mock tests do not contact Twilio. Browser emulation does not replace checking the date/time picker on a physical iPhone.

## Recurring sends

Below the date/time, **Recurring** opens daily, weekly (one or more weekdays), monthly (calendar date or first/second/third/fourth/fifth/last weekday), and yearly patterns. Intervals are at least one day. An optional end date and explicit excluded dates bound the series; **Next sends** previews the next three matching dates. Calendar rules use the scheduling time zone, retain local clock time across daylight saving, skip nonexistent local times and missing calendar dates, and never generate two occurrences of one series on the same local date.

Recurring Churp messages work with the app closed. Each occurrence gets a unique delivery ID for retry safety while retaining the original signed encrypted content and attachment descriptors. The server rechecks current membership, youth approval, blocks, device approval, key rosters and activity deadlines before each send. Changed audiences/keys or expired RSVP deadlines pause the series for review; the sender can edit/reschedule its future occurrences or cancel the series from the faded conversation preview or outbox. An already-sent occurrence is independent of later edits. Restart recovery advances a fully delivered occurrence even if shutdown happened before the next date was written. After an outage, one overdue occurrence can send; missed repeats are skipped rather than replayed in a burst.

**Message myself** creates a real owner-only private conversation for notes, encrypted uploads and reminders. Linked parents retain their normal supervision of youth self-notes. Scheduled self-reminders can notify their owner and contribute to unread badges while the app is in the background.

Phone-only recipients remain manual. A recurring phone schedule creates a fresh set of individual drafts and one reminder for each occurrence; it never sends through the phone messaging app. Edit the next future reminder to change subsequent repeats. Cancelling a phone series prevents future reminders and handoffs; previously sent phone messages cannot be recalled.
