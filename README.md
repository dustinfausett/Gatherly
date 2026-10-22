# Churp

A warm, responsive messaging app organized as **Tree → optional Branch → Nest**. A Tree is the whole workspace, a Branch organizes Nests and delegates admin rights, and a Nest is where conversations happen. **My Orchard** labels the Tree chooser; it is not another tier.

The Churp wordmark and birds-and-nest mark appear on sign-in, navigation, browser icons, and Home Screen icons. Self-hosted Nunito and Nunito Sans fonts pair with leafy greens, cream backgrounds, and soft brown Nest rows. Read Nest rows are brown; unread rows remain yellow with a yellow dot, and urgent unread rows remain red with a red dot. Received messages use blue bubbles; your own use gold bubbles. Urgent messages keep their bubble color and have an urgent label and outline.

## Run locally

Requires **Node.js 24 or newer** and npm. The repository and existing checkout remain named Gatherly for compatibility.

```sh
cd /workspace/Gatherly
npm ci --cache /workspace/.npm-cache
npm run dev
```

The server listens on port **3000** by default. Register with a username and password, create a Tree, and add a Nest directly or inside an optional Branch. Invite another account with an admin invitation link. Sessions last 30 days; reopening restores the selected Tree. No demo users or conversations are seeded.

```sh
npm run build
NODE_ENV=production APP_URL=https://your-domain.example npm start
```

For Railway, follow [the deployment guide](docs/RAILWAY.md). The Dockerfile and `railway.json` build the frontend and backend together. Railway requires a persistent Volume mounted at `/data`. Use one replica: this version uses SQLite, local uploads, and in-process event streams. The server binds `0.0.0.0` and respects Railway's injected `PORT`. Set the public domain's target port to the actual listening port in Deploy Logs.

Production requires HTTPS because cookies use `Secure`. A reverse proxy must forward the app port and disable buffering on `/api/events` for live updates. `TRUST_PROXY` is a proxy hop count; the Railway image uses `1`.

## Accounts, permissions, and conversations

- Username/password authentication uses salted scrypt hashes and HttpOnly cookie sessions. Optional Google Sign-in verifies ID tokens on the server.
- Trees can be created or joined through invitations. The owner appoints Tree admins and can transfer ownership, remaining an admin afterward. Tree admins assign Branch admins. Rights inherit down to Nests; Nest admins manage only their assigned Nests. All Tree members can propose new Branches and Nests; the Tree’s creation settings determine whether approval is needed.
- Tree admins can remove members and revoke all Nest memberships and scoped admin roles. Only the owner can remove another Tree admin; the owner cannot be removed.
- Public Nests can be read by Tree members. Joining is required to post or receive notifications. Private Nests are hidden except from invited members and applicable admins. A single setting permits all joined members or only applicable admins to post and reply.
- Tree, Branch, and Nest admins can edit the names, descriptions, and pictures within their scope. Members can edit their display name and profile picture.
- Invitations last seven days, grant membership only, and are revoked if their creator loses the relevant admin rights. Nest invitations require existing Tree membership. Links are reusable; member removal is not a permanent ban if another valid link is obtained.
- Nest conversations support live messages, one-level threads, emoji, photos/files, author/admin deletion, unread indicators and device push. Message history loads 100 messages at a time; search filters loaded messages. Threads show up to 500 messages.
- Uploads are limited to 15 MB each and five per message. Only recognized PNG, JPEG, GIF, and WebP files render inline. Other files download. Authentication and Nest access protect attachments.

## Tree home

A compact Tree banner sits above three sections: Pinned Nests, joined Branches/Nests, and Explore. Nest rows show the name and profile image. Branch rows have a leafy background, a green accent, and a Branch label. Branches expand in place, with Nests slightly indented below them. Expansion remains while opening and returning from chats. Pinned Nests stay in the top section. Descriptions, counts, and member details are available under **Menu → Tree details**.

Pins have a personal order saved across devices. Use Nest Options to pin/unpin or move a pin up/down. Other joined Branches and Nests sort unread first, then alphabetically within unread/read lists. Branch indicators summarize unread and urgent messages in joined child Nests. Swipe right to mark unread; swipe left to reveal Options. The bell on each Nest row toggles muting without opening the chat; the global notification bell has been removed. Opening a Nest or selecting Mark as read clears its unread reminder.

Branches can be joined independently. Joining a Nest adds its parent Branch to your list. Joining a Branch does not join any Nests or grant extra access. Leaving a Branch retains Nest memberships, pins, and notification settings. Existing Branch memberships are seeded once from Nest membership and Branch admin roles.

Anyone allowed to post can send urgent messages and replies. Authors and applicable admins with posting rights can change urgency. Unread urgent messages turn the Nest row red until read. Muting suppresses device alerts even for urgent messages; unread indicators still update.

The Tree banner has a subtle branch illustration and a perched blue bird. Tapping a Nest briefly highlights its row, then slides into the chat while the bird flies to the small nest in the chat header. Reduced-motion preferences skip the flight and slide. The shared `Bird` component accepts a skin palette for future customization; no purchases or premium settings are enabled.

## Member creation and approvals

Under **Tree settings → Member creation**, Tree admins separately choose whether Branches and Nests require approval. Both settings default to on, including for existing Trees. Everyone sees New Branch/New Nest (and Add Nest inside a Branch). Members see **Submit for Approval** when a review is required; applicable admins create directly within their scope. Disabling approval allows immediate member creation and leaves existing requests pending.

Open **Menu → Creation requests** to review requests or follow your own submissions. Tree admins can approve or decline any request; Branch admins can review only Nest requests inside their own Branch. Pending drafts are hidden from everyone else. Approval preserves the submitted name, photo, description, location, and Nest settings, then joins the creator and grants them admin rights over that new space only. Declines create nothing. Removing a member cancels their pending requests. Each member can have up to 20 pending requests per Tree. Identical pending submissions reuse the existing request; a request can be decided only once.

## Google Sign-in

1. Create an **OAuth 2.0 Web application** client in Google Cloud / Google Auth Platform.
2. Add your development and HTTPS production origins to **Authorized JavaScript origins**. Churp uses Google Identity Services with server-side ID-token verification, without a redirect callback or client secret.
3. Set `GOOGLE_CLIENT_ID` in `.env` or the server environment and restart.
4. Configure the consent screen and test users as required by Google.

Username/password works independently while Google setup is pending. Google accounts use Google's stable subject ID and are not automatically linked to existing password accounts. The public client ID is exposed to the browser; private credentials are never required in chat.

## Device notifications and Home Screen installation

Generate a VAPID key pair once; the helper writes it privately to ignored `.env` and preserves existing keys:

```sh
npm run setup:push -- --subject=mailto:you@example.com
```

Restart, then open **your profile → Enable device notifications**. Use an HTTPS production origin. Railway generates persistent keys when its domain and data Volume are available. Keep `/data/push-keys.json` or your deployment's existing key pair across releases.

- **iPhone:** Safari → Share → Add to Home Screen. Turn on Open as Web App if offered. Launch the icon and sign in there. Push requires iOS 16.4 or newer and the installed Home Screen app.
- **Android:** Chrome → three-dot menu → Install app or Add to home screen.
- Existing Home Screen shortcuts may retain their old name/icon. Remove and re-add the shortcut from the same website to show Churp branding; this does not delete server-side accounts or messages.

No store account or SMS service is required. Hosting costs still apply. The app requires an internet connection and deliberately does not cache private conversations for offline use. Native App Store/Google Play distribution remains a separate step.

Outbound push must reach the subscription's provider, commonly `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `web.push.apple.com`, or `*.notify.windows.com`. Google verification needs `www.googleapis.com`; browsers load `accounts.google.com`. Push payloads omit private message contents. Real push delivery and Google authorization need testing with the configured domain and devices.

## Configuration and persistence

Copy `.env.example` to `.env` if needed. Existing process environment values take precedence; never commit `.env`.

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP listening port, default `3000` |
| `APP_URL` | Canonical origin for production origin checks |
| `DATA_DIR` | Persistent SQLite/upload directory, default `.data` |
| `TRUST_PROXY` | Trusted reverse-proxy hop count, default `0` |
| `GOOGLE_CLIENT_ID` | Optional public Google Web client ID |
| `VAPID_PUBLIC_KEY` | Public push application key |
| `VAPID_PRIVATE_KEY` | Private push signing key |
| `VAPID_SUBJECT` | Public contact email (`mailto:`) or HTTPS URL |

Back up the database and uploads together. For a simple consistent backup, stop the app, copy its entire data directory, and restart. Preserve deployment secrets separately. This version does not include password recovery, email delivery, end-to-end encryption, malware scanning, or general backup automation.

The Churp rebrand preserves existing data, session cookies, invitations, push subscriptions, and API identifiers. **Do not rename `gatherly.sqlite`, `gatherly_session`, or existing URLs to apply the branding.** The public name is Churp; internal identifiers remain stable to avoid resetting accounts or sessions.

Legacy hierarchy migrations run automatically. Before the optional-container migration, SQLite retains a consistent `gatherly.sqlite.before-circles.bak` snapshot. IDs, memberships, messages, sessions, files, and scoped rights are preserved. The branding change does not rewrite stored space names or user content.

Historical storage/API mapping:

| Product tier | Stored as / API |
| --- | --- |
| Tree | `communities`, `/api/communities` |
| Branch | `subcommunities`, `/api/subcommunities` |
| Nest | `groups`, `/api/groups` |

`GET /api/communities/:id` includes all visible Nests in `circles`, plus Branch children in `subcommunities[].groups`. Create a Nest at `/api/communities/:id/circles` with an optional `subcommunity_id`. Nest preferences use `/api/groups/:id/membership`. Tree settings include `branch_approval_required` and `nest_approval_required`. Member creation may return HTTP 202 with `request` instead of an immediately created space. List authorized requests at `GET /api/communities/:id/creation-requests` and review via `POST /api/creation-requests/:id/review` with `decision: "approve"` or `"reject"`. Branch memberships use `collection_members` and POST/DELETE `/api/subcommunities/:id/join`. Tree admins can move Nests between Branches or to Tree level; existing Nest membership and explicit Nest admin roles persist, while inherited Branch admin rights follow the new parent.

## Checks

```sh
npm run check      # Production build and real HTTP server tests
npm run test:e2e   # Desktop, iPhone-size, and Android-size browser workflows
```

The browser tests use `/usr/bin/chromium` when available. Otherwise install Chromium with `npx playwright install chromium` or supply `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Tests run a separate server on port 3100, use temporary storage, and remove it afterward.

Tests cover real accounts, invitations, live messaging, files, scoped administration, private access, pin order, touch swipes, unread/urgent colors, branching in place, image uploads, the Tree chooser, Churp branding, message bubble colors, creation approvals and scope boundaries, bird navigation, reduced motion, and persistence. Emulation does not prove actual Safari rendering, device keyboards, Home Screen installation, or system push delivery; check those on real phones. `GET /api/health` verifies SQLite access, not the full workflow.
