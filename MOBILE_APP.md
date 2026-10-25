# English Hero mobile app

This repository contains the English Hero website and an initial Capacitor Android wrapper configuration.

## Android test build
1. Open the repository's Actions tab.
2. Select **Build Android APK**.
3. Choose **Run workflow**.
4. After a successful run, download the `english-hero-android-debug` artifact.

This is a **debug/testing APK**, not a signed Google Play release. The current wrapper loads the live website, so an internet connection is required for most content. Before a public store release, test on real devices, review privacy/data handling, create store assets, and configure a properly signed release build.

## iPhone / App Store
An iOS build requires Xcode on macOS, an Apple Developer account, signing certificates, and App Store Connect review. These cannot be completed by this repository workflow alone.
