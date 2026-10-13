import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenHarness } from './helpers/component-harness.mjs';

const sourceKey = 'bilipop.sourceLanguage.v1';
const targetKey = 'bilipop.targetLanguage.v1';
const options = (h, kind) => h.root().findByProps({ testID: `${kind}-language-selector` }).findAllByType('Pressable');
const selected = (h, kind) => options(h, kind).find(node => node.props.accessibilityState.selected).props.testID.replace(`${kind}-language-`, '');

test('both visible language lists are alphabetical by displayed name', async () => {
  const h = await screenHarness(); await h.mount();
  try {
    for (const kind of ['source', 'target']) {
      const names = options(h, kind).map(node => node.findByType('Text').children.join(''));
      assert.equal(names.length, 38);
      assert.deepEqual(names, [...names].sort());
      assert.equal(names[0], 'Arabic');
    }
  } finally { await h.unmount(); }
});

test('first launch defaults to English input and first alphabetical output without initialization writes', async () => {
  const h = await screenHarness({}, { holdStatus: true }); await h.mount();
  try {
    assert.equal(selected(h, 'source'), 'en');
    assert.equal(selected(h, 'target'), 'ar');
    assert.deepEqual(h.writes, []);
    await h.resolveStatus();
    assert.deepEqual(h.writes, []);
  } finally { await h.unmount(); }
});

test('saved choices survive initialization and late model status without default writeback', async () => {
  const h = await screenHarness({ [sourceKey]: 'ja', [targetKey]: 'fr' }, { holdStatus: true }); await h.mount();
  try {
    assert.equal(selected(h, 'source'), 'ja'); assert.equal(selected(h, 'target'), 'fr');
    await h.selectLanguage('source', 'de');
    await h.resolveStatus();
    assert.equal(selected(h, 'source'), 'de'); assert.equal(selected(h, 'target'), 'fr');
    assert.deepEqual(h.writes, [[sourceKey, 'de']]);
    assert.equal(h.values.get(targetKey), 'fr');
  } finally { await h.unmount(); }
});

for (const [source, target, expectedSource, expectedTarget] of [
  [null, null, 'en', 'ar'], ['invalid', 'invalid', 'en', 'ar'],
  ['ja', null, 'ja', 'ar'], [null, 'fr', 'en', 'fr'],
  ['', 'fr', 'en', 'fr'], ['de', '', 'de', 'ar'], ['ar', 'ar', 'ar', 'ar'],
]) test(`missing/invalid saved values fall back independently: ${source}/${target}`, async () => {
  const initial = Object.fromEntries([[sourceKey, source], [targetKey, target]].filter(([, value]) => value !== null));
  const h = await screenHarness(initial); await h.mount();
  try {
    assert.equal(selected(h, 'source'), expectedSource); assert.equal(selected(h, 'target'), expectedTarget);
    assert.deepEqual(h.writes, []);
  } finally { await h.unmount(); }
});

test('each choice is saved immediately and restored after close and a fresh screen instance', async () => {
  const first = await screenHarness(); await first.mount();
  await first.selectLanguage('target', 'uk');
  assert.deepEqual(first.writes, [[targetKey, 'uk']]);
  assert.equal(selected(first, 'source'), 'en');
  await first.selectLanguage('source', 'ja');
  assert.deepEqual(first.writes, [[targetKey, 'uk'], [sourceKey, 'ja']]);
  assert.equal(selected(first, 'target'), 'uk');
  await first.unmount();
  const relaunched = await screenHarness(Object.fromEntries(first.values)); await relaunched.mount();
  try {
    assert.equal(selected(relaunched, 'source'), 'ja'); assert.equal(selected(relaunched, 'target'), 'uk');
    assert.deepEqual(relaunched.writes, []);
    assert.ok(relaunched.reads.includes(sourceKey)); assert.ok(relaunched.reads.includes(targetKey));
  } finally { await relaunched.unmount(); }
});


test('native storage adapter saves selections under the same durable keys and restores on remount', async () => {
  // Expo's installation side effect is the platform boundary; production adapter
  // functions, React state, selector events and exact storage keys execute here.
  const h = await screenHarness({ [sourceKey]: 'fr', [targetKey]: 'ja' }, { nativeStorage: true });
  await h.mount();
  try {
    assert.equal(selected(h, 'source'), 'fr'); assert.equal(selected(h, 'target'), 'ja');
    assert.deepEqual(h.writes, []);
    await h.selectLanguage('target', 'de');
    assert.deepEqual(h.writes, [[targetKey, 'de']]);
    await h.unmount(); await h.mount();
    assert.equal(selected(h, 'source'), 'fr'); assert.equal(selected(h, 'target'), 'de');
  } finally { await h.unmount(); }
});

test('unreadable language preferences are never overwritten by startup defaults', async () => {
  const h = await screenHarness({ [sourceKey]: 'fr', [targetKey]: 'ja' });
  h.readFailures.add(sourceKey); h.readFailures.add(targetKey); await h.mount();
  try {
    assert.equal(selected(h, 'source'), 'en'); assert.equal(selected(h, 'target'), 'ar');
    assert.deepEqual(h.writes, []);
    assert.equal(h.values.get(sourceKey), 'fr'); assert.equal(h.values.get(targetKey), 'ja');
    assert.match(h.snapshot().alerts.join(' '), /saved language choices/);
  } finally { await h.unmount(); }
});
