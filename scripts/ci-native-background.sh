#!/usr/bin/env bash
# Development module regression only. Never call the release/model build script.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true ]] || { echo 'This bounded emulator job is for GitHub Actions only.' >&2; exit 1; }
: "${ANDROID_HOME:?Runner Android SDK is required}"
LOG_DIR="$PWD/artifacts/native-background"
mkdir -p "$LOG_DIR"
SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
AVDMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager"
EMULATOR="$ANDROID_HOME/emulator/emulator"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
export ANDROID_SERIAL=emulator-5554
export ANDROID_AVD_HOME="$RUNNER_TEMP/bilipop-avd"
mkdir -p "$ANDROID_AVD_HOME"

# Use the runner's already-accepted SDK terms. EOF rejects any new license prompt.
# No `sdkmanager --licenses` and no unconditional acceptance pipeline.
test -s "$ANDROID_HOME/licenses/android-sdk-license" || {
  echo 'Runner lacks accepted Android SDK terms. Owner review is required.' >&2; exit 1;
}
timeout 300 "$SDKMANAGER" 'platform-tools' 'emulator' 'platforms;android-36' \
  'build-tools;36.0.0' 'system-images;android-36;default;x86_64' </dev/null \
  2>&1 | tee "$LOG_DIR/sdk-setup.log"
if grep -Eqi 'licenses?.*(not accepted|not been accepted)|Accept\? \(y/N\)' "$LOG_DIR/sdk-setup.log"; then
  echo 'Additional SDK terms require owner review; refusing to accept automatically.' >&2
  exit 1
fi
test -f "$ANDROID_HOME/system-images/android-36/default/x86_64/package.xml"

# Standard hosted Linux KVM only; no paid/larger runner or software-emulation fallback.
test -e /dev/kvm || { echo 'KVM unavailable on selected standard runner.' >&2; exit 1; }
sudo chmod a+rw /dev/kvm
test -r /dev/kvm && test -w /dev/kvm
printf 'no\n' | "$AVDMANAGER" create avd --force --name bilipop-background \
  --package 'system-images;android-36;default;x86_64' --device pixel_2

emulator_pid=''
logcat_pid=''
cleanup() {
  adb -s "$ANDROID_SERIAL" logcat -d > "$LOG_DIR/logcat-final.log" 2>&1 || true
  adb -s "$ANDROID_SERIAL" emu kill >/dev/null 2>&1 || true
  [[ -z "$logcat_pid" ]] || kill "$logcat_pid" 2>/dev/null || true
  [[ -z "$emulator_pid" ]] || kill "$emulator_pid" 2>/dev/null || true
}
trap cleanup EXIT
"$EMULATOR" -avd bilipop-background -port 5554 -no-window -no-audio \
  -no-boot-anim -no-snapshot -gpu swiftshader_indirect -accel on \
  -cores 2 -memory 2048 > "$LOG_DIR/emulator.log" 2>&1 &
emulator_pid=$!
timeout 180 bash -c '
  until [[ "$(adb -s "$ANDROID_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d "\r")" == 1 ]]; do sleep 2; done
'
test "$(adb -s "$ANDROID_SERIAL" shell getprop ro.build.version.sdk | tr -d '\r')" = 36
test "$(adb -s "$ANDROID_SERIAL" shell getprop ro.product.cpu.abi | tr -d '\r')" = x86_64
adb -s "$ANDROID_SERIAL" shell input keyevent 82
adb -s "$ANDROID_SERIAL" logcat -c
adb -s "$ANDROID_SERIAL" logcat > "$LOG_DIR/logcat.log" 2>&1 &
logcat_pid=$!
{
  java -version
  adb -s "$ANDROID_SERIAL" shell getprop ro.build.version.sdk
  adb -s "$ANDROID_SERIAL" shell getprop ro.product.cpu.abi
  sha256sum android/gradle/wrapper/gradle-wrapper.properties
} >> "$LOG_DIR/provenance.txt" 2>&1
# Restrict native work to the local library and the actual test class. No app/Metro/AAB.
timeout 1080 bash android/gradlew -p android :my-module:connectedDebugAndroidTest \
  -PreactNativeArchitectures=x86_64 \
  -Pandroid.testInstrumentationRunnerArguments.class=app.bilipop.translation.BackgroundMotionTest \
  --no-daemon --max-workers=2 --no-parallel --stacktrace \
  '-Dorg.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=768m' \
  '-Pkotlin.compiler.execution.strategy=in-process' \
  2>&1 | tee "$LOG_DIR/instrumentation.log"
