# Public policies

Terms of Service (`/terms`), Privacy Policy (`/privacy`) and SMS Terms (`/sms-terms`) are public, server-rendered pages available on the app and website origins without authentication, JavaScript or age setup. Links appear on sign-in/signup, under Your corner → About & policies, and in the public website footer. They open separately from the app so following a link does not replace an active encrypted conversation.

The owner approved churptree@gmail.com as the public support/privacy address. The owner also confirmed Dustin Fausett, operating as Churp as the legal operator. General policies publish those details; the SMS Terms alone retain a draft banner and noindex header. SMS Terms remain a draft while external texting is disabled and the shared-number model awaits provider review. Nothing claims an SMS consent form, active STOP/HELP service, verified parental consent, or carrier approval exists. Content reflects current managed/self-managed keys, guardian access to youth DMs, personal contact imports and the absence of self-service account deletion. No private screenshot email was published.

`shared/legal.js` owns the documents and public contact details; `server/legal.js` renders them with escaped text and a CSP-compatible, local stylesheet and licensed fonts. Both domains use the same content. There is no new analytics integration, acceptance checkbox or tracking of policy views. Linking policies does not create a recorded click-through acceptance event; versioned acceptance would need its own implementation if required.

Before finalizing the program, obtain review appropriate for a service handling minors and school/family information, complete any legally required parental consent mechanism, settle the provider-approved sending structure, and implement/document the actual enrollment, confirmation, opt-out/help and reply flows. Update notices alongside actual features. The documents are not a guarantee of legal or carrier approval. No SMS is sent or billable provider resources created by this change.

Verification: npm run check covers public routes on both origins under production CSP, correct document responses before authentication, SMS-only draft noindex status and the approved contact. e2e/legal.spec.js covers public reading, cross-document links, website footer, signup popup links, settings and mobile overflow. Existing settings-count expectations reflect the new About & policies section.

<img src="screenshots/privacy-policy.png" width="300" alt="Churp Privacy Policy on a phone-sized screen" />
