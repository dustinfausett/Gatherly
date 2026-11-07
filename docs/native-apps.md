# Churp iPhone and Android apps

Churp now has Capacitor 8 projects in `ios/` and `android/`. The app screens are bundled locally; accounts, permissions, messages, encrypted attachments and backups remain on the same Railway backend. The application identifier is `com.churptree.app`. These are development projects, not signed store releases.

Backend fixes take effect for every client after deployment. Changes to bundled screens, plugins, icons or native configuration require rebuilding and distributing a new app version. Keep older app versions compatible when changing backend APIs.

## First: run the iPhone simulator on your Mac

1. Install Xcode 26 or newer from Apple, open it once, accept its license and install an iPhone simulator. Install Node.js 24 or newer and Git.
2. Clone `https://github.com/dustinfausett/Gatherly.git` (or pull the latest main branch of your existing checkout).
3. In Terminal, enter the repository directory and run:

   ```sh
   npm ci
   npm run native:doctor -- --ios
   npm run native:ios
   ```

4. In Xcode, choose the **App** scheme and an iPhone simulator, then click Run. Simulator testing does not require paid Apple Developer membership.

The default backend is `https://app.churptree.com`; deploy the corresponding server changes before testing. To use another trusted HTTPS deployment, set `VITE_CHURP_API_ORIGIN` when building. Do not put backend secrets in any `VITE_` variable. Native sessions use HttpOnly cookies, and Google confirmation happens in the system browser using a single-use, PKCE-protected callback. The existing Google web client must authorize the backend HTTPS origin; native Google sign-in does not require a new Android/iOS Google client.

Google login can be tested on a real phone after selecting your signing team and a unique provisioned application identifier if necessary. Changing the identifier also requires updating `shared/mobile.js`, Capacitor configuration, both platform projects and push configuration together. The shared identifier in this repository should be retained when possible.

## Android development

Install Android Studio, Android SDK Platform 36, Build Tools 36, Platform Tools, and Java 21. Set `ANDROID_HOME` to the SDK directory if Android Studio does not do so. Run:

```sh
npm ci
npm run native:doctor -- --android
npm run native:android
```

Choose a simulator or connected Android phone in Android Studio and run the app. The equivalent command-line debug build is `cd android` followed by `./gradlew assembleDebug` (Windows: `gradlew.bat assembleDebug`). Debug APKs are development builds, not Play Store submissions.

## What is integrated

- Shared Churp screens, existing encrypted storage and family protections.
- System-browser Google login, account linking and deletion confirmation.
- Native keyboard events, Android Back handling, app icon badges, system share/export sheets and phone-text handoff. Phone drafts still require the user to tap Send in their messaging app.
- A native contact picker that imports only the selected contact after confirmation. It does not upload the whole phonebook. The Android contact plugin requests the Contacts permission group (including read/write access); Churp only uses its picker and does not edit the phone address book.
- Optional APNs/FCM push registration, notification taps, mute/block/privacy checks and foreground suppression. Web/PWA push continues using the existing implementation.
- Authenticated native message synchronization while the app is visible.

Private keys remain on each device. Self-managed accounts still need their recovery key or an approved device to unlock history on a new installation; installing the native app does not copy a website's IndexedDB keys. Churp-managed accounts retain their existing recovery behavior. Native OS backup of app private-key storage is disabled. User-requested decrypted exports use a temporary sharing cache, cleared on logout and purged after 24 hours at next launch.

Public invitation URLs currently open the website. Universal Links/App Links require separately configured domain-association files and signing identities; they are not enabled by this scaffold. The private custom URL scheme is used for native authentication callbacks.

## Push setup, before testing native delivery

The app runs without push credentials; notification settings explain when setup is unavailable. Never commit credentials or signing keys.

For iOS:

1. Enroll in Apple Developer, configure the App ID and provisioning, and add **Push Notifications** in Xcode's Signing & Capabilities. Use Apple's resulting development/distribution entitlements.
2. Create an APNs authentication key in Apple Developer. Store its values only as Railway backend variables: `CHURP_APNS_KEY_ID`, `CHURP_APNS_TEAM_ID`, and `CHURP_APNS_PRIVATE_KEY` (the PEM contents).
3. Development builds use APNs sandbox. Before archiving for TestFlight or distribution run `npm run native:sync:release` so the bundled environment uses production APNs.

For Android:

1. Create a Firebase project, register the Android app as `com.churptree.app`, and place its downloaded `google-services.json` in `android/app/`. This local file is ignored by Git.
2. Enable Firebase Cloud Messaging HTTP v1. Store a dedicated service account's JSON, with permission to send messages in that project, only in Railway as `CHURP_FCM_SERVICE_ACCOUNT_JSON`.
3. Sync, rebuild and install the app, then enable notifications and accept the OS prompt.

Current native notifications show the sender and Nest when previews are enabled, with a generic message body. **Encrypted message-text snippets are not implemented for native push yet.** Privacy mode hides sender/context as well. Real-device push, badges and background behavior must be tested after credentials and signing are configured. Web encrypted push previews are unchanged.

## Before store submission

These steps remain necessary:

- Test signed builds on physical iPhones and Android phones, including foreground/background notifications, Google callback, contacts, file sharing, keyboard layout, youth approval/blocking and key recovery.
- Add Sign in with Apple or establish that Churp qualifies for an App Review Guideline 4.8 exception before submitting the iPhone app with Google sign-in.
- Review App Store privacy labels, the iOS privacy manifest, Google Play Data Safety, permission declarations, youth/age requirements, account-deletion URLs, screenshots, support contact and current policies against actual behavior.
- Complete Apple's encryption/export-compliance questions accurately for Churp's OpenPGP implementation; do not assume an exemption.
- Create distribution signing, store listings and review/demo accounts. Keep signing credentials out of Git. Increment iOS version/build and Android versionName/versionCode for each release.
- Archive/upload through Xcode for TestFlight/App Store; build a signed Android App Bundle for Google Play internal testing before production.

The manual **Native app builds** GitHub Actions workflow checks an Android debug APK and an unsigned iOS simulator build. It does not sign, publish or submit either app. Linux development can compile Android but cannot validate Xcode compilation; a Mac build remains required.

## Artwork

`native/assets/` contains the approved Churp app icon and wordmark, with a cream splash background. Run `npm run native:assets` to regenerate native icons and splash images after changing those sources. Run `npm run native:sync` after UI or plugin changes; generated web bundles and local build outputs are deliberately excluded from Git.
