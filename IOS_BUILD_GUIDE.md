# English Hero for iPhone (iOS)

## Current status
The website is live at https://mrwael1773.github.io/english-hero/ and can be added to an iPhone Home Screen from Safari.
The Android APK artifact is not compatible with iPhone.

## What is needed for a native iOS app
A native iOS build must be created with Apple's Xcode on a Mac. Installing it on a real iPhone or distributing it through TestFlight/App Store requires Apple signing and provisioning. GitHub Actions cannot create a valid signed iPhone app without the signing assets and account configuration.

## Easiest way to use English Hero today
1. Open the site in Safari on the iPhone: https://mrwael1773.github.io/english-hero/
2. Tap Share.
3. Choose "Add to Home Screen" (إضافة إلى الشاشة الرئيسية).
4. Tap Add.

## Native iOS release checklist
- [ ] Have access to a Mac with a supported version of Xcode.
- [ ] Add the Capacitor iOS platform to the project and open the generated iOS project in Xcode.
- [ ] Set a unique Bundle Identifier.
- [ ] Configure Apple signing and provisioning for a real device.
- [ ] Test on a physical iPhone.
- [ ] For TestFlight/App Store, configure App Store Connect and complete Apple's app privacy and review requirements.

## Security
Never commit Apple certificates, provisioning profiles, private keys, or passwords to the repository. Do not paste them into chat. Use protected GitHub Actions secrets if setting up a signed CI build.
