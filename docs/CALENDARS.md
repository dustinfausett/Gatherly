# Churp calendars

Every Nest has a calendar. Joined members with posting permission can create events; announcement Nests require admin posting permission. The creator or a Nest admin with posting permission can edit or delete an event. Branch and Tree calendars aggregate the same event records, so edits and deletions appear in every view without duplicate copies.

Public events are available to every current member of the Tree, including events published from a private Nest. Private events are available only to current members of the event’s Nest. An admin who has not joined that Nest does not receive its private events. These rules apply to the API and subscription feeds. A private event can appear in an authorized member’s Branch or Tree view without widening its audience.

The Tree view saves each user’s Branch and Nest selections in SQLite. Selected Branches and Nests are combined: selecting a Branch shows events in all its Nests; selecting a Nest adds that Nest. Unchecking a Nest does not hide it while its Branch remains selected. These display settings are independent of subscriptions. Branch colors are assigned once and persisted, with distinct hues; event cards also name their Nest so color is not the sole identifier.

## Read-only subscriptions

Open a calendar and expand **Subscribe with Google or Apple Calendar**. Choose a Tree, Branch, or Nest and create its subscription URL. Repeat for each calendar you want. Paste a URL into Google Calendar’s **Other calendars → + → From URL**, or Apple Calendar’s **New Calendar Subscription**. The Apple button opens the `webcal:` URL. No Google or Apple OAuth permission is needed. Providers choose their own refresh schedule; this is one-way subscription, not editing or two-way synchronization.

Each subscription uses a random 256-bit bearer token. SQLite stores only the token’s SHA-256 digest. The URL is shown when created; create a replacement if lost. Revoke a subscription to invalidate its URL. Treat URLs as private: anyone holding a URL can read the events currently available through it. External calendar providers retain downloaded content according to their own policies, so revocation or membership removal cannot erase already downloaded copies.

Each feed request checks the subscriber’s account, family readiness, current Tree membership, selected scope, and current Nest membership. Private event access disappears after leaving a Nest. Tree removal or account deletion prevents feed access. Feeds are served over HTTPS in production with `Cache-Control: no-store`. Event identifiers stay stable across edits, and ICS text escaping and UTF-8 line folding follow RFC 5545.

## Encryption and operations

Calendar event titles, descriptions, locations, and dates are AES-256-GCM encrypted at rest using the existing Churp managed key vault, with a separate `calendar` namespace and event ID as authenticated context. Nest IDs, creator IDs, visibility and modification timestamps remain queryable metadata. Churp decrypts authorized events to serve the app and read-only ICS feeds. HTTPS protects calendar data in transit. Calendar subscriptions necessarily deliver readable event data to the receiving calendar provider.

Calendar code does not change chat encryption, identity settings, or chat key handling. The existing vault master (`CHURP_KEY_VAULT_SECRET` or persistent `key-vault.key`) must be preserved with the database. Existing encrypted backups already capture the SQLite database and vault master, including calendar tables. Tables are created idempotently at application startup; there is no separate deployment migration command.

The shared-library flicker fix removes the generic unconditional refresh for Nest membership updates: that route already sends refreshes when a read position or preference actually changes. Shared-library loading is shown for the initial scope load; background refreshes preserve the loaded layout.
