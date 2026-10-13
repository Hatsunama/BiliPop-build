import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { unsignedReleaseGradle } from '../../scripts/release-config.mjs';

describe('canonical background provenance', () => {
  it('keeps the renderer and seed byte-identical to the source repository', () => {
    const hashes = {
      'RefractBackgroundView.kt': '260eb62e4aa86ca64a0e7b680fb0f6faeab69868',
      'RefractSeed.kt': '31f085a7c9f197bed88b3ff6dde9ed23f4b9b068',
    };
    for (const [file, hash] of Object.entries(hashes)) {
      const data = readFileSync(`modules/my-module/android/src/main/java/com/hatsunama/refract/${file}`);
      assert.equal(createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex'), hash);
    }
  });
  it('registers the native bridge without removing the existing translator', () => {
    const { android } = JSON.parse(readFileSync('modules/my-module/expo-module.config.json', 'utf8'));
    assert.deepEqual(android.modules, ['app.bilipop.translation.BiliPopTranslationModule', 'app.bilipop.translation.BiliPopBackgroundModule']);
  });
});

describe('unsigned release preparation', () => {
  it('removes the generated release debug signature only', () => {
    const source = 'buildTypes { debug { signingConfig signingConfigs.debug } release { signingConfig signingConfigs.debug } }';
    assert.equal(unsignedReleaseGradle(source), 'buildTypes { debug { signingConfig signingConfigs.debug } release { signingConfig null } }');
  });
  it('refuses an existing private signing assignment or unknown template', () => {
    assert.throws(() => unsignedReleaseGradle('release { signingConfig signingConfigs.production }'), /Inspect/);
    assert.throws(() => unsignedReleaseGradle('release { } debug { signingConfig signingConfigs.debug }'), /Inspect/);
    assert.throws(() => unsignedReleaseGradle('release { signingConfig null }'), /Inspect/);
  });
  it('preserves production identity and isolates QA through configuration', async () => {
    const { default: config } = await import('../../app.config.js');
    const previous = process.env.BILIPOP_QA;
    try {
      process.env.BILIPOP_QA = '0';
      assert.equal(config().android.package, 'app.bilipop');
      assert.equal(config().android.versionCode, 3);
      process.env.BILIPOP_QA = '1';
      assert.equal(config().android.package, 'app.bilipop.qa');
    } finally {
      if (previous === undefined) delete process.env.BILIPOP_QA;
      else process.env.BILIPOP_QA = previous;
    }
  });
});
