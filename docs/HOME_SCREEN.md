# Home Screen icon and unread badges

Churp remains a web app. An App Store or Google Play release is not necessary for supported Home Screen badges.

## iPhone / iPad

1. Use iOS/iPadOS 16.4 or later. Open **https://app.churptree.com/** in Safari.
2. Choose **Share → Add to Home Screen**. Leave **Open as Web App** on if offered.
3. Launch Churp from its Home Screen icon, sign in, and tap **Enable notifications**. The same control is available at **Your corner → Notifications**.
4. In the device's **Settings → Notifications → Churp**, allow notifications and enable **Badges**. Focus and notification settings can affect what appears.

The system draws the familiar red numbered badge. The website cannot choose the badge color or override device notification permissions.

If an existing installation keeps its old icon, close/reopen it first. If necessary, re-add Churp from Safari. Accounts and server-side messages remain, but removing an installed web app may remove local device data. **Self-managed encryption users must save their recovery key or have another approved device before removing an installation.** Churp-managed accounts can restore through ordinary sign-in. Verify the new installation works before removing an old shortcut when possible.

## Android / desktop

Install Churp using the browser's install or Add to Home Screen command. The Badging API is used when exposed by the browser/platform. Some Android launchers show only a dot, or derive the badge from notifications rather than displaying Churp's numeric count. Unsupported devices continue to receive their existing notifications and in-app unread eggs.

## Counting and synchronization

- Counts include unread messages from joined, unmuted Nests across all current Trees; unread private conversations; and incoming phone texts in the currently configured SMS mode.
- A manually marked-unread Nest contributes at least one. Own messages, deleted messages and poll votes/RSVP responses/internal assignment operations do not add to a Nest badge. Earlier Nest history before joining is excluded.
- Blocked or parent-paused private conversations do not contribute. Parent review access never creates a second copy of the child's unread count.
- Opening/focusing Churp and live refreshes update the badge through an authenticated, uncached `/api/badges` request. Reading messages clears the corresponding count. Sign-out, incomplete account protection setup and device notification opt-out clear this device's badge.
- Visible new-message pushes include an unread count. The service worker also fetches the latest authenticated total, falling back to the payload if temporarily offline. No message content or encryption keys are included in badge data. An expired session clears the badge.
- There are no silent badge-only pushes: iOS requires visible push notifications. If messages are read on another device while this installation is closed, its badge may stay until a new push arrives or Churp is opened again. This is not a guaranteed real-time cross-device counter.

The new app icon, Apple touch icon and push notification icon share the same green bird-and-nest artwork, with new filenames to refresh caches and the existing manifest identity preserved.

Tests cover totals, authorization, mute/read/delete/leave behavior, private and SMS unread state, service-worker push/offline/session handling, icon dimensions, feature fallback, browser reads and logout. Browser tests mock the platform Badging API; physical iPhone/Home Screen display still needs verification on a device with push permission.

Phone alerts now show sender/message previews by default. Turn off **Your corner → Security → Show message previews** for generic private alerts. Push alerts are suppressed while Churp is visible on that device. Background and closed devices receive eligible messages without a cooldown. See [push notification privacy and foreground behavior](PUSH-NOTIFICATIONS.md).
