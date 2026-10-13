// Local builds only: no EAS, cloud build service, signing upload or store submission.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { unsignedReleaseGradle } from './release-config.mjs';

const mode = process.argv[2] ?? 'qa';
if (!['qa', 'unsigned'].includes(mode)) throw new Error('Use qa or unsigned. No signing credentials are accepted.');
const env = { ...process.env, EXPO_NO_TELEMETRY: '1', NODE_ENV: 'production', BILIPOP_QA: mode === 'qa' ? '1' : '0' };
function run(command, args) {
  const result = process.platform === 'win32' && command.endsWith('.bat')
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${[command, ...args].map((part) => `"${part}"`).join(' ')}"`], { env, stdio: 'inherit', shell: false })
    : spawnSync(command, args, { env, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}). No release was published.`);
}
run(process.execPath, ['scripts/verify-model-contract.mjs']);
run(process.execPath, ['node_modules/expo/bin/cli', 'prebuild', '--platform', 'android', '--no-install']);
// Expo's generated template signs release with its shared debug key. Store candidates
// must instead remain unsigned until the existing identity is supplied securely.
const gradleFile = 'android/app/build.gradle';
const original = readFileSync(gradleFile, 'utf8');
// Validate both modes: an interrupted or manually signed build must not be reused.
const unsigned = unsignedReleaseGradle(original);
const gradle = process.platform === 'win32' ? 'android/gradlew.bat' : './android/gradlew';
try {
  if (mode === 'unsigned') writeFileSync(gradleFile, unsigned);
  // Clean only this app's generated build outputs, never shared caches or drafts.
  run(gradle, ['-p', 'android', ':app:clean', ':app:assembleRelease', ':app:bundleRelease', '-PreactNativeArchitectures=arm64-v8a',
    '--no-daemon', '--max-workers=1', '--no-parallel', '-Dorg.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=768m',
    '-Pkotlin.compiler.execution.strategy=in-process']);
} finally {
  if (mode === 'unsigned') writeFileSync(gradleFile, original);
}
const destination = resolve('artifacts', mode);
mkdirSync(destination, { recursive: true });
const sources = [
  [`android/app/build/outputs/apk/release/app-release${mode === 'unsigned' ? '-unsigned' : ''}.apk`, `bilipop-${mode}.apk`],
  ['android/app/build/outputs/bundle/release/app-release.aab', `bilipop-${mode}.aab`],
];
const checksums = [];
for (const [source, filename] of sources) {
  if (!existsSync(source)) throw new Error(`Expected build output missing: ${source}`);
  copyFileSync(source, resolve(destination, filename));
  checksums.push(`${createHash('sha256').update(readFileSync(source)).digest('hex')}  ${filename}`);
}
writeFileSync(resolve(destination, 'SHA256SUMS.txt'), checksums.join('\n') + '\n');
console.log(`Artifacts: ${destination}. ${mode === 'qa' ? 'Isolated app.bilipop.qa; not an in-place update.' : 'UNSIGNED; secure signing and release validation are still required.'}`);
