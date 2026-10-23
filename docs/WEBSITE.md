# Churp public website

The public website is built from `website/index.html`, `main.js`, and `style.css`. It uses the existing logo, birds, tree and nest art, local Nunito fonts, and a separate lightweight bundle. Its text is real HTML for search engines. The school/church/family examples are clearly marked illustrative. Help stays on the page: no email address, lead collection, analytics, payment form, invented prices, testimonials, or compliance claims are published.

Run `npm run dev` and open `/website/` to preview. Build with `npm run build`. The existing Railway service can serve both entries, without WordPress or a second Railway service:

| Host or path | Result |
| --- | --- |
| `churptree.com/`, `www.churptree.com/` | Public website |
| `app.churptree.com/` | Existing messaging app |
| Existing Railway domain `/` | Existing messaging app; origin and local keys remain available |
| `/website/` on any of these hosts | Website preview |

The public `/api/site-config` supplies app and signup links. Set `APP_URL=https://app.churptree.com` once that domain is active. Until then, Railway's existing derived app URL lets preview visitors open the current app. The Create account links open the real signup form; no separate marketing account or lead form is created. Paid subscriptions and purchases are explicitly coming later.

## Connect the GoDaddy domain after review

1. Open the **existing app service** in Railway, then **Settings → Networking → Custom Domain**. Add `app.churptree.com`, `churptree.com`, and optionally `www.churptree.com`. Keep the existing Railway domain. Use the actual listening port from Deploy Logs (8080 for the current service).
2. For each domain, copy the **exact DNS record type, Host/Name, and Value/Target Railway displays**. Do not use a guessed Railway IP address or the URL of a deployment dashboard.
3. In GoDaddy, open **My Products → churptree.com → DNS → Manage DNS**. Enter the matching records. GoDaddy normally uses `app` or `www` as the name for those subdomains, and `@` for the apex. Replace conflicting parking records only when the new target is confirmed. Preserve unrelated MX/TXT records. Standard DNS records do not require a WordPress or website-builder purchase.
4. If Railway's apex instruction requires a record type GoDaddy does not support, pause before changing the root record. A free DNS provider supporting apex flattening, such as Cloudflare DNS, can handle this while the domain remains registered at GoDaddy. Choose the method from the actual Railway instructions; do not assume GoDaddy supports a CNAME at `@`.
5. Wait for Railway domain verification and HTTPS certificates. Check that `app.churptree.com` opens sign-in and `churptree.com` opens the public site. Set Railway's `APP_URL` to `https://app.churptree.com` and redeploy so website links and new invitations use the permanent app address.
6. When configuring Google OAuth, authorize the exact app origin. Keep the previous origin authorized during the transition if existing users need it. Google setup is independent of the website launch.

DNS and Railway domain settings cannot be changed from this checkout without access to those accounts. This change prepares and publishes the code; it does not claim that domain ownership, DNS, or HTTPS have already been configured.

## Preserve access during the domain move

Keep the old Railway app origin working. Managed-key users can sign in at the new app domain and restore automatically. Self-managed users must restore their recovery key or approve the new origin from a browser still signed in at the old origin. Do not force-redirect the old domain or clear its browser data before that transfer. Existing Home Screen shortcuts may still open the old domain; install a new shortcut from the permanent app address after transferring.

## Checks

`npm run check` covers the build, app tests, and production host routing. `npm run test:e2e -- e2e/website.spec.js` checks responsive navigation, community previews, FAQ deep links, working signup links, image loading, and overflow on desktop, iPhone-sized, and Android-sized browsers. The production container smoke check also confirms both public and app entries work under the production security policy.
