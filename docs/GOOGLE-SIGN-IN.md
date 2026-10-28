# Google sign-in

Google sign-in is optional. Username/password sign-in stays available. Churp uses Google Identity Services' browser button and validates its ID token on the server with Google's library (signature, issuer, audience and expiry). It requests identity only; it does not request Gmail, Drive or phone contacts access, and it does not store Google access/refresh tokens or a client secret.

## Google Cloud

1. Create/select the Churp project in Google Cloud → Google Auth Platform.
2. Branding: app name **Churp**, support/developer contact **churptree@gmail.com**, homepage **https://churptree.com**, privacy **https://churptree.com/privacy**, terms **https://churptree.com/terms**, authorized domain **churptree.com**. The square upload logo is `public/brand/churp-google-logo.png` (768 × 768 PNG, under 1 MB).
3. Audience: **External**, initially **Testing**. Add the Google accounts being used for the pilot as test users. Keep production rollout separate from the initial test. Google's identity-only scope rules may differ from its restrictions for additional APIs; do not add sensitive scopes just to enable sign-in.
4. Clients → Create client → **Web application**, name **Churp Web**. Authorized JavaScript origin: **https://app.churptree.com** (no path). Leave authorized redirect URIs empty: this integration uses a JavaScript callback.
5. Copy the **Client ID** ending in `.apps.googleusercontent.com`. Churp does not need the client secret. There is no need to activate the paid Google Cloud free-trial offer for basic Google sign-in.

## Railway and first test

1. In Railway, open the **feisty-fulfillment** app service → **Variables**. Add `GOOGLE_CLIENT_ID` with the Client ID as its value. Keep `APP_URL=https://app.churptree.com` and the existing Volume/data/key-vault settings intact. Redeploy the app service.
2. For an **existing account**, sign in to Churp using its current username/password first. Open **Your corner → Account settings → Google sign-in**. Enter the current **Churp** password and select **Connect Google**, then choose your Google account in Google's own window. Churp never asks for a Google password.
3. Confirm the connected email is shown, sign out, then choose **Continue with Google** on Churp's sign-in page. Check the same Trees, contacts and chat history open.
4. For a **new account**, first choose **Create an account** on the Churp sign-in page, then **Continue with Google**. Date-of-birth and any required youth/parent setup still apply before continuing.
5. Test on actual Safari/iPhone and desktop browsers before publishing. Publish the OAuth app from Google's Audience screen when ready, and complete any domain/branding verification Google requests. No broad Google API scopes are needed.

## Existing accounts and message keys

Google is an additional sign-in method on the **same user ID**. Linking preserves the username, password, profile, memberships, parent links, contacts and encryption identities. It requires a current Churp session and password confirmation, followed by a fresh Google identity proof. The connecting session is rotated; other existing sessions remain signed in. Signed-in password accounts can disconnect Google after confirming their Churp password. Google-only accounts cannot disconnect their sole sign-in method.

An unconnected Google account cannot silently create a new Churp account from the sign-in screen. The user must explicitly choose signup. Signup also detects matching verified recovery emails and directs the user to connect from their existing account. Email matching **never** authorizes an automatic merge. Users without a matching recovery email still need to follow the existing-account instructions rather than signup. If a Google identity is already attached to another Churp account, linking refuses to move it or merge account data.

Churp-managed messaging keys restore through ordinary Google sign-in. Self-managed users still need their approved device, device transfer or personal encryption recovery key; Google does not replace that recovery method or change who stores message keys.

## Request protection

Each button uses a random five-minute, single-use nonce. Its hash is stored in `google_auth_challenges`; its value is passed to Google and bound to the initiating browser using an HttpOnly, SameSite cookie (Secure in production). Account-linking challenges additionally bind to the exact Churp user and current session; logout/password resets invalidate them. The verified Google ID token must echo the nonce. Churp consumes the challenge before token verification to prevent concurrent replays, rechecks the linking session after verification, applies same-origin checks and rate limits, and never logs ID tokens or password values. Expired attempts can be retried from the screen.

## Troubleshooting

- **Awaiting setup:** the running app service has no `GOOGLE_CLIENT_ID`; check its Variables and redeploy.
- **Origin/client error:** confirm this is a Web client and `https://app.churptree.com` is in Authorized JavaScript origins. A Railway preview hostname needs its own authorized origin if used for a test.
- **Access denied:** check Google's Audience/testing settings and the selected Google account. School/Workspace administrators may restrict third-party sign-in.
- **Not connected yet:** use the existing Churp username/password and connect Google under Account settings. New users must choose Create an account first.
- **Expired attempt:** retry Google sign-in, or reconfirm the Churp password for a connection. Do not reuse a captured credential.
- **Google window does not appear:** allow the Google sign-in popup and check browser content blockers; username/password stays available.

## Verification

`tests/google-auth.test.js` checks same-account linking, password and key preservation, explicit signup/age gating, verified-email duplicate prevention, browser/nonce binding, expiry/replay, cross-site rejection, identity collisions and logout/password-change races. `e2e/google-auth.spec.js` exercises the actual Churp screens and server, including retaining encrypted Nest history after Google sign-in. Browser tests simulate Google's button/token issuer only; production always uses Google's token verifier. They do not verify Google Console configuration or replace a live device sign-in test.
