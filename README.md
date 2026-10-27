# Churp

A warm, responsive messaging app organized as **Tree → optional Branch → Nest**. A Tree is the whole workspace, a Branch organizes Nests and delegates admin rights, and a Nest is where group conversations happen. Personal 1:1 conversations live in Messages. **My Orchard** labels the Tree chooser; it is not another tier.

The Churp wordmark and birds-and-nest mark appear on sign-in, navigation, browser icons, and Home Screen icons. Self-hosted Nunito and Nunito Sans fonts pair with leafy greens, cream backgrounds, and soft brown Nest rows. Read Nest rows are brown; unread rows remain yellow with a yellow egg, and urgent unread rows remain red with a red egg. Received messages use blue bubbles; your own use gold bubbles. Urgent messages keep their bubble color and have an urgent label and outline.

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

The public website is available at `/website/` for review. The same service serves it at `churptree.com` and serves messaging at `app.churptree.com`, while preserving the existing Railway app origin. See [website hosting and GoDaddy DNS instructions](docs/WEBSITE.md). Payments remain coming soon; support is available at churptree@gmail.com.

Production requires HTTPS because cookies use `Secure`. A reverse proxy must forward the app port and disable buffering on `/api/events` for live updates. `TRUST_PROXY` is a proxy hop count; the Railway image uses `1`.

## Personal navigation and messaging

The footer has exactly **Tree / Messages / Contacts**. Tree preserves the existing optional Branches and Nests. Messages contains encrypted private 1:1 chats and in-app Send Individually. Contacts contains owner-only Birdhouses followed by alphabetical contacts, with manual entry and selected CSV/vCard/phone-picker imports. [Delivered behavior, privacy, demo setup and deferred SMS work](docs/PERSONAL-MESSAGING.md).

## Accounts, permissions, and conversations

**Invite your people** provides a QR code, short code and full link. **About this Nest → Invite Tree members** sends an in-app invitation to selected members. The bird-envelope **Invitations** inbox shows pending Nests with Accept/Decline and accepts shared links or codes. All invitations expire after seven days. Admin-created Tree links join immediately; member-created Tree links await a Tree or Branch admin’s approval. Nest invitations remain admin-only. See [invitation behavior and access controls](docs/INVITATIONS.md).

Change your password in your profile. Optional verified recovery email enables **Forgot password?** links; Google-only accounts use Google recovery. Email delivery requires `RESEND_API_KEY`, `CHURP_EMAIL_FROM` and the correct app origin. See [account recovery and setup](docs/ACCOUNT-RECOVERY.md). The sidebar keeps Tree navigation and invitation actions; Nest search and discovery live on Tree home.

Nest chats include **+ → Poll**: a single- or multi-question choice poll delivered as a ballot, with eggs marking basket selections. Polls and responses use the existing encrypted messaging system. See [poll behavior and implementation](docs/POLLS.md).

**+ → RSVP** sends an event invitation in an envelope. Members choose a hatching Going, Maybe, or Can’t go egg, with additional guests for Going/Maybe. Totals stay separate; the creator and Nest admins have named response lists in the app. Invitations can be edited, closed or canceled and have optional deadlines. See [RSVP behavior and implementation](docs/RSVPS.md).

**+ → Assignments** shares a checklist with optional member additions, one responsible person per item, claiming and completion. Creators/admins manage the list and can toggle member additions later. Find it again through the header Nest → Assignments. See [assignment behavior and permissions](docs/ASSIGNMENTS.md).

Use **Edit** beneath your own message to correct its text, including replies and attachment captions. Save changes or cancel; an edited label appears beside the original timestamp. Attachments, sender, message position, replies, and urgency remain intact. Posting permissions apply, and admins cannot rewrite another person's text. Poll definitions and ballots use their own controls. Edits are encrypted to currently eligible original recipients, excluding people who joined later or left and rejoined; they do not create new unread messages or notifications. Concurrent edits are rejected rather than silently overwritten. Only the latest text is shown; there is no revision-history UI.

Tap the bird's Nest in the chat header for **Pictures**, **Documents**, **Polls**, **RSVPs**, and **Assignments**, plus videos, audio and other files when present. Each category lists accessible shared items from newest to oldest, including earlier chat history. The library follows the same membership/history restrictions as chat and decrypts content on the device. It skips deleted items and poll/RSVP responses and assignment update records. Images load as their thumbnails come into view; decrypted file URLs are reused while the library is open and revoked when it closes. Document downloads preserve their original names. Opening a poll, RSVP or assignment list from the library returns to its category when closed.

- Username/password authentication uses salted scrypt hashes and HttpOnly cookie sessions. Optional Google Sign-in verifies ID tokens on the server.
- Trees can be created or joined through invitations. The owner appoints Tree admins and can transfer ownership, remaining an admin afterward. Tree admins assign Branch admins. Rights inherit down to Nests; Nest admins manage only their assigned Nests. All Tree members can propose new Branches and Nests; the Tree’s creation settings determine whether approval is needed.
- Tree admins can remove members and revoke all Nest memberships and scoped admin roles. Only the owner can remove another Tree admin; the owner cannot be removed.
- Public Nests can be discovered by Tree members. Joining is required to read future messages, post, or receive notifications; earlier messages are not shared with later joins. Private Nests are hidden except from invited members and applicable admins. A single setting permits all joined members or only applicable admins to post and reply.
- Tree, Branch, and Nest admins can edit the names, descriptions, and pictures within their scope. Members can edit their display name and profile picture.
- Invitations last seven days, grant membership only, and are revoked if their creator loses the relevant admin rights. Nest invitations require existing Tree membership. Links are reusable; member removal is not a permanent ban if another valid link is obtained.
- Nest conversations support live messages, one-level threads, emoji, photos/files, author/admin deletion, unread indicators and device push. Message history loads 100 messages at a time; search filters loaded messages. Threads show up to 500 messages.
- Uploads are limited to 15 MB each and five per message. Only recognized PNG, JPEG, GIF, and WebP files render inline. Other files download. Authentication and Nest access protect attachments.

## Encrypted messaging

Churp automatically manages encryption keys for new accounts, so ordinary sign-in restores access on new devices without extra setup. Messages and files remain encrypted in storage, but this default is not E2EE because Churp can recover a managed participant's key.

Open **Profile → Security → Message privacy → Use self-managed keys** to opt in. Save a personal recovery key, then confirm. The switch creates a fresh device-held identity, removes its old active managed-vault entry, and preserves historical access through an encrypted key archive. Existing self-managed accounts keep their privacy and recovery requirements. Self-managed users can explicitly switch back to Churp-managed keys, entrusting their current and historical message access to Churp. Returning to self-managed generates a fresh identity and recovery code each time.

A Nest automatically shows a shield when every joined member uses self-managed keys, including muted members. The shield describes new messages; individual messages retain their protection at send time. There is no Nest encryption toggle. A managed member joining removes the shield until everyone remaining qualifies.

Earlier plaintext history converts separately. Old backups can still contain plaintext or former managed keys. This version uses long-term keys without forward secrecy and has not received an independent security audit. Read [the encryption guide](docs/ENCRYPTION.md) for recovery, identity verification, vault persistence, migration, and limits.

## Tree home

A compact Tree banner sits above three sections: Pinned Nests, joined Branches/Nests, and Explore. Nest rows show the name and profile image. Branch rows have a leafy background, a green accent, a tree icon, and a Branch label; Nest badges use the approved woven nest icon. Private Nests show a leading lock. Branches expand in place, with Nests slightly indented below them. Expansion remains while opening and returning from chats. Pinned Nests stay in the top section. Descriptions, counts, and member details are available under **Menu → Tree details**.

Pins have a personal order saved across devices. Use Nest Options to pin/unpin or move a pin up/down. Other joined Branches and Nests sort unread first, then alphabetically within unread/read lists. Branch indicators summarize unread and urgent messages in joined child Nests. Swipe right to mark unread; swipe left to reveal Options. The bell on each Nest row toggles muting without opening the chat; the global notification bell has been removed. Opening a Nest or selecting Mark as read clears its unread reminder. Yellow unread eggs and red urgent eggs sit at the bottom-left of each avatar. Eggs appear with a short 460 ms pop when an already visible row becomes unread or its status escalates to urgent. Existing unread status stays still on initial load or navigation, unchanged updates do not repeat the animation, and reduced-motion preferences keep eggs static.

Branches can be joined independently. Joining a Nest adds its parent Branch to your list. Joining a Branch does not join any Nests or grant extra access. Leaving a Branch retains Nest memberships, pins, and notification settings. Existing Branch memberships are seeded once from Nest membership and Branch admin roles.

Anyone allowed to post can send urgent messages and replies. Authors and applicable admins with posting rights can change urgency. Unread urgent messages turn the Nest row red until read. Muting suppresses device alerts even for urgent messages; unread indicators still update.

The Tree banner places your selected bird and branch immediately after the Tree name, keeping them together on smaller screens and when the name changes. Tapping a Nest highlights its row for 220 ms, then opens the chat with a 1.4-second slide and a 2.4-second flight. Every bird has flight and landing poses; the chat header uses the same companion. Reduced-motion preferences skip the flight and slide.

## Profile avatars and pets

Tap the pet beside the Tree name to feed it: all 12 pets have a smooth eating animation with generated Churp food artwork, matching bites and a happy finish. Keyboard access and reduced motion are supported. See [pet feeding and artwork](docs/PET-FEEDING.md).

Click your name to open a compact settings menu: **Profile & avatar**, **My pet**, **Account settings**, **Security**, and **Notifications**. Each option opens its own screen with a back button. **Profile & avatar** offers 20 free Churp bird portraits or an uploaded image; changing a portrait or pet never changes the other. Message and member avatars use the selected portrait/photo. [View the portrait collection](public/brand/avatars/README.md).

Under **My pet**, choose a companion for the Tree banner and Nest flight. Bluebird and Goldfinch are included; Pink Blossom, Lavender, Mint, Coral, Parrot, Cockatiel, Owl, Robin, Cardinal and Hummingbird start locked. Redeem **Churp** under **Grow your pet collection** to unlock the other ten for that account. `BIRD_UNLOCK_CODE` optionally overrides this server-side code. Purchases remain coming soon. Unlocks and selections persist across sign-ins and devices, with server-side entitlement checks. Existing photos and pet selections are preserved; legacy bird profile pictures become matching independent portraits. New accounts start with a Bluebird portrait and Bluebird pet.

Purchases are marked **Coming soon**. No payment is collected, and no payment provider is connected. The entitlement records retain their unlock source so verified purchases can be integrated later.

## Deleting Trees, Branches and Nests

Applicable admins can open **Branch settings** or **Nest settings** and select **Delete**. There are also delete shortcuts in expanded Branch actions and Nest Options. Confirmation requires typing the current name exactly. Ordinary members cannot delete spaces, and admin powers stay limited to their assigned scope.

Only the current Tree owner can select **Tree settings → Delete Tree**, or **Tree details → Delete Tree**. Deleting a Tree permanently removes all its Branches, Nests, conversations, memberships, invitations, scoped admin rights, notification records and creation requests. Members currently viewing it return to another available Tree or the welcome screen. Accounts, bird unlocks and other Trees remain intact. This cannot be undone.

Deleting a Branch removes the container and its Branch admin assignments, while keeping all its Nests at Tree level. Nest messages, explicit Nest admins, memberships, privacy, pins, and mute preferences stay intact. Pending Nest requests in that Branch are cancelled, and request history retains the deleted Branch name. Inherited Branch admin access ends when the Branch is removed.

Deleting a Nest removes its messages, replies, attachment-sharing links, invitations, notifications, scoped admin assignments, memberships and personal preferences. Other Nests are preserved, with remaining pins keeping their order. The conversation is removed for everyone, including users who currently have it open. Uploads remain independent of message-sharing links: an uploader’s own files and files reused as profile pictures are not physically erased by this operation. Approved creation requests indicate when their resulting space has been deleted.

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

Device alerts prefer on by default. Already-approved browsers reconnect automatically; new devices get an **Enable notifications** prompt that requires a browser permission tap. Manage this under **your profile → Notifications**; an explicit opt-out is saved for this account/browser. Use an HTTPS production origin. Railway generates persistent keys when its domain and data Volume are available. Keep `/data/push-keys.json` or your deployment's existing key pair across releases.

- **Home Screen badges:** supported installed apps show unread messages from unmuted Nests, private chats and phone texts. iPhone supports this on iOS 16.4+ with notification permission and the system Badges setting enabled. Counts refresh on new-message pushes, app activity and reading messages; Android presentation varies by launcher. No App Store release is required. See [Home Screen setup](docs/HOME_SCREEN.md).
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
| `CHURP_KEY_VAULT_SECRET` | Optional managed-key master: 64 hex characters; otherwise preserve `DATA_DIR/key-vault.key` |
| `VAPID_PUBLIC_KEY` | Public push application key |
| `VAPID_PRIVATE_KEY` | Private push signing key |
| `VAPID_SUBJECT` | Public contact email (`mailto:`) or HTTPS URL |

Back up the database and uploads together. For a simple consistent backup, stop the app, copy its entire data directory, and restart. Preserve deployment secrets separately. Managed history requires the original vault master; self-managed history requires the user's recovery key or an approved device. Older snapshots can retain plaintext; review retention as explained in the encryption guide. Password recovery uses optional verified email and configured Resend delivery. Malware scanning and general backup automation are not included.

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
npm run test:e2e:encryption # Real browser cryptography, recovery, and migration
```

The browser tests use `/usr/bin/chromium` when available. Otherwise install Chromium with `npx playwright install chromium` or supply `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Layout regression tests use a legacy plaintext fixture on port 3100; encryption tests enforce encryption on port 3101. Both use temporary storage and remove it afterward. The browser servers use NODE_ENV=test and test-only rate limits; production cannot opt out of encryption and retains normal authentication limits.

Tests cover real accounts, invitations, live messaging, files, scoped administration, private access, pin order, touch swipes, unread/urgent colors, branching in place, image uploads, the Tree chooser, Churp branding, message bubble colors, creation approvals and scope boundaries, all 12 bird selections and flights, protected account unlocks, photo migration, reduced motion, owner-only Tree deletion, scoped deletion and confirmation, retained Branch conversations, live egg indicators, and persistence. Emulation does not prove actual Safari rendering, device keyboards, Home Screen installation, or system push delivery; check those on real phones. `GET /api/health` verifies SQLite access, not the full workflow.

### Youth protection

Signup requires a private date of birth. Accounts under 18 link one or two parents; either can approve adult direct-message contacts and read the child’s direct messages. Existing accounts complete age/parent setup and share earlier direct-message access before continuing. Nests retain their existing permissions. See [docs/YOUTH-PROTECTION.md](docs/YOUTH-PROTECTION.md) for the parent workflow, migration and verification limits.

### Public policies

Terms of Service (`/terms`), Privacy Policy (`/privacy`) and proposed SMS Terms (`/sms-terms`) are readable without signing in. Find them in Your corner → About & policies, at sign-in/signup, and in the website footer. The operator is Dustin Fausett, operating as Churp; the approved support/privacy contact is churptree@gmail.com. SMS remains disabled and its terms explicitly mark the proposed program. See [docs/LEGAL-PAGES.md](docs/LEGAL-PAGES.md).

### External phone texting (mock pilot)

Messages → Phone texts now supports owner-scoped phone conversations, public enrollment links, simulated adult consent, reviewed SMS batches, reply codes, global STOP handling, delivery simulations and durable results. Railway can retain `SMS_MODE=mock` with its existing Twilio variables: mock mode never calls Twilio. The signed webhook handlers and REST adapter are implemented, but real carrier delivery remains unverified and live mode needs additional approved-pilot settings. See [docs/SMS.md](docs/SMS.md) before changing modes or configuring webhooks. Native personal-phone texting and MMS are not included.

See [communication refinements](docs/communication-refinements.md) for short invitation links, Tree/Nest recipient filters, Birdhouse import destinations, mobile navigation and family action alerts.

Contacts now uses **From Tree / From Phone**: bulk-add Tree members without typing names or numbers, or import chosen device/file contacts and add phone contacts manually. See [contact source options](docs/CONTACTS.md), including the iPhone browser fallback.

### Scheduled messages

Use the **clock beside Send**, or **Schedule send** in Poll, RSVP, Assignment and batch builders, to schedule messages and supported attachments. Pending sends appear as faded previews visible only to the sender in their Nest, thread, private chat or phone text conversation, with edit, reschedule and cancel controls. **Your corner → Scheduled messages** keeps the combined list and history. Delivery runs without the sender keeping Churp open, rechecks permissions and encryption recipients, and resumes after restarts. Keep the Railway service running (disable App Sleeping/Serverless sleeping) for on-time sends. See [scheduling and deployment details](docs/SCHEDULING.md).
