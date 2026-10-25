# English Hero — Google Play Release Checklist

## Current status
- English Hero website is hosted on GitHub Pages.
- Capacitor Android wrapper and debug APK build workflow are configured.
- Release AAB workflow exists and checks for four Android signing secrets.
- The release workflow verifies that the generated AAB exists and is nonempty before uploading it.
- **No signed production AAB has been verified yet.**

## Required before release
- [ ] Test debug APK on a physical Android phone.
- [ ] Verify lessons, quizzes, audio, accessibility, login/cloud sync, and external links.
- [ ] Check privacy policy against actual app behavior and complete Data safety accurately.
- [ ] Prepare production icon, screenshots, short description, full description, and support contact.
- [ ] Confirm stable package ID `com.englishhero.app`, version code and target SDK requirements.
- [ ] Generate and back up a release upload keystore securely.
- [ ] Set repository Actions secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Never put their values in source code, issues, or chat.
- [ ] Run **Build Android Play Store Bundle** manually and verify its signed AAB artifact.
- [ ] Set up an eligible Google Play Console developer account with any required guardian assistance, verification, and fees.
- [ ] Complete Play Console app access, target audience, content rating, privacy, and testing requirements.
- [ ] Submit for review; approval is not guaranteed.

## Important
The current Android wrapper loads https://mrwael1773.github.io/english-hero/ and requires internet for live content. Google Play may reject a thin web wrapper if it lacks adequate app functionality. Do not publish before real-device testing. This checklist covers Android / Google Play only.
