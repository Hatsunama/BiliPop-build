import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workflowText = read('.github/workflows/native-background.yml');
const workflow = YAML.parse(workflowText);
const script = read('scripts/ci-native-background.sh');
const nativeTests = read('modules/my-module/android/src/androidTest/java/app/bilipop/translation/BackgroundMotionTest.kt');

test('native regression CI is read-only, head-pinned, bounded, PR-only development work', () => {
  assert.deepEqual(Object.keys(workflow.on), ['pull_request']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(Object.keys(workflow.jobs).length, 1);
  const job = workflow.jobs['native-background'];
  assert.equal(job.if, false, 'Emulator execution is disabled in this source-build mirror');
  assert.equal(job['runs-on'], 'ubuntu-24.04');
  assert.equal(job['timeout-minutes'], 30);
  assert.equal(job.strategy, undefined, 'No multiplied emulator matrix');
  for (const step of job.steps.filter((step) => step.uses)) {
    assert.match(step.uses, /^actions\/[a-z-]+@[a-f0-9]{40}$/);
  }
  const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, '${{ github.event.pull_request.head.sha }}');
  assert.equal(checkout.with['persist-credentials'], false);
  const upload = job.steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(upload.with['retention-days'], 3);
  assert.equal(upload.if, 'always()');
  assert.match(workflowText, /npm ci --no-audit --no-fund/);
  assert.match(workflowText, /npm run check/);
  assert.match(workflowText, /expo prebuild --platform android --no-install/);
  assert.match(workflowText, /gradle-9\.3\.1-bin\.zip/);
  assert.doesNotMatch(workflowText, /pull_request_target|workflow_dispatch|secrets\.|fetch-model|build:qa|build:unsigned|assembleRelease|bundleRelease/);
});

test('emulator script runs only real module instrumentation and never accepts SDK terms', () => {
  assert.match(script, /GITHUB_ACTIONS/);
  assert.match(script, /:my-module:connectedDebugAndroidTest/);
  assert.match(script, /-PreactNativeArchitectures=x86_64/);
  assert.match(script, /system-images;android-36;default;x86_64/);
  assert.match(script, /-accel on/);
  assert.match(script, /timeout 180/);
  assert.match(script, /timeout 1080/);
  assert.match(script, /trap cleanup EXIT/);
  assert.match(script, /<\/dev\/null/);
  const commands = script.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n');
  assert.doesNotMatch(commands, /\byes\b|--licenses|build-android|fetch-model|:app:|assembleRelease|bundleRelease|expo start|pkill|killall/);
});

test('native harness exercises actual view layout, real frames and zero-size ordering', () => {
  assert.match(nativeTests, /BiliPopBackgroundView\(activity, mockk<AppContext>/);
  assert.match(nativeTests, /view\.getChildAt\(0\) as RefractBackgroundView/);
  assert.match(nativeTests, /Choreographer\.getInstance\(\)\.postFrameCallback/);
  assert.match(nativeTests, /falseProp_zeroSizeAttach_thenFirstNonzeroLayout_staysStopped/);
  const regression = nativeTests.split('@Test fun falseProp_zeroSizeAttach_thenFirstNonzeroLayout_staysStopped')[1].split('@Test')[0];
  assert.ok(regression.indexOf('width = 0, height = 0') < regression.indexOf('assertStopped('));
  assert.ok(regression.indexOf('assertStopped(') < regression.indexOf('resize(240, 360)'));
  assert.match(regression, /False prop must survive first nonzero native layout/);
  assert.match(nativeTests, /field\("choreographerAttached"\)/);
  assert.match(nativeTests, /simulation advanced/);
  assert.match(nativeTests, /enabled_hideShow_stopsThenResumes/);
  assert.match(nativeTests, /paused_hideShowAndDetachReattach_staysStopped/);
  assert.match(nativeTests, /paused_orientationChangeAndResize_staysStopped/);
  assert.match(nativeTests, /explicitEnableDisable_controlsRealFrames/);
  assert.doesNotMatch(nativeTests, /mockk<(?:BiliPopBackgroundView|RefractBackgroundView|Choreographer)>|\.doFrame\(/);
});

test('native test host and dependencies stay in instrumentation scope', () => {
  const build = read('modules/my-module/android/build.gradle');
  assert.match(build, /testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"/);
  for (const dependency of [
    'androidx.test:runner:1.7.0', 'androidx.test:core:1.7.0',
    'androidx.test.ext:junit:1.3.0', 'io.mockk:mockk-android:1.14.9',
  ]) assert.ok(build.includes(`androidTestImplementation '${dependency}'`));
  assert.match(read('modules/my-module/android/src/androidTest/AndroidManifest.xml'), /BackgroundTestActivity/);
  assert.doesNotMatch(read('modules/my-module/android/src/main/AndroidManifest.xml'), /BackgroundTestActivity/);
});

test('canonical renderer remains byte-for-byte unchanged for bridge regression work', () => {
  const path = 'modules/my-module/android/src/main/java/com/hatsunama/refract/RefractBackgroundView.kt';
  assert.equal(createHash('sha256').update(read(path)).digest('hex'), '3ae35fd6e40bb419ef4d5a6cddc8baea7ac498e3d91f61b3b19ccfe502c9452b');
});

// GitHub's explicit bash shell uses --noprofile --norc -e -o pipefail {0}.
// Unspecified Linux shell uses bash -e {0}, which can hide producer errors.
test('CI log pipelines propagate producer failures before later build stages', () => {
  assert.equal(workflow.defaults?.run?.shell, 'bash');
  const job = workflow.jobs['native-background'];
  for (const step of job.steps.filter((step) => step.run)) {
    assert.equal(step.shell ?? job.defaults?.run?.shell ?? workflow.defaults.run.shell, 'bash');
  }
  const producer = '(exit 23) | tee /dev/null';
  const unsafe = spawnSync('bash', ['-e', '-c', producer], { encoding: 'utf8' });
  assert.equal(unsafe.status, 0, 'Demonstrate why unspecified shell is unsafe with tee');
  const safe = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', producer], { encoding: 'utf8' });
  assert.equal(safe.status, 23, 'Explicit GitHub bash must preserve the producer failure');
});

test('development prebuild explicitly selects isolated QA identity', () => {
  assert.equal(workflow.jobs['native-background'].env.BILIPOP_QA, '1');
  const config = JSON.parse(read('app.json'));
  assert.equal(config.expo.android.package, 'app.bilipop', 'Production identity stays unchanged');
});
