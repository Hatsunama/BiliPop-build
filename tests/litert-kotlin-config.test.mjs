import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const withLiteRtKotlin = require('../plugins/with-litert-kotlin.js');
// Expo 57 generated root build.gradle. RN's unversioned KGP classpath otherwise
// resolves 2.1.20, even when Expo reports android.kotlinVersion = 2.4.0.
const rootGradle = `buildscript {
  repositories {
    google()
    mavenCentral()
  }
  dependencies {
    classpath('com.android.tools.build:gradle')
    classpath('com.facebook.react:react-native-gradle-plugin')
    classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')
  }
}

allprojects { repositories { google() } }
apply plugin: "expo-root-project"
apply plugin: "com.facebook.react.rootproject"
`;
const original = "classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')";
const pinned = "classpath('org.jetbrains.kotlin:kotlin-gradle-plugin:2.3.20')";

async function applyMod(name, modResults) {
  const config = withLiteRtKotlin({ name: 'fixture', slug: 'fixture' });
  assert.equal(typeof config.mods.android[name], 'function', `${name} must be registered`);
  return (await config.mods.android[name]({ ...config, modResults, modRequest: {} })).modResults;
}

async function project(contents, language = 'groovy') {
  return (await applyMod('projectBuildGradle', { contents, language })).contents;
}

test('selects the verified LiteRT-compatible compiler with a published Pika 0.3.2 artifact', async () => {
  // Official Maven has Pika 0.3.2-2.3.20, but not 0.3.2-2.4.0. The unchanged
  // native bridge compiles with Kotlin 2.3.20 and metadata checks enabled.
  const properties = await applyMod('gradleProperties', []);
  const version = properties.find((item) => item.key === 'android.kotlinVersion').value;
  assert.equal(version, '2.3.20');
  assert.match(await project(rootGradle), /classpath\('org.jetbrains.kotlin:kotlin-gradle-plugin:2\.3\.20'\)/);
});

test('pins the actual root KGP classpath, preserving the rest of Expo generated Gradle', async () => {
  assert.equal(await project(rootGradle), rootGradle.replace(original, pinned));
});

test('repairs an old explicit KGP version and is idempotent for a correct declaration', async () => {
  const correct = rootGradle.replace(original, pinned);
  for (const previous of ['2.1.20', '2.4.0']) {
    assert.equal(await project(correct.replace(':2.3.20', `:${previous}`)), correct);
  }
  assert.equal(await project(correct), correct);
  assert.equal(await project(await project(rootGradle)), correct);
});

test('supports double quotes and Groovy classpath without parentheses', async () => {
  for (const declaration of ['classpath("org.jetbrains.kotlin:kotlin-gradle-plugin")', "classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:2.1.20'"]) {
    const input = rootGradle.replace(original, declaration);
    assert.equal(await project(input), input.replace(/kotlin-gradle-plugin(?::2.1.20)?/, 'kotlin-gradle-plugin:2.3.20'));
  }
});

test('inserts a missing KGP declaration once inside buildscript dependencies', async () => {
  const input = rootGradle.replace(`    ${original}\n`, '');
  const result = await project(input);
  assert.match(result, /dependencies \{\n    classpath\('org.jetbrains.kotlin:kotlin-gradle-plugin:2.3.20'\)/);
  assert.equal(result.replace(`    ${pinned}\n`, ''), input);
  assert.equal(await project(result), result);
});

test('leaves comments and KGP declarations outside root buildscript untouched', async () => {
  const comment = `    // ${original}\n`;
  const outside = `\nsubprojects { buildscript { dependencies { ${original} } } }\n`;
  const input = rootGradle.replace(`    ${original}`, `${comment}    ${original}`) + outside;
  const result = await project(input);
  assert.equal(result, rootGradle.replace(`    ${original}`, `${comment}    ${pinned}`) + outside);
});

test('preserves CRLF when inserting a missing declaration', async () => {
  const input = rootGradle.replace(`    ${original}\n`, '').replaceAll('\n', '\r\n');
  const result = await project(input);
  assert.equal(result.replace(`    ${pinned}\r\n`, ''), input);
  assert.equal(await project(result), result);
});

test('fails clearly for an unsupported language or root template', async () => {
  await assert.rejects(project(rootGradle, 'kotlin'), /Groovy/);
  await assert.rejects(project('allprojects { repositories { google() } }'), /buildscript/);
});

test('keeps the Expo Kotlin catalog override aligned without duplicating properties', async () => {
  const untouched = { type: 'property', key: 'unrelated', value: 'keep' };
  const input = [untouched, { type: 'property', key: 'android.kotlinVersion', value: '2.1.20' }];
  const result = await applyMod('gradleProperties', input);
  assert.deepEqual(result, [untouched, { type: 'property', key: 'android.kotlinVersion', value: '2.3.20' }]);
  assert.deepEqual(await applyMod('gradleProperties', result), result);
});
