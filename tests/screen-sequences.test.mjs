import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenHarness } from './helpers/component-harness.mjs';
const D = 'bilipop.draft.v1', R = 'bilipop.result.v1';
const settle = async (h, job, text) => h.act(() => job.resolve(text));
const fail = async (h, job, message) => h.act(() => job.reject(Error(message)));

test('cumulative real screen flow: translate, edit, copy, replace, fail, cancel, retry, relaunch', async () => {
  const h = await screenHarness(); await h.mount();
  try {
    await h.edit('source-input', 'Hello #AI');
    await h.press('POP IT!');
    assert.equal(h.calls[0].text, 'Hello');
    await settle(h, h.calls[0], '你好');
    assert.equal(h.calls[1].text, 'artificial intelligence');
    assert.equal(h.calls[1].sourceLanguage, 'en'); assert.equal(h.calls[1].targetLanguage, 'zh');
    await settle(h, h.calls[1], '人工智能');
    assert.equal(h.snapshot().output, '你好\n\n#人工智能');
    await h.edit('translated-output', '你好，手工校对\n\n#人工智能#');
    await h.press('COPY TEXT + TAGS');
    assert.equal(h.copies[0].text, '你好，手工校对\n\n#人工智能#');
    assert.equal(h.snapshot().copied, true);
    await h.edit('source-input', 'A new caption');
    await h.press('POP IT!');
    await fail(h, h.calls[2], 'Controlled model failure');
    assert.equal(h.snapshot().output, '你好，手工校对\n\n#人工智能#');
    assert.match(h.snapshot().alerts.join(), /Controlled model failure/);
    await h.press('POP IT!'); await h.press('Cancel');
    assert.equal(h.snapshot().busy, false, 'Cancel releases editing without waiting for model completion');
    await h.edit('source-input', 'Fresh caption');
    await h.press('POP IT!');
    await settle(h, h.calls[3], '取消后过期结果');
    assert.equal(h.snapshot().busy, true, 'Old request cannot clear the retry busy flag');
    assert.equal(h.snapshot().output, '你好，手工校对\n\n#人工智能#');
    await settle(h, h.calls[4], '新文案');
    assert.equal(h.snapshot().output, '新文案');
    await h.unmount(); await h.mount();
    assert.equal(h.snapshot().draft, 'Fresh caption');
    assert.equal(h.snapshot().output, '新文案');
  } finally { await h.unmount(); }
});

test('rapid POP and Cancel, cancelled model loading, late failure and unmount have no stale effects', async () => {
  const h = await screenHarness({ [D]: 'Caption', [R]: '已保存' }); h.holdLoad(true); await h.mount();
  try {
    await h.burst('POP IT!', 'POP IT!', 'POP IT!');
    assert.equal(h.loads.length, 1, 'Synchronous request ownership prevents double submission');
    await h.burst('Cancel', 'Cancel');
    assert.equal(h.snapshot().busy, false);
    await h.press('POP IT!');
    await fail(h, h.loads[0], 'Stale load error');
    assert.equal(h.snapshot().busy, true); assert.deepEqual(h.snapshot().alerts, []);
    await settle(h, h.loads[1], h.model);
    assert.equal(h.calls.length, 1);
    const writesBefore = h.writes.length;
    await h.unmount(); await settle(h, h.calls[0], '卸载之后');
    assert.equal(h.writes.length, writesBefore, 'Unmounted results never persist');
    await h.mount(); assert.equal(h.snapshot().output, '已保存');
  } finally { await h.unmount(); }
});

test('one failed field read must not hide another successfully stored field', async () => {
  for (const failedKey of [D, R]) {
    const h = await screenHarness({ [D]: 'Saved draft', [R]: '保存的输出' });
    h.readFailures.add(failedKey); await h.mount();
    try {
      assert.equal(h.snapshot().draft, failedKey === D ? '' : 'Saved draft');
      assert.equal(h.snapshot().output, failedKey === R ? '' : '保存的输出');
      assert.match(h.snapshot().alerts.join(), /Could not open local/);
      assert.equal(h.writes.length, 0, 'Loading never deletes inaccessible data');
      h.readFailures.clear(); await h.unmount(); await h.mount();
      assert.equal(h.snapshot().draft, 'Saved draft'); assert.equal(h.snapshot().output, '保存的输出');
      assert.deepEqual(h.snapshot().alerts, []);
    } finally { await h.unmount(); }
  }
});

test('failed output save stays warned after a successful draft save, then recovers on retry', async () => {
  const h = await screenHarness({ [D]: 'Old', [R]: '之前保存' }); await h.mount();
  try {
    h.writeFailures.add(R); await h.edit('translated-output', '未保存的校对');
    assert.match(h.snapshot().alerts.join(), /Local saving failed/);
    await h.edit('source-input', 'Replacement');
    assert.match(h.snapshot().alerts.join(), /Local saving failed/, 'An unrelated successful write cannot declare all fields saved');
    assert.equal(h.values.get(R), '之前保存');
    h.writeFailures.delete(R); await h.edit('translated-output', '恢复保存的校对');
    assert.deepEqual(h.snapshot().alerts, []);
    await h.unmount(); await h.mount();
    assert.equal(h.snapshot().draft, 'Replacement'); assert.equal(h.snapshot().output, '恢复保存的校对');
  } finally { await h.unmount(); }
});

test('late clipboard success cannot claim an edited output was copied', async () => {
  const h = await screenHarness({ [R]: '旧输出' }); h.holdCopy(true); await h.mount();
  try {
    await h.press('COPY TEXT + TAGS'); await h.edit('translated-output', '新的手工校对');
    await settle(h, h.copies[0]);
    assert.equal(h.copies[0].text, '旧输出'); assert.equal(h.snapshot().copied, false);
    await h.press('COPY TEXT + TAGS'); await settle(h, h.copies[1]);
    assert.equal(h.snapshot().copied, true);
  } finally { await h.unmount(); }
});

test('cancel after result resolution but before its continuation never publishes stale output', async () => {
  const h = await screenHarness({ [D]: 'Hello', [R]: '保留手工编辑' }); await h.mount();
  try {
    await h.press('POP IT!');
    await h.act(() => {
      h.calls[0].resolve('过期文本');
      const cancel = h.root().findAllByType('Pressable').find((node) => node.findAllByType('Text').some((text) => text.props.children === 'Cancel'));
      cancel.props.onPress();
    });
    assert.equal(h.snapshot().busy, false); assert.equal(h.snapshot().output, '保留手工编辑');
    assert.equal(h.values.get(R), '保留手工编辑');
  } finally { await h.unmount(); }
});

test('a cancelled model load cannot start inference when it resolves after a retry', async () => {
  const h = await screenHarness({ [D]: 'Hello', [R]: '已校对' }); h.holdLoad(true); await h.mount();
  try {
    await h.press('POP IT!'); await h.press('Cancel'); await h.press('POP IT!');
    await settle(h, h.loads[0], h.model);
    assert.equal(h.calls.length, 0); assert.equal(h.snapshot().busy, true);
    assert.deepEqual(h.snapshot().progress, ['Loading the downloaded translation model…']);
    await settle(h, h.loads[1], h.model); assert.equal(h.calls.length, 1);
    await settle(h, h.calls[0], '你好'); assert.equal(h.snapshot().output, '你好');
  } finally { await h.unmount(); }
});

test('partial body/tag progress never replaces the last good edit until the entire post succeeds', async () => {
  const h = await screenHarness({ [D]: 'Hello. Welcome!\n\n#Moon #AI', [R]: '上一次的手工校对' }); await h.mount();
  try {
    await h.press('POP IT!');
    assert.equal(h.calls[0].text, 'Hello.'); await settle(h, h.calls[0], '你好。');
    assert.deepEqual(h.snapshot().progress, ['Translating on your phone: 1 / 4']);
    assert.equal(h.calls[1].text, 'Welcome!'); await settle(h, h.calls[1], '欢迎！');
    assert.deepEqual(h.snapshot().progress, ['Translating on your phone: 2 / 4']);
    assert.equal(h.calls[2].text, 'Moon'); await fail(h, h.calls[2], 'Tag inference failed');
    assert.equal(h.snapshot().output, '上一次的手工校对'); assert.equal(h.values.get(R), '上一次的手工校对');
    await h.press('POP IT!');
    await settle(h, h.calls[3], '你好。'); await settle(h, h.calls[4], '欢迎！');
    await h.press('Cancel'); await settle(h, h.calls[5], '过期标签');
    assert.equal(h.snapshot().output, '上一次的手工校对');
    await h.press('POP IT!');
    await settle(h, h.calls[6], '你好。'); await settle(h, h.calls[7], '欢迎！'); await settle(h, h.calls[8], '月亮');
    assert.equal(h.calls[9].text, 'artificial intelligence');
    assert.equal(h.snapshot().output, '上一次的手工校对', 'Every hashtag must finish before publication');
    assert.deepEqual(h.snapshot().progress, ['Translating on your phone: 3 / 4']);
    await settle(h, h.calls[9], '人工智能');
    assert.equal(h.snapshot().output, '你好。 欢迎！\n\n#月亮 #人工智能');
    await h.press('COPY TEXT + TAGS'); assert.equal(h.copies[0].text, '你好。 欢迎！\n\n#月亮 #人工智能');
    assert.equal(h.snapshot().draft, 'Hello. Welcome!\n\n#Moon #AI');
    await h.unmount(); await h.mount(); assert.equal(h.snapshot().output, '你好。 欢迎！\n\n#月亮 #人工智能');
  } finally { await h.unmount(); }
});
