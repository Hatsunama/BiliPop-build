import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the app permits device orientation changes rather than locking the scrollable UI to portrait', () => {
  const { expo } = JSON.parse(readFileSync('app.json', 'utf8'));
  assert.equal(expo.orientation, 'default');
  assert.equal(expo.android.package, 'app.bilipop');
  assert.equal(expo.android.versionCode, 3);
});
