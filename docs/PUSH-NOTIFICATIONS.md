# Notification previews and the 30-second cooldown

New and existing accounts default to **Show message previews**. The sender's name and first 120 Unicode code points of the message appear in the notification, with the Nest name where applicable. Polls, RSVPs and assignments use their title; attachments without text show a short attachment label. External phone texts use the saved contact's name and incoming message beginning.

**Your corner → Security → Show message previews** controls future alerts on every device. Turning it off keeps generic titles and bodies, without sender names or message text. Device permission, device opt-out and per-Nest mute settings remain separate. The OS's own notification/lock-screen settings still apply.

## Encryption and authorization

For Churp messages, the sending device makes a small signed OpenPGP preview for each recipient, separately encrypted to that account's public key. A hash of the preview packets is included in the existing signed message send request. The server validates the signature and exact preview audiences before accepting the message. It forwards only the recipient's encrypted packet and public signer metadata; no private keys or plaintext Churp message snippets are sent to the push provider.

The same-origin service worker loads the receiving device's existing wrapped identity from IndexedDB, including archived keys where necessary. It fetches the latest account preference, approved-device status and original-message access before showing a preview. It checks sender fingerprints, signatures, recipient, channel and client message ID. Changed/untrusted identities, missing keys, expired sessions, revoked access, edited originals, network failures, old senders without preview packets or oversized preview budgets fall back to a generic notification. Groups over 500 members use the generic fallback to preserve the existing message request budget. A single push payload also falls back to generic if it exceeds a conservative 3,500-byte budget.

Self-managed accounts use only their device-held keys for this process. Churp does not obtain or restore those private keys. SMS remains an external, non-E2EE channel; its preview is subject to the same account privacy check.

`npm run build` bundles `src/push-preview-worker.js` into the ignored generated file `public/push-preview.js`, then Vite copies it with `sw.js` into the production build. Development startup builds the helper too; restart the development server after changing worker helper code. Both worker files use no-store production responses, and registrations request updates without the HTTP cache. No new Railway variables are needed; existing VAPID configuration is reused.

## Cooldown and unread badges

The first eligible alert sends immediately. A durable account-wide SQLite window prevents another provider dispatch for 30 seconds, across all subscribed devices and all chat types. Messages arriving during the window replace one pending alert with the latest message; that alert becomes eligible at the end of the window and includes the current unread badge total. There is no separate push for every message in the burst.

Pending alerts are encrypted at rest with the existing persistent key vault and survive restarts. Before delivery, Churp rechecks message existence, current membership/history, mute/read status, blocking and youth approval. Pending alerts for messages already read or no longer accessible are dropped. Current privacy settings are reapplied when the alert actually sends. Definitively rejected sends do not consume a window; uncertain network/provider failures retain it to avoid rapid duplicates. Expired subscriptions are removed.

The phone worker also stores its last alert time in IndexedDB. Delayed or repeated deliveries within that device's window replace the same notification-tray item with `silent: true` and `renotify: false`, while refreshing the badge. Every delivered push still calls `showNotification`, as iOS requires visible push handling. Foreground unread counts and chat delivery remain immediate; closed-app badge updates arrive with the first and coalesced alerts. System delivery timing and presentation remain browser/OS controlled.

## Verification

`tests/push-notifications.test.js` covers preview formatting, self-managed recipient encryption without server keys, authenticated privacy preferences, exact preview audiences and signatures, persistent cross-channel coalescing, badge totals, read/mute suppression, failed subscriptions and simultaneous sends. Existing worker badge tests still run. `e2e/push-previews.spec.js` delivers a real Chromium service-worker push through CDP, decrypts it using the receiver's wrapped IndexedDB identity, changes the Security setting, and checks generic/quiet replacement and persistence on desktop and iPhone-sized layouts. Existing notification permission, private messaging and scheduling workflows verify compatibility. Actual iPhone Safari and system notification presentation should also be checked on a device.
