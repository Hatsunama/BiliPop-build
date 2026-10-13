# Canonical background

The two files under `modules/my-module/android/src/main/java/com/hatsunama/refract/`
are vendored unchanged from Hatsunama/Hatsu-Animation commit
`0f4bb7512a074eabd704481fb06725e1b84ac928`.

- `RefractBackgroundView.kt`: Git blob `260eb62e4aa86ca64a0e7b680fb0f6faeab69868`
- `RefractSeed.kt`: Git blob `31f085a7c9f197bed88b3ff6dde9ed23f4b9b068`

Source: https://github.com/Hatsunama/Hatsu-Animation/tree/0f4bb7512a074eabd704481fb06725e1b84ac928

This is the native procedural renderer, not an approximation or replacement image.
The Expo wrapper requests a pause while translating, while backgrounded, or when
Reduce Motion is enabled. Component tests cover preference/event ordering and
app lifecycle. Native enforcement at first size/attach remains unverified: the
canonical renderer can auto-enable itself during those callbacks. Real-device validation is required before treating pause as validated
on Android. The existing deterministic seed remains device-local.
Web preview shows a static dark fallback; it does not reproduce the native animation.
