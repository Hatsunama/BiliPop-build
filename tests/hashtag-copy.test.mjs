import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenHarness } from './helpers/component-harness.mjs';

const D = 'bilipop.draft.v1', R = 'bilipop.result.v1';
const settle = async (h, job, text) => h.act(() => job.resolve(text));

// Executes production screen handlers, parser, translator orchestration and
// persistence code. Inference and the native clipboard are mocked boundaries.
test('generated hashtags stay ordinary through display, save, repeated copy and relaunch', async () => {
  const source = 'happy day #day #happy';
  const expected = 'happy day\n\n#day #happy';
  const h = await screenHarness({ [D]: source }); await h.mount();
  try {
    await h.press('POP IT!');
    for (const [i, text] of ['happy day', 'day', 'happy'].entries()) {
      assert.equal(h.calls[i].text, text);
      await settle(h, h.calls[i], text);
    }
    assert.equal(h.snapshot().output, expected);
    assert.equal(h.values.get(R), expected);
    assert.equal(h.values.get(D), source);
    await h.press('COPY TEXT + TAGS'); await h.press('COPIED!');
    assert.deepEqual(h.copies.map((copy) => copy.text), [expected, expected]);
    assert.equal(h.snapshot().copied, true);
    assert.equal(h.snapshot().output, expected);
    await h.unmount(); await h.mount();
    assert.equal(h.snapshot().output, expected);
    assert.equal(h.snapshot().copied, false);
    await h.press('COPY TEXT + TAGS');
    assert.equal(h.copies[2].text, expected);
  } finally { await h.unmount(); }
});

test('copy uses the exact editable text, including manual hashes, URLs and paragraph breaks', async () => {
  const legacy = '旧稿\n\n#day##happy#';
  const edited = 'C# notes\n\nhttps://example.com/#day\n\n#day #happy\n## manual heading';
  const h = await screenHarness({ [R]: legacy }); await h.mount();
  try {
    // Opening an old saved draft never silently edits the user's work.
    assert.equal(h.snapshot().output, legacy);
    assert.equal(h.writes.length, 0);
    await h.edit('translated-output', edited);
    await h.press('COPY TEXT + TAGS'); await h.press('COPIED!');
    assert.deepEqual(h.copies.map((copy) => copy.text), [edited, edited]);
    assert.equal(h.values.get(R), edited);
    await h.unmount(); await h.mount();
    assert.equal(h.snapshot().output, edited);
  } finally { await h.unmount(); }
});

test('hashtag edits invalidate pending copy status and latest copy failure stays visible', async () => {
  const old = 'happy day\n\n#day #happy', edited = 'happy day\n\n#day #joy';
  const h = await screenHarness({ [R]: old }); h.holdCopy(true); await h.mount();
  try {
    await h.press('COPY TEXT + TAGS');
    await h.edit('translated-output', edited);
    await h.press('COPY TEXT + TAGS');
    await settle(h, h.copies[0]);
    assert.equal(h.snapshot().copied, false);
    await h.act(() => h.copies[1].reject(Error('clipboard unavailable')));
    assert.equal(h.snapshot().copied, false);
    assert.match(h.snapshot().alerts.join(), /Could not copy/);
    assert.equal(h.snapshot().output, edited);
    await h.press('COPY TEXT + TAGS'); await settle(h, h.copies[2]);
    assert.equal(h.snapshot().copied, true);
    assert.deepEqual(h.copies.map((copy) => copy.text), [old, edited, edited]);
  } finally { await h.unmount(); }
});

test('cancelling tag translation cannot replace or reformat the last saved editable output', async () => {
  const saved = 'My edit\n\n#happy #day';
  const h = await screenHarness({ [D]: 'happy day #day #happy', [R]: saved }); await h.mount();
  try {
    await h.press('POP IT!'); await settle(h, h.calls[0], 'happy day');
    assert.equal(h.calls[1].text, 'day');
    await h.press('Cancel'); await settle(h, h.calls[1], '#过期#');
    assert.equal(h.calls.length, 2, 'Cancelled request never translates the next tag');
    assert.equal(h.snapshot().output, saved);
    assert.equal(h.values.get(R), saved);
    await h.press('COPY TEXT + TAGS');
    assert.equal(h.copies[0].text, saved);
  } finally { await h.unmount(); }
});
