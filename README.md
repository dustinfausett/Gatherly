# Gatherly

A responsive messaging app built around **Community → Subcommunity → Group**. Conversations only happen in Groups. Uses React, Vite, Express, and SQLite with persistent local file storage. No demo accounts or sample conversations are inserted.

## Run locally

Requires **Node.js 24 or newer** and npm.

```sh
cd /workspace/Gatherly
npm ci --cache /workspace/.npm-cache
npm run dev
```

The app listens on port **3000**. Register a username and password, create a Community, create a Subcommunity, then add a Group. Use an admin invitation link to invite another account. Sessions last 30 days, and reopening the app restores the selected Community. A new account starts without a Community.

For a production build:

```sh
npm run build
NODE_ENV=production APP_URL=https://your-domain.example npm start
```

For Railway, follow [the Railway deployment guide](docs/RAILWAY.md). The included Dockerfile and `railway.json` configure the build, production server, health check, and single-replica deployment. A Volume mounted at `/data` is required.

Production requires HTTPS, including when a reverse proxy terminates TLS, because session cookies use `Secure`. Proxy port 3000 to the application and disable response buffering for `/api/events` so live updates arrive immediately. Keep a persistent, writable `DATA_DIR`; the default is `.data`. This app uses one Node process with SQLite and in-process event streams. Multiple replicas require a shared persistence and event architecture.

## Features and permissions

- Username/password accounts with scrypt password hashing and HttpOnly cookie sessions. Optional Google Sign-in with server-verified ID tokens.
- Create Communities or join through admin invitation links. Links last 7 days. Group invitations require existing Community membership and never grant admin rights. Invitations stop working if their creator loses the relevant admin role.
- Community owner can appoint Community admins and transfer ownership to another member. The former owner becomes a Community admin.
- Community admins can create Subcommunities and assign Subcommunity admins. Subcommunity admins can create Groups and appoint admins for Groups beneath them. Rights inherit down the hierarchy; Group admins only manage their assigned Groups.
- Community admins can remove members and revoke all their Group memberships and scoped admin roles. Only the owner can remove another Community admin. The owner cannot be removed.
- Public Groups are visible and readable by Community members. Joining is required for posting and notifications. Private Groups are hidden except from invited members and applicable admins.
- Admins can change names, descriptions, and pictures at every level. Users can update their own display name and picture.
- A single Group posting setting allows either all joined members or only applicable admins to post **and reply**.
- Live messages, one-level threads, text, emoji, image/file attachments, deletion by the author or applicable admins, unread counts, in-app notifications, and Group muting.
- Uploads are limited to 15 MB each and five per message. Only recognized PNG, JPEG, GIF, and WebP files render inline; other file types download. Files require authenticated access. Attachments in private Groups require Group access.
- Message history loads 100 messages at a time. Search filters loaded messages; use “Load earlier messages” to search older history. Threads show up to 500 messages.
- Device push through Web Push, with per-browser opt-in. Muted Groups generate neither in-app nor device notifications. Push payloads omit private message contents. In-app notifications do not require push setup.

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

## Checks

```sh
npm run check       # Production build + real HTTP API integration tests
npm run test:e2e    # Desktop + mobile browser workflows with two real accounts
```

The browser tests use the existing `/usr/bin/chromium` if available. Otherwise install Playwright Chromium with `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. The browser tests run a dedicated server on port 3100 and use a temporary database that is removed afterward. API tests use temporary storage and exercise registration, sessions, private Group access, admin scope, invitations, threads, file authorization, muting, read state, live events, ownership transfer, member removal, and persistence after restart.

`GET /api/health` checks that the server can query SQLite. Browser tests also verify functional flows; health alone is not an application smoke test.

## Deployment scope

This is a self-hosted first version. Hosting and HTTPS must be configured for public access. A Google OAuth client is required only for Google Sign-in. It does not include password recovery, email delivery, end-to-end encryption, malware scanning, or backup automation. Invitation links are reusable for 7 days; removing someone revokes membership but is not a permanent ban if they obtain a still-valid invitation. Device push and real Google authorization need testing with your configured domain and provider accounts.
