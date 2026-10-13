import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translatePost } from './translate-post';

for (const url of ['https://example.com/#标签。后半', 'https://example.com/你好。世界', 'https://example.com/a！b?q=3', 'https://example.com/路？径#锚！点']) {
  test(`full URL survives sentence segmentation: ${url}`, async () => {
    const calls: string[] = [];
    const result = await translatePost(`Read ${url}`, { translate: async text => { calls.push(text); return '已翻译'; } });
    assert.equal(result.description, `已翻译 ${url}`);
    assert.deepEqual(calls, ['Read']);
  });
}

test('repeated URLs and neighboring prose preserve spans, whitespace, sentence calls and completed progress', async () => {
  const url = 'https://example.com/#标签。后半';
  const calls: string[] = [], progress: { completed: number; total: number }[] = [];
  const result = await translatePost(`Read ${url}\n\nNext sentence.  More ${url} now.`, {
    translate: async text => { calls.push(text); return `[${text}]`; },
  }, { onProgress: value => progress.push(value) });
  assert.equal(result.description, `[Read] ${url}\n\n[Next sentence.]  [More] ${url} [now.]`);
  assert.deepEqual(calls, ['Read', 'Next sentence.', 'More', 'now.']);
  assert.deepEqual(progress, [{ completed: 0, total: 3 }, { completed: 1, total: 3 }, { completed: 2, total: 3 }, { completed: 3, total: 3 }]);
});

test('ordinary CJK and Latin prose still split at original sentence boundaries', async () => {
  const calls: string[] = [];
  const result = await translatePost('你好。世界！ 再见？\nHello.  Again!', { translate: async text => { calls.push(text); return text; } });
  assert.deepEqual(calls, ['你好。', '世界！', '再见？', 'Hello.', 'Again!']);
  assert.equal(result.description, '你好。世界！ 再见？\nHello.  Again!');
});
