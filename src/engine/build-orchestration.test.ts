import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { unsignedReleaseGradle } from '../../scripts/release-config.mjs';

// Exercise process/file orchestration with fake external commands. This does not
// claim Gradle compiled anything, nor test Windows cmd.exe on a Linux host.
const source = readFileSync('scripts/build-android.mjs', 'utf8').replace(/^import .*;\n/gm, '');
const original = 'buildTypes { debug { signingConfig signingConfigs.debug } release { signingConfig signingConfigs.debug } }';
function harness(mode: string, failBuild = false, gradle = original) {
  const files = new Map<string, string | Buffer>([['android/app/build.gradle', gradle]]);
  const calls: { command: string; args: string[]; env: Record<string, string>; gradle: string | Buffer | undefined }[] = [];
  const copies: string[] = [];
  const execute = () => vm.runInNewContext(source, {
    process: { argv: ['node', 'build-android.mjs', mode], platform: 'linux', execPath: '/node', env: {} },
    spawnSync: (command: string, args: string[], options: { env: Record<string, string> }) => {
      calls.push({ command, args, env: options.env, gradle: files.get('android/app/build.gradle') });
      return { status: failBuild && command.includes('gradlew') ? 1 : 0 };
    },
    existsSync: () => true,
    mkdirSync: () => {},
    copyFileSync: (_from: string, to: string) => copies.push(to),
    readFileSync: (path: string) => files.get(path) ?? Buffer.from('test artifact'),
    writeFileSync: (path: string, value: string | Buffer) => files.set(path, value),
    createHash, resolve, unsignedReleaseGradle, console: { log: () => {} },
  });
  return { execute, files, calls, copies };
}

describe('local build orchestration contract (mock external commands)', () => {
  it('builds unsigned artifacts and restores generated signing configuration', () => {
    const h = harness('unsigned'); h.execute();
    assert.match(String(h.calls.at(-1)?.gradle), /release \{ signingConfig null/);
    assert.equal(h.calls.at(-1)?.env.BILIPOP_QA, '0');
    assert.ok(h.calls.at(-1)?.args.includes(':app:clean'));
    assert.equal(h.files.get('android/app/build.gradle'), original);
    assert.equal(h.copies.length, 2);
    assert.match(String(h.files.get(resolve('artifacts/unsigned/SHA256SUMS.txt'))), /^[a-f0-9]{64}  bilipop-unsigned.apk\n[a-f0-9]{64}  bilipop-unsigned.aab\n$/);
  });
  it('restores configuration after build failure and publishes no copied artifacts', () => {
    const h = harness('unsigned', true);
    assert.throws(h.execute, /No release was published/);
    assert.equal(h.files.get('android/app/build.gradle'), original);
    assert.equal(h.copies.length, 0);
  });
  it('does not guess a private or interrupted signing configuration', () => {
    const h = harness('qa', false, 'release { signingConfig signingConfigs.production }');
    assert.throws(h.execute, /Inspect/);
    assert.equal(h.calls.some((call) => call.command.includes('gradlew')), false);
    assert.equal(h.copies.length, 0);
  });
  it('isolates QA without changing generated signing configuration', () => {
    const h = harness('qa'); h.execute();
    assert.equal(h.calls.at(-1)?.env.BILIPOP_QA, '1');
    assert.equal(h.calls.at(-1)?.gradle, original);
    assert.equal(h.files.get('android/app/build.gradle'), original);
  });
  it('rejects an unknown mode before any external command', () => {
    const h = harness('publish');
    assert.throws(h.execute, /Use qa or unsigned/);
    assert.equal(h.calls.length, 0);
  });
});
