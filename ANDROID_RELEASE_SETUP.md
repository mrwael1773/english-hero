# Preparing the Google Play release build

The repository contains two Android workflows:
- **Build Android APK** creates a debug APK for device testing.
- **Build Android Play Store Bundle** creates a signed AAB, but only after release-signing secrets are configured.

## Required GitHub Actions secrets

Open the repository's **Settings → Secrets and variables → Actions → New repository secret** and add:

- `ANDROID_KEYSTORE_BASE64`: the entire release keystore file encoded as one Base64 string.
- `ANDROID_KEYSTORE_PASSWORD`: the keystore password.
- `ANDROID_KEY_ALIAS`: the key alias.
- `ANDROID_KEY_PASSWORD`: the key password.

Keep a secure backup of the keystore and passwords. Never commit them to GitHub, paste them into chat, or share them. Losing the signing key can complicate future updates.

After setting the secrets, open **Actions → Build Android Play Store Bundle → Run workflow**. The output is an AAB artifact if the build succeeds.

## Before publishing
A successful AAB build does not mean the app is ready or accepted by Google Play. Test on devices, check that the live website works inside the app, publish a privacy policy that matches actual data handling, complete Play Console declarations, and follow the account's testing and review requirements.

The current Capacitor setup loads the hosted website, so live content requires internet. App-store approval is not guaranteed.
