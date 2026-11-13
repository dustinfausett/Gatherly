# Churp calendars

Every Nest has a calendar. Joined members with posting permission can create events; announcement Nests require admin posting permission. The creator or a Nest admin with posting permission can edit or delete an event. Branch and Tree calendars aggregate the same event records, so edits and deletions appear in every view without duplicate copies.

Public events are available to every current member of the Tree, including events published from a private Nest. Private events are available only to current members of the event’s Nest. An admin who has not joined that Nest does not receive its private events. These rules apply to the API and subscription feeds. A private event can appear in an authorized member’s Branch or Tree view without widening its audience.

The Tree view saves each user’s Branch and Nest selections in SQLite. Filters show checkbox rows for Branch folders and standalone Nests. Expand a Branch to select its individual Nests. Selecting a Branch includes all its Nests; unchecking one child changes that Branch to a partial selection and excludes the child. These display settings are independent of subscriptions. Branch colors are assigned once and persisted, with distinct hues; event cards also name their Nest so color is not the sole identifier.

## Read-only subscriptions

Open the Tree, Branch, or Nest calendar you want, then click **Subscribe to Calendar**. A separate subscription screen creates the URL for that specific calendar and shows Google and Apple setup instructions. Repeat from each calendar you want to subscribe to. Paste a URL into Google Calendar’s **Other calendars → + → From URL**, or Apple Calendar’s **New Calendar Subscription**. The Apple button opens the `webcal:` URL. No Google or Apple OAuth permission is needed. Providers choose their own refresh schedule; this is one-way subscription, not editing or two-way synchronization.

Each subscription uses a random 256-bit bearer token. SQLite stores only the token’s SHA-256 digest. The URL is shown when created; create a replacement if lost. Revoke a subscription to invalidate its URL. Treat URLs as private: anyone holding a URL can read the events currently available through it. External calendar providers retain downloaded content according to their own policies, so revocation or membership removal cannot erase already downloaded copies.

Each feed request checks the subscriber’s account, family readiness, current Tree membership, selected scope, and current Nest membership. Private event access disappears after leaving a Nest. Tree removal or account deletion prevents feed access. Feeds are served over HTTPS in production with `Cache-Control: no-store`. Event identifiers stay stable across edits, and ICS text escaping and UTF-8 line folding follow RFC 5545.

## Encryption and operations

Calendar event titles, descriptions, locations, and dates are AES-256-GCM encrypted at rest using the existing Churp managed key vault, with a separate `calendar` namespace and event ID as authenticated context. Nest IDs, creator IDs, visibility and modification timestamps remain queryable metadata. Churp decrypts authorized events to serve the app and read-only ICS feeds. HTTPS protects calendar data in transit. Calendar subscriptions necessarily deliver readable event data to the receiving calendar provider.

Calendar code does not change chat encryption, identity settings, or chat key handling. The existing vault master (`CHURP_KEY_VAULT_SECRET` or persistent `key-vault.key`) must be preserved with the database. Existing encrypted backups already capture the SQLite database and vault master, including calendar tables. Tables are created idempotently at application startup; there is no separate deployment migration command.

The shared-library flicker fix removes the generic unconditional refresh for Nest membership updates: that route already sends refreshes when a read position or preference actually changes. Shared-library loading is shown for the initial scope load; background refreshes preserve the loaded layout.

## Compact events and reminders

Calendar activity rows show only the event title and its date/time. Selecting a row opens a separate detail screen containing the Nest, privacy, location, description, management controls and personal reminder controls. Calendar reminder notification links open this detail screen directly on web and native apps. The Nest Back control uses the sign-only artwork.

Under **Your corner → Notifications**, each user can modify or remove the 24-hour default reminder and add up to five reminder times between the start and 30 days before an event. Defaults apply only to joined, unmuted Nests. A user can also request a personal one-time reminder at a future time on or before the event starts. A Tree member can explicitly request one for a public event without joining its Nest; private events still require current Nest membership. Any Nest mute and device notification opt-out remain respected.

The worker checks due reminders every 30 seconds. It rechecks account, family readiness, current Tree/Nest access, event privacy and Nest mute at dispatch. When notification previews are enabled, calendar alerts show the event name and its start date/time. Browser and Home Screen notifications format the time in the device’s local zone; native notifications use the saved event zone with an explicit zone label (UTC for older events without a saved zone). With previews off, alerts stay generic. Descriptions and locations are never included. Tapping an alert opens its event details in Churp. Both browser push and native push use the existing device subscription and foreground-suppression behavior. Default changes and event edits do not trigger reminder times that have already elapsed. After downtime, multiple due times for one event collapse into one alert; reminders more than five minutes past the event start are skipped. Persisted delivery claims prevent duplicate dispatch after restart. A crash between claiming and sending can lose an alert, consistent with at-most-once dispatch; provider delivery is not guaranteed. Personal reminders remain one-time even if the event is later rescheduled. The server must stay running for timely delivery.

Calendar details remain encrypted; personal reminder times and interval preferences are scheduling metadata stored in SQLite. Account deletion removes personal calendar preferences, subscriptions, reminder settings, personal reminders and delivery receipts. Event deletion removes its reminders and receipts automatically.

Scheduled messages are managed only through their previews in the relevant Nest or private conversation (and phone drafts through their existing phone draft screens). The settings entry and global message outbox links have been removed. Held-send notifications direct the sender to the originating conversation.

## Event date and time entry

New events start with one date and separate start/end time fields. The date defaults to the day selected on the calendar, or the device’s current date if no day is selected. The first start-time choice suggests an end one hour later. Later start-time changes leave the end unchanged; entering an end time first also preserves it. Editing an existing event never recalculates its end automatically.

Enable **Multiple days** to choose a separate end date. A first start-time choice near midnight automatically carries the one-hour suggestion into the following day and exposes that end date. An end earlier than the start is rejected without changing either field. Dates and times use the device’s local time zone and are saved as UTC instants.
