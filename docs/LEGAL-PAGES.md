# Public policies

Terms of Service (`/terms`), Privacy Policy (`/privacy`) and Phone Texting (`/sms-terms`, retained for existing links) are public server-rendered pages on the app and website origins. Links appear at sign-in/signup, under Your corner → About & policies and in the website footer. They open separately from encrypted chats.

The approved operator is Dustin Fausett, operating as Churp; the support/privacy contact is churptree@gmail.com. Policies describe managed/self-managed message keys, youth/guardian direct-message protections, optional Google sign-in, contact imports and the personal-phone draft handoff. The old proposed provider campaign terms have been replaced: there is no live Churp/Twilio texting program. None of these pages needs a draft/noindex banner for the retired program.

Phone drafts are Churp-managed at rest, require the user to send from their own messaging app, and do not report delivery or import replies. Scheduled phone drafts are reminders rather than automatic sends. The full behavior and production disablement are documented in [PHONE-DRAFTS.md](PHONE-DRAFTS.md).

`npm run check`, `tests/website.test.js` and `e2e/legal.spec.js` verify public routes, links, production policy pages, operator/contact details and phone-sized layouts.
