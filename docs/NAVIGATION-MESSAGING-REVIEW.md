# Navigation, private messaging and Send Individually: repository review

Status: archived pre-build review. The owner selected the first web-app phase, optional Branches and an approval requirement for non-admin invitation links. Delivered behavior and deferred SMS/native work are documented in PERSONAL-MESSAGING.md. The open recommendations below record the earlier review, not the final implementation status.

## Existing foundations to reuse

| Specification area | Existing implementation | Work needed |
| --- | --- | --- |
| Accounts and account settings | Username/password, optional Google sign-in, sessions, verified recovery email, profile settings | Reuse; phone verification/discovery is not implemented |
| Tree / Branch / Nest | Real multi-Tree membership, optional Branches, inline expansion, scoped/inherited admin rights, public/private Nests, history boundaries | Add navigation and an authorized Send Individually entry point, not a second hierarchy |
| Group conversations | Encrypted Nest messages/files, replies, edits, mute/unread/urgent state, live events and push | Preserve all current features under Tree |
| Invitations | Seven-day Tree/Nest links, short codes, QR codes, addressed Nest invitations and inbox | Extend this service for permitted SMS invitation footers; do not create a competing invitation system |
| Brand | Approved logo, tree/branch/nest artwork, 12 pets, 20 avatars, activity illustrations, Nunito fonts and existing colors | Reuse; generate only missing talking-birds and birdhouse assets, add to GitHub, and use those assets in the app |
| Message encryption | Device identities, managed vault, optional self-managed keys, recovery/transfer, cryptographic primitives | Reuse the identities and primitives; add a separate private-message authorization/envelope scope |
| Deployment | React/Vite web app, Express/SQLite backend, Railway, installable Home Screen app | Reuse; native iOS/Android projects and native contact/SMS bridges are not present |

Source reference points: `src/App.jsx`, `src/CommunityHome.jsx`, `src/Chat.jsx`, `src/ProfileSettings.jsx`, `src/SpaceIcon.jsx`, `src/Invitations.jsx`, `src/encryption/`, `server/app.js`, `server/database.js`, `server/invitations.js`, `server/encryption.js`, `server/key-vault.js`, and `shared/encryption.js`.

## New work, without duplicating Nest features

1. A responsive bottom navigation with exactly Tree / Messages / Contacts. Normal launch selects Tree while existing Nest/notification/invitation deep links keep their intended destination. Account settings and Invitations remain accessible without becoming bottom tabs.
2. Personal Contacts and Birdhouses, independent of the selected Tree. Owner-only APIs, deliberate import/selection, country-aware phone normalization, deduplication, edit/removal, and many-to-many Birdhouse membership. Deleting a Birdhouse retains the contacts. Tree members do not automatically become an uploaded phonebook.
3. Actual private conversations with exactly two participants, private messages/attachments, unread state and blocking/request policy. Use the existing authentication, identities, live-event and push infrastructure. A two-person private conversation must not be represented as a hidden Nest or inherit access from Tree/Branch admins. Existing Nest attachment permissions need an explicit private-message counterpart.
4. One Send Individually workflow with reusable recipient selection, composition, review and per-recipient results. Nest-origin entry checks admin scope on the server. Broadcast records coordinate separate deliveries; they are not group conversations. Recipients cannot enumerate other recipients.
5. Provider adapters, consent, budgets, status callbacks and native integrations in a subsequent stage unless the owner selects the full build now. Development SMS remains disabled/sandboxed and unmistakably labeled.

## Decisions needed before implementation

- **First-build scope:** navigation, contacts/Birdhouses and real private chats first, versus the entire specification with sandboxed SMS.
- **Existing hierarchy:** retain optional Branches and inline expansion, versus require a Branch and replace expansion with drill-down pages. The specification appears to require a Branch, unlike the current app and earlier decisions.
- **Mobile scope:** continue the current web/Home Screen app first, versus create native iOS/Android app projects now. A web app does not provide the native iOS message composer or consistent contact-picker support on every phone. A browser SMS handoff does not reliably report send/cancel/delivery. Manual contact entry and selected-file imports can provide web fallbacks.
- **Free SMS invitation footer:** ordinary members currently cannot create Tree invitations. Options are a Tree-admin-approved sharing link; expanding Tree invitation rights to all members; or restricting external Send Individually to admins. Do not bypass this policy to satisfy a mandatory footer.

## Further design rules to settle with the selected phase

- **Direct-message permission:** choose a clear allowed-contact/message-request policy and blocking behavior. Shared Tree membership may permit initiating a private conversation, but must never give admins access to that conversation. Personal conversations and contact categories should not disappear merely because the user switches the selected Tree.
- **Contact-to-account matching:** current accounts have no verified phone numbers. A saved number or matching display name cannot prove that a contact is a specific Churp account. Start with explicitly selected/linked Churp users; automatic phone-based routing requires an appropriate verified identity and discovery policy.
- **Encryption:** internal private chats should use Churp's existing hybrid key-management behavior. SMS is not E2EE, including when it appears beside in-app messages in one private conversation. External delivery must be clearly identified and must not silently expose self-managed private-chat content. Do not label an SMS conversation end-to-end encrypted.
- **Paid plans:** subscriptions/billing do not exist. Pet unlocks and the Churp unlock code are not a subscription entitlement. Keep all users free until real server-verified plan entitlements exist; never allow a browser flag to remove the required external invitation.
- **SMS provider selection:** the spec names Twilio as an example, not a mandate. Choose a provider/number/registration strategy before live use. Resend account recovery is email infrastructure and does not supply SMS.
- **Inbound privacy:** a shared sending number is ambiguous when multiple leaders contact the same person. Use an explicit sender/number/conversation ownership strategy; ambiguous replies must not be guessed or exposed to unrelated leaders. Select the strategy and budget before activating cloud texting.
- **Sending identity and consent:** cloud SMS uses a provider number; personal SMS uses the user's own texting app. Saved contacts and Nest membership are not SMS consent. Permission to send a personal text is independent of cloud-SMS consent; personal SMS must not be an automatic fallback around cloud restrictions.
- **Honest outcomes:** distinguish queued, provider-submitted, carrier-delivered, failed and canceled. Include an uncertain/needs-confirmation state when a native handoff or provider timeout has no trustworthy outcome. Reconcile uncertain provider submissions before retrying, rather than risking duplicate texts.
- **Retries and fan-out:** keep per-recipient idempotency and transactional creation. Recheck Nest scope, recipient eligibility, consent, opt-outs, budgets, and plan state at submission. A preview alone is not authorization. Existing single-message rate limits should not accidentally reject a legitimate 300-recipient server-coordinated fan-out.
- **Data isolation:** contacts are owner-scoped; private conversations are participant-scoped; Nest administration stays Nest-scoped. SMS processing/audit storage must avoid plaintext private content in ordinary logs and must retain necessary suppression state when contacts are removed and later re-imported.
- **Fictional pilot:** any 300-member demo seed must require an explicit test/demo command and separate storage. Never seed or import real members into the production Railway Volume by default.

## Suggested incremental build order

1. Navigation, generated missing icons, accessibility, keyboard/safe-area behavior and preserved Nest deep links.
2. Personal contacts/Birdhouses and explicit import with supported-platform fallbacks.
3. Private 1:1 messaging, authorization, encryption and attachment access.
4. Send Individually using real in-app delivery and clearly separated sandbox results for unavailable channels.
5. SMS provider integration, verified identity where needed, consent/STOP/HELP, inbound ownership, budgets, server entitlements and required public policies.
6. Native contact/SMS adapters and actual iPhone/Android device testing; signing/store distribution when ready.

Tests should include role/ownership isolation, no private-Nest membership leak, no third participant in a DM, distinct per-recipient delivery, contact deduplication, legacy invite compatibility, deep links, provider signature checks, opt-out suppression, uncertain native outcomes, safe retries, and existing Nest/encryption regressions. Browser phone-size tests do not establish native device integration or carrier delivery.

## External readiness

Live cloud SMS requires a provider account, sending number, applicable registration/approval, an opt-in process, sender/HELP/STOP configuration, webhook secrets, approved public policies and a spending limit. Paid exemptions need verified billing entitlements. Native releases require build/signing credentials and real device validation. All unavailable pieces should remain explicitly disabled or sandboxed. No real billable texts should be sent during development.
