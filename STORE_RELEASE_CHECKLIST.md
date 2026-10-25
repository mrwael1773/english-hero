# English Hero — Store Release Checklist

## Current status
- The website is published with a web-app manifest, icon, service worker, and installation guidance.
- A Capacitor Android wrapper configuration has been added.
- GitHub Actions builds a **debug APK** for testing. A debug APK is not a Google Play release.

## Before Google Play
- [ ] Install and test the APK on a real Android device.
- [ ] Verify all lessons, quizzes, audio, sign-in/sync and external links.
- [ ] Confirm the privacy policy accurately explains any collected or synced data.
- [ ] Create a production app icon and store screenshots.
- [ ] Choose a permanent application ID and version.
- [ ] Configure a release signing key securely; never commit private signing keys or passwords.
- [ ] Build a signed Android App Bundle (AAB), not just a debug APK.
- [ ] Create a Google Play Console developer account and complete its required verification/testing steps.
- [ ] Complete the Data safety, content rating, target audience, and app access declarations accurately.
- [ ] Submit for review.

## Before Apple App Store
- [ ] Build the iOS target using Xcode on macOS.
- [ ] Test on supported iPhones and fix any issues.
- [ ] Enroll in the Apple Developer Program and configure signing.
- [ ] Prepare screenshots, app privacy details, support URL, and App Store metadata.
- [ ] Submit through App Store Connect for review.

## Important limitations
The current Capacitor configuration loads the published website, so it requires internet for the site's live content. A debug build is for testing only. Store acceptance is not guaranteed; each store reviews the app. iOS signing and submission require Apple's tools and account access.
