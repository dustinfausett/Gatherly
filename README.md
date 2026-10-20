# Gatherly

A responsive messaging app built around **Community → optional Group → Circle**. Conversations only happen in Circles. Uses React, Vite, Express, and SQLite with persistent local file storage. No demo accounts or sample conversations are inserted.

## Run locally

Requires **Node.js 24 or newer** and npm.

```sh
cd /workspace/Gatherly
npm ci --cache /workspace/.npm-cache
npm run dev
```

The app listens on port **3000**. Register a username and password, create a Community, then add a Circle directly or inside an optional Group. Use an admin invitation link to invite another account. Sessions last 30 days, and reopening the app restores the selected Community. A new account starts without a Community.

For a production build:

```sh
npm run build
NODE_ENV=production APP_URL=https://your-domain.example npm start
```

For Railway, follow [the Railway deployment guide](docs/RAILWAY.md). The included Dockerfile and `railway.json` configure the build, production server, health check, and single-replica deployment. A Volume mounted at `/data` is required.

Production requires HTTPS, including when a reverse proxy terminates TLS, because session cookies use `Secure`. Proxy port 3000 to the application and disable response buffering for `/api/events` so live updates arrive immediately. Keep a persistent, writable `DATA_DIR`; the default is `.data`. This app uses one Node process with SQLite and in-process event streams. Multiple replicas require a shared persistence and event architecture.

## Features and permissions

- Username/password accounts with scrypt password hashing and HttpOnly cookie sessions. Optional Google Sign-in with server-verified ID tokens.
- Create Communities or join through admin invitation links. Links last 7 days. Circle invitations require existing Community membership and never grant admin rights. Invitations stop working if their creator loses the relevant admin role.
- Community owner can appoint Community admins and transfer ownership to another member. The former owner becomes a Community admin.
- Groups are optional collections of Circles. Community admins can create Circles directly in a Community, create Groups, and assign Group admins. Group admins can create Circles and appoint admins for Circles beneath them. Rights inherit down the hierarchy; Circle admins only manage their assigned Circles.
- Community admins can remove members and revoke all their Circle memberships and scoped admin roles. Only the owner can remove another Community admin. The owner cannot be removed.
- Public Circles are visible and readable by Community members. Joining is required for posting and notifications. Private Circles are hidden except from invited members and applicable admins.
- Admins can change names, descriptions, and pictures at every level. Users can update their own display name and picture.
- A single Circle posting setting allows either all joined members or only applicable admins to post **and reply**.
- Community home has a compact banner followed by Pinned Circles, joined Groups/Circles, and public spaces to explore. Group rows open their Circle list. Rows show only the name and editable profile image; read rows are light green, unread rows light yellow with a yellow dot, and urgent unread rows light red with a red dot. Community stats and descriptions live under the navigation menu’s Community details screen.
- Groups can be joined independently of Circles. Joining a Circle adds its parent Group to your list. Joining a Group does not join any Circles or grant extra access; leaving it retains existing Circle memberships, pins, and notifications. Existing Group memberships are seeded once from Circle memberships and Group admin roles.
- Personal Circle pins keep a saved order across devices. Use Circle Options to pin, unpin, or move pins up/down. Other joined Groups and Circles sort unread first, then alphabetically within unread/read lists. Group indicators reflect unread and urgent messages in joined child Circles. Swipe right to mark unread; swipe left to reveal Options. The bell icon toggles muting without opening the chat. Opening a Circle or choosing Mark as read clears its unread reminder.
- Anyone allowed to post can send urgent messages/replies. Authors and applicable admins with posting rights can change urgency. Unread urgent messages highlight the Circle light red, overriding its ordinary unread highlight until read. Muting still suppresses notifications for urgent messages.
- Live messages, one-level threads, text, emoji, image/file attachments, deletion by the author or applicable admins, unread counts, in-app notifications, and Circle muting.
- Uploads are limited to 15 MB each and five per message. Only recognized PNG, JPEG, GIF, and WebP files render inline; other file types download. Files require authenticated access. Attachments in private Circles require Circle access.
- Message history loads 100 messages at a time. Search filters loaded messages; use “Load earlier messages” to search older history. Threads show up to 500 messages.
- Device push through Web Push, with per-browser opt-in. Muted Circles generate neither in-app nor device notifications. Push payloads omit private message contents. In-app notifications do not require push setup.

## Google Sign-in

1. Create an **OAuth 2.0 Web application** client in Google Cloud / Google Auth Platform.
2. Add the development origin and your HTTPS production origin to **Authorized JavaScript origins**. The app uses Google Identity Services and verifies the returned ID token on the server; it does not use a redirect callback or a client secret.
3. Set `GOOGLE_CLIENT_ID` in `.env` or the server environment and restart. Only the public client ID is exposed to the browser.
4. Configure the consent screen and test users as required by Google before publishing the integration.

Until configured, the app clearly marks Google Sign-in as awaiting setup. Username/password sign-in works independently. Google accounts are identified by Google's stable subject ID; they are not automatically linked to existing password accounts.

## Device notifications

Generate a VAPID key pair **once**. The helper writes it directly into ignored `.env`, preserves existing keys, and never prints the private key:

```sh
npm run setup:push -- --subject=mailto:you@example.com
```

Restart the server, open **your profile → Enable device notifications**, and grant browser permission. Use HTTPS on a deployed domain. Desktop localhost is a secure context for development, but push delivery still requires a browser with a functioning push service. On iPhone/iPad, install Gatherly on the Home Screen in a supported Safari version before opting into push.

Keep `VAPID_PRIVATE_KEY` private and retain the key pair across deployments. Set `VAPID_SUBJECT` to your public contact email or HTTPS URL. Do not rotate the pair on each startup. Outbound push delivery must reach the push provider in the subscription endpoint, commonly `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `web.push.apple.com`, or a `*.notify.windows.com` endpoint. Google token verification requires `www.googleapis.com` for Google's public signing keys; browsers also load `accounts.google.com` for Sign-in. No OAuth or push provider setup is needed for local username/password messaging.

## Configuration

Copy `.env.example` to `.env` if needed. Existing process environment values take precedence. Never commit `.env`.

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP listening port, default `3000` |
| `APP_URL` | Canonical application origin, required for production origin checking |
| `DATA_DIR` | Persistent SQLite and upload directory, default `.data` |
| `TRUST_PROXY` | Number of trusted reverse-proxy hops, default `0`; Railway Docker image uses `1` |
| `GOOGLE_CLIENT_ID` | Optional Google Web OAuth client ID |
| `VAPID_PUBLIC_KEY` | Public Web Push application key |
| `VAPID_PRIVATE_KEY` | Private Web Push application key, local process secret |
| `VAPID_SUBJECT` | Public contact email (`mailto:`) or HTTPS URL |

Back up **both** the SQLite database and uploaded files. For a simple consistent backup, stop the app, copy the entire data directory, and restart. Preserve `.env` or the equivalent deployment secret configuration separately. Application data and local configuration are ignored by Git.

## Hierarchy migration

The product hierarchy is **Community → optional Group → Circle**. Chats occur only in Circles. Community admins can move a Circle between Groups or back to Community level using Circle settings. Only the new parent Group's admins inherit rights after a move; existing Circle memberships and explicit Circle admin roles are retained. The settings dialog explains this before saving.

Existing databases migrate automatically in a transaction at startup. Before the hierarchy migration, SQLite writes a consistent database snapshot to `gatherly.sqlite.before-circles.bak` alongside the database; existing snapshots are preserved. Uploaded files are unchanged. Existing Subcommunities become Groups and their Groups become Circles, preserving IDs, conversations, sessions, memberships, invites, and uploads. As with other releases that change storage, retain a consistent backup of the persistent data directory before rollout.

Historical SQLite table names and existing API paths are retained for compatibility: `subcommunities` stores Groups and `groups` stores Circles. `GET /api/communities/:id` includes `circles` for every visible Circle, including those outside Groups; `subcommunities[].groups` remains available for grouped Circles. `POST /api/communities/:id/circles` accepts an optional `subcommunity_id`. Circle membership preferences use the existing `/api/groups/:id/membership` endpoint. `collection_members` stores Group memberships; join/leave uses POST/DELETE `/api/subcommunities/:id/join`.

## Checks

```sh
npm run check       # Production build + real HTTP API integration tests
npm run test:e2e    # Desktop + mobile browser workflows with two real accounts
```

The browser tests use the existing `/usr/bin/chromium` if available. Otherwise install Playwright Chromium with `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. The browser tests run a dedicated server on port 3100 and use a temporary database that is removed afterward. API tests use temporary storage and exercise registration, sessions, private Circle access, admin scope, invitations, threads, file authorization, muting, read state, live events, ownership transfer, member removal, and persistence after restart.

`GET /api/health` checks that the server can query SQLite. Browser tests also verify functional flows; health alone is not an application smoke test.

## Deployment scope

This is a self-hosted first version. Hosting and HTTPS must be configured for public access. A Google OAuth client is required only for Google Sign-in. It does not include password recovery, email delivery, end-to-end encryption, malware scanning, or backup automation. Invitation links are reusable for 7 days; removing someone revokes membership but is not a permanent ban if they obtain a still-valid invitation. Device push and real Google authorization need testing with your configured domain and provider accounts.

## Test on iPhone and Android

Gatherly is an installable web app (PWA). Deploy the latest commit to Railway and use the same HTTPS URL on both phones. There is no app-store account required, and this adds no SMS or app-store fees. Hosting costs still apply. It needs an internet connection; private chats are not cached for offline use.

- **iPhone:** open the site in Safari, tap **Share → Add to Home Screen**, turn on **Open as Web App** if offered, then tap **Add**. Open Gatherly from its new icon and sign in there. Web Push requires iOS 16.4 or newer and the Home Screen app.
- **Android:** open the site in Chrome, tap the three-dot menu, choose **Install app** or **Add to Home screen**, and confirm. Open Gatherly from its icon and sign in.
- **Notifications:** inside the installed app, open your profile and choose **Enable device notifications**. Allow the system prompt. Server Web Push configuration is also required; Railway creates persistent keys when a public domain and data volume are available.

Use separate accounts on two devices. Create a Community, Group, and Circle; accept an invitation on the second phone; join a public Circle; exchange messages, replies, photos, and files. Check private invitations, admin-only posting, muting, permissions, logout/login, and reopening to the selected Community. Test with the keyboard open, rotate the phone, and check the notch and bottom home indicator. For push, background the installed app and send a message from the other account to a joined, unmuted Circle.

`npm run test:e2e` exercises the workflow in desktop Chromium and emulated iPhone and Android sizes. Emulation does not verify actual Safari rendering, Home Screen installation, the device keyboard, or system push delivery; check those on real phones.

App Store and Google Play distribution would be a separate step, using a native wrapper such as Capacitor, store accounts, native push integration, and store review. The Home Screen version lets you test the shared UI and functionality now.
