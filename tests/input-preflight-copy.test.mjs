import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenHarness } from './helpers/component-harness.mjs';

for (const [input, message] of [['a'.repeat(4001), /4,000/], [Array.from({ length: 31 }, (_, index) => `#tag${index}`).join(' '), /30 hashtags/]]) {
  test(`invalid input is rejected before native model loading (${message})`, async () => {
    const h = await screenHarness({ 'bilipop.draft.v1': input, 'bilipop.result.v1': 'Last good result' });
    h.holdLoad(true); await h.mount();
    try {
      await h.press('POP IT!');
      assert.equal(h.loads.length, 0);
      assert.match(h.snapshot().alerts.join('\n'), message);
      assert.equal(h.snapshot().output, 'Last good result');
      assert.equal(h.snapshot().draft, input);
      assert.equal(h.snapshot().busy, false);
    } finally { await h.unmount(); }
  });
}

test('repeated copy clears old success while pending and after the latest failure', async () => {
  const h = await screenHarness({ 'bilipop.result.v1': 'Last good result' }); await h.mount();
  try {
    await h.press('COPY TEXT + TAGS'); assert.equal(h.snapshot().copied, true);
    h.holdCopy(true); await h.press('COPIED!');
    assert.equal(h.snapshot().copied, false);
    await h.act(() => h.copies.at(-1).reject(Error('Clipboard unavailable')));
    assert.equal(h.snapshot().copied, false);
    assert.match(h.snapshot().alerts.join('\n'), /Could not copy/);
  } finally { await h.unmount(); }
});

test('an older clipboard completion cannot override a newer failed copy', async () => {
  const h = await screenHarness({ 'bilipop.result.v1': 'Last good result' }); await h.mount();
  try {
    h.holdCopy(true); await h.press('COPY TEXT + TAGS'); await h.press('COPY TEXT + TAGS');
    await h.act(() => h.copies[1].reject(Error('Clipboard unavailable')));
    await h.act(() => h.copies[0].resolve());
    assert.equal(h.snapshot().copied, false);
    assert.match(h.snapshot().alerts.join('\n'), /Could not copy/);
  } finally { await h.unmount(); }
});

test('successful copy recovery removes its error without removing input or storage errors', async () => {
  const h = await screenHarness({ 'bilipop.result.v1': 'Last good result' }); await h.mount();
  try {
    h.holdCopy(true); await h.press('COPY TEXT + TAGS');
    await h.act(() => h.copies.at(-1).reject(Error('Clipboard unavailable')));
    assert.match(h.snapshot().alerts.join('\n'), /Could not copy/);
    h.writeFailures.add('bilipop.draft.v1');
    await h.edit('source-input', 'a'.repeat(4001));
    await h.press('POP IT!');
    assert.match(h.snapshot().alerts.join('\n'), /4,000/);
    h.holdCopy(false); await h.press('COPY TEXT + TAGS');
    assert.equal(h.snapshot().copied, true);
    assert.doesNotMatch(h.snapshot().alerts.join('\n'), /Could not copy/);
    assert.match(h.snapshot().alerts.join('\n'), /4,000/);
    assert.match(h.snapshot().alerts.join('\n'), /Local saving failed/);
  } finally { await h.unmount(); }
});

test('successful retry clears the prior clipboard failure', async () => {
  const h = await screenHarness({ 'bilipop.result.v1': 'Last good result' }); await h.mount();
  try {
    h.holdCopy(true); await h.press('COPY TEXT + TAGS');
    await h.act(() => h.copies.at(-1).reject(Error('Clipboard unavailable')));
    h.holdCopy(false); await h.press('COPY TEXT + TAGS');
    assert.equal(h.snapshot().copied, true);
    assert.doesNotMatch(h.snapshot().alerts.join('\n'), /Could not copy/);
  } finally { await h.unmount(); }
});
