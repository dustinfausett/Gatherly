# Passwords and recovery email

**Profile → Password and account recovery → Change password** requires the current password, creates a new password hash, invalidates password/email recovery tokens, revokes all sign-in sessions and rotates the current session so this browser remains signed in. Encryption identities and existing local message keys are preserved. Google-only accounts use Google account recovery; Churp does not create a separate password for them.

Username/password accounts can add a recovery email while signed in. Changing/removing it requires the current password. The address becomes usable only after the owner clicks the verification link and confirms on the Churp page. Replacing an email leaves the old verified address active until the replacement is verified. Pending addresses are not valid password-reset destinations. Verified recovery emails are unique to accounts and do not appear in Tree membership lists.

**Forgot password?** accepts a username or verified recovery email and returns a generic result whether the account exists, uses Google, or has no recovery email. Known password accounts receive one-use links expiring in 30 minutes. Verification links expire in 24 hours. Tokens are random 256-bit values; only hashes are stored. Email requests are rate limited and capped per account. Reset tokens are checked again after password hashing to reject races; resetting invalidates all sessions and outstanding account tokens, then asks the user to sign in again. Link parameters are removed from the visible browser URL after capture; the page submits confirmation via POST so email scanners following a link cannot consume it.

Resetting a password does not recover a self-managed encryption key. A self-managed user still needs an approved device or the separate `CHURP1-…` recovery key. Churp-managed accounts restore message access through ordinary sign-in. There is no password-reset bypass for an old account that never verified a recovery email: add and verify an email while still signed in, or change the password on an existing signed-in device using the current password.

## Low-cost email setup with Resend

1. Create a Resend account at https://resend.com and use its free plan if it fits your current volume.
2. Add a sending domain, for example **mail.churptree.com**. Add the exact DNS records Resend provides at your active DNS host (Cloudflare if it is still managing your domain). Keep existing website, Google, mail and other DNS records intact. A sending subdomain avoids changing existing root-domain mail delivery.
3. Wait for Resend to verify the domain. Create an API key authorized to send from that domain.
4. In the Railway Churp service’s Variables, set these values, with the API key entered as a secret:

   ```text
   RESEND_API_KEY=<your Resend sending API key>
   CHURP_EMAIL_FROM=Churp <login@mail.churptree.com>
   APP_URL=https://app.churptree.com
   ```

   Use the actual working app origin for `APP_URL` if the custom app domain is not active yet. Keep old app domains available for people with origin-local self-managed keys; see WEBSITE.md.
5. Redeploy. Open your profile, add an email you can receive, verify it, then test **Forgot password?**. Check the spam folder and the Resend delivery dashboard if needed. A sending address does not need a paid mailbox to send these links.

With no mail configuration, password changes still work and email reset/verification is clearly unavailable. No tokens or reset links are exposed through development API endpoints. Tests inject an in-memory mailer instead of sending real email. No WordPress or separate mail server is needed.
