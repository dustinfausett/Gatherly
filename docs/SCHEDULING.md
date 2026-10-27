# Scheduled messages

## Where to find it

- **Nest messages, thread replies and private chats:** use the clock beside Send, choose a local date and time, then select **Schedule message**.
- **Polls, RSVPs, Assignments, Send Many Individually and Phone texts:** turn on **Schedule send** in the existing creation/review screen. Attachments in supported in-app messages are included.
- **Your corner → Scheduled messages:** view upcoming sends, edit their contents, reschedule or cancel. Messages and Phone texts also have a Scheduled messages shortcut. **All sends** includes history.

Scheduling is a one-time send, up to a year ahead. The picker uses the device's time zone; Churp stores an absolute UTC instant and displays its saved zone in the outbox. A batch can contain up to 50 private recipients, and each account can have up to 100 active scheduled sends. Send now continues to use the existing message flow.

Recipients cannot see queued drafts or their attachments. Attachments are uploaded and encrypted when scheduled and become accessible through the message only when it posts. Editing a scheduled Poll, RSVP or Assignment reopens its original builder. RSVP deadlines must fall after the send time. Once delivery starts, completed messages cannot be edited or cancelled through the scheduler; remaining parts of a partially completed batch can be cancelled.

## Encryption and permission checks

The browser signs and encrypts in-app messages for their current recipients before scheduling. An additional sender-only encrypted draft supports editing; self-managed private keys are never uploaded. Queue packets, including phone text payloads, are encrypted at rest using the existing key-vault master. Preserve `/data/key-vault.key` (or the deployment's existing `CHURP_KEY_VAULT_SECRET`) along with SQLite and encrypted uploads. No login cookie or session token is stored in a scheduled send.

At delivery, Churp checks the scheduling device's approval, the sender's current access, posting permissions, recipient membership and keys, blocking and youth/parent approvals through the existing message services. A changed encryption roster or key holds the affected send as **Needs review**. Edit or reschedule it from an approved device to encrypt it for the current audience. A private batch keeps the selected recipients rather than silently adding new Tree or Nest members.

Phone texts retain the current SMS mode and existing consent, age, suppression, Tree/Nest, spending and delivery checks. A mock schedule never becomes a live text automatically when deployment settings change. Churp generates a fresh Tree invitation at dispatch so a long-future text does not contain the original expired invitation. **Queued for phone delivery** means accepted into the existing SMS queue; check **Messages → Phone texts → Recent text batches** for delivery results. Scheduling does not enable live Twilio sending or change registration requirements.

## Running on Railway

The existing Node service processes due sends; no separate cron service or browser session is required. Keep **one replica**, the persistent Volume mounted at `/data`, and the original vault key. Per-message receipts are saved in the same transaction as message creation, so restarting does not post a completed message twice. Pending work resumes after restart.

For on-time sends, the service must stay running. In **Railway → Churp's app service → Settings**, disable the option named **Serverless** or **App Sleeping** if it is enabled. A sleeping service does not wake itself just because a scheduled time arrives. This account-level setting cannot be verified or changed from the repository. While the service is stopped, sleeping or redeploying, sends remain pending and run after it resumes; exact delivery time during downtime is not guaranteed.

## Verification

`tests/scheduling.test.js` covers encrypted files, self-managed keys, no early recipient access, restart recovery, duplicate prevention, owner isolation, versioned edits, cancellation, membership/device/block holds, structured posts and mock SMS with fresh invitations. Browser checks in `e2e/scheduling.spec.js` cover desktop and phone layouts, all creation controls and draft management, and retrying a scheduling request after the response is lost. Mock tests do not contact Twilio. Browser emulation does not replace checking the date/time picker on a physical iPhone.
