# Churp encrypted messaging

New Nest messages, replies, and message attachments are encrypted and signed in the browser before upload. Production rejects plaintext message submissions. Public Nests show their details before joining, with no chat preview. Members receive messages sent after their current membership starts; leaving and rejoining starts a new history boundary. Admin powers manage a Nest but do not reveal earlier message contents.

## Using it

1. Sign in normally with a password or Google. On first use, select **Set up encrypted messaging** and save the displayed `CHURP1-…` recovery key privately outside this browser. Confirm that you saved it to continue.
2. All joined Nest members need encryption identities before anyone can send to that Nest. Sending waits for members who have not completed setup; there is no plaintext fallback. Pending older history is converted when an eligible member opens the Nest, once its original readers have keys.
3. On a new browser or replacement phone, sign in and enter the recovery key. Alternatively, request approval and enter the displayed request code on an existing approved device under **Profile → Encrypted messaging → Approve a device**. Enter the finish code from that approved device on the new device. Compare codes directly between your devices, never through support or an untrusted intermediary.
4. Use **Nest information → Encryption** to compare members' identity codes through a separate trusted channel. An unexpected identity change blocks sending/decryption instead of silently replacing a known key.

An approved device can replace the recovery key under its profile. Save and confirm the replacement before activating it. Replacement changes the encrypted recovery backup; it does not rotate the message identity or invalidate a private key already copied to another device.

Explicit sign-out removes that browser's local encryption key. Clearing site data or removing a Home Screen app can also remove keys. Session expiration alone keeps the local key. Passwords, Google authentication, and server backups cannot restore encrypted messages without the recovery key or an approved device. Losing both means losing access to that history. There is no support bypass or encryption-reset button.

## Design and limits

- OpenPGP.js **6.3.2** supplies Ed25519 signing, X25519 recipient encryption, and authenticated content encryption. Each message is signed and encrypted separately for the currently joined members. Attachment contents use a random per-file secret, with its key, original filename, size, and ciphertext hash inside the signed encrypted message. Uploaded filenames are generic. Recipient lists, file ownership, signatures, and a membership roster hash are checked by the API, including a final transaction-time check for membership changes.
- Each account has one long-term message identity. Approved browsers share that private identity through an encrypted device transfer. The random 256-bit recovery secret protects an encrypted private-key backup; the readable private key and recovery secret are not sent to the server. Device transfer uses an ephemeral recipient key and two out-of-band confirmation codes, including a finish secret that is only inside the encrypted grant.
- IndexedDB stores the local private key wrapped with a non-extractable WebCrypto AES-GCM key. This helps with storage handling; it does **not** protect against malicious same-origin JavaScript, XSS, a compromised browser/device, or a modified web app delivered by the hosting service. HTTPS, dependency hygiene, and protecting the hosting account remain necessary.
- This design has **no forward secrecy or post-compromise security**. A stolen long-term account private key can expose captured ciphertext addressed to that account, and future messages until an identity-rotation system is implemented. Devices share the account identity, so this version cannot cryptographically revoke one device independently. Recovery-key replacement is not device revocation.
- Contact identity pinning is trust on first use on each browser. Manual code comparison gives independent identity assurance; a new or recovered browser must compare contacts again. The service still controls account authentication, membership, public-key discovery, and message availability. There is no independently authenticated membership-change log. Review participant lists and compare codes before sensitive conversations.
- Space names, user names, avatars, membership, timestamps, file ciphertext sizes, reply relationships, urgency, and traffic patterns remain server-visible. Profile/Tree/Branch/Nest images are ordinary shared images, not encrypted message attachments. Push alerts contain no message body or attachment secret. Search decrypts and filters messages locally.
- Signed content detects alteration; it does not prevent recipients from taking screenshots, forwarding content, or retaining messages and keys they already received. Removing a member prevents future recipient encryption; it cannot erase prior copies.
- OpenPGP.js has published independent audits. **The Churp integration and application protocol have not received an independent security audit.** Do not describe this release as Signal-equivalent or as independently audited Churp encryption. An independent review is recommended before relying on it for high-risk communications.

## Existing plaintext history

At the first secure server start, Churp records the existing Nest readers once. Later joins and restarts cannot expand that historical reader set. Normal message APIs stop serving the old plaintext. Only an approved eligible browser with a signed conversion request can retrieve old content for conversion.

The browser encrypts each earlier message and its attachments for eligible original readers who still have the same uninterrupted membership. It retains the original message ID, displayed author, time, and thread. A **Converted by** label identifies the converter: migrated content did not originally have an author's cryptographic signature, so conversion cannot establish one retroactively. A converter could alter historical content; treat converted history accordingly.

After conversion, the active database body is cleared and encrypted content replaces it. Original attachment files are deleted after their last message reference is converted. Files deliberately reused as avatars remain ordinary shared images. Cleanup failures are recorded for retry; SQLite checkpoint/VACUUM/checkpoint removes converted text from active database/WAL pages. This is logical cleanup, not a promise of forensic erasure on SSDs or hosted storage. A pending-history banner remains while conversion or cleanup is incomplete.

Readers who have not enrolled can delay conversion. Old history with no eligible remaining reader stays inaccessible and unconverted; do not grant a late joiner the historical keys to work around this. Large histories may require using **Retry history conversion** across more than one batch. New messages still require encryption throughout this process.

**Previously created backups, snapshots, exported files, and downloaded copies retain whatever plaintext they already contained.** This includes Railway Volume backups and the historical `gatherly.sqlite.before-circles.bak` hierarchy snapshot. Churp does not automatically delete operator backups. Review retention and remove obsolete plaintext copies separately after verifying conversion and a safe replacement backup. Preserve pending plaintext history securely until its eligible readers have converted it. E2EE cannot protect past exposure retroactively.

## Validation

`npm run check` exercises production enforcement, exact recipient sets, signatures, changed membership, join/rejoin history boundaries, recovery, device grants, conversion, legacy attachment removal, and active database cleanup. `npm run test:e2e:encryption` exercises real browser cryptography on desktop, iPhone-sized, and Android-sized Chromium, including changed identities, restored history, attachment downloads, and browser conversion. These are browser emulations, not actual Safari/device push tests.

The older layout/administration regression tests explicitly use a legacy plaintext **test fixture**. That option requires `testing: true` and is rejected in production. It is not a deployment flag. There is no production option to silently downgrade encryption.

Production container checks use ciphertext messaging and files, secure cookie/proxy handling, and a fresh temporary Volume. Back up SQLite, uploads, and the encrypted identity backups together. That backup still requires each account's own recovery key to read its messages.

OpenPGP source and license information are in [`public/legal/openpgp/NOTICE.txt`](../public/legal/openpgp/NOTICE.txt).
