# Account deletion

Open **Your corner → Account settings → Delete account**. Review the retained history, choose an existing member for each owned Tree with other members, enter the current password, and type `DELETE`. Google-only accounts instead complete a fresh confirmation with their linked Google account. Closing the screen never deletes anything.

The action is also available before family setup or encryption recovery. Public instructions at `/delete-account` link to `/?delete_account=1`; sign-in returns to deletion directly. People unable to sign in can request help at **churptree@gmail.com**, subject **Churp account deletion request**, with their username. Verify ownership before acting; never request passwords, recovery keys or message contents. The public URL can be supplied as the Google Play account-deletion request URL.

## Removal and retained history

Deletion invalidates every sign-in session and device, removes passwords, Google associations, email addresses, birth date, profile image, personal contacts/Birdhouses, future schedules, phone drafts and legacy SMS jobs, notifications, pet unlocks, private key backups and managed wrapped keys. It removes unshared uploaded files and adult Notes to self. Physical file deletion is queued in the same database transaction and retried every minute and at startup. Files referenced by existing messages or shared Tree/Branch/Nest images stay available to authorized readers.

Sent messages and shared attachments remain. A pseudonymous account row keeps existing relational IDs stable; public signing keys and public key history remain for signature verification. It is named **Unknown**, with the system-only `deleted-crow` portrait. The generated image is in `public/brand/avatars/churp-unknown-crow.png`, outside the selectable avatars/pets. Old messages can themselves contain identifying information; this does not rewrite their signed ciphertext or recall downloaded copies. Registering the former username creates a new account with no inherited history or membership.

The chosen new Tree owner is checked again atomically at deletion. A sole-member Tree is archived, its invitations revoked, and its history retained. Deleted accounts cannot be messaged again; existing private conversations remain readable. Existing members retain their Nest access and message history.

A deleted youth's active linked parents retain existing supervised private history, attachments and supervised Notes to self until the existing 18th-birthday or family-link cutoff. The exact birth date is removed; a limited supervision end timestamp remains. Deleting a parent removes that parent's access and copies. A child without another active parent must complete setup again. Deletion never gives parents Nest access.

Backups are not rewritten by deletion. Old backups may retain earlier records and keys until normal backup replacement/retention. Apply the same retention policy to manual snapshots, and reapply subsequent deletion requests after a restore. Daily encrypted R2 backups and retention are available after setup; restores remain blocked until later deletions and permissions are reconciled. See [BACKUPS.md](BACKUPS.md). Historical snapshots are not rewritten by individual deletion requests.

## Verification and implementation

`GET /api/me/deletion` lists owned Trees and current confirmation requirements. `DELETE /api/me/deletion` validates confirmation, current password or a session-bound single-use Google proof, and ownership transfers. Google challenge and verification endpoints are `/api/me/deletion/challenge` and `/api/me/deletion/verify-google`; nonces expire after five minutes and the matching Google subject is required. State is rechecked after asynchronous verification and password hashing. Existing origin/session checks and deletion rate limits apply.

The deletion transaction removes all future work before revoking credentials. Sign-in, provisioning and encrypted uploads reject deleted accounts; request-scoped transaction checks prevent already-started authenticated writes from recreating private account state. Live streams close and ignore subsequent writes. Client-local encryption keys and the current push subscription are cleared after successful deletion. Offline devices may retain downloaded content until their local data is cleared.

`tests/account-deletion.test.js` covers password/Google confirmation, ownership validation, shared ciphertext/attachment readability, key and file removal, session revocation, youth retention and its cutoff, parent deletion, in-flight verification and restart safety for pending first messages. `e2e/account-deletion.spec.js` exercises the real settings/deletion flow, retained crow history, Google-only confirmation and deletion during parent setup on desktop and phone viewports.
