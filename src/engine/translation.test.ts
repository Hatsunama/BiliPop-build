import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { formatBilibiliCaption, parseEnglishPost } from './parse-post';
import { translatePost, translateUnit, tagToWords } from './translate-post';

describe('caption and hashtag parsing', () => {
  it('preserves URLs, code notation and Unicode while removing actual hashtags', () => {
    const p = parseEnglishPost('C# and https://example.com/#AI\n#AI #人工智能# #AIArt');
    assert.equal(p.body, 'C# and https://example.com/#AI');
    assert.deepEqual(p.hashtags, ['AI', '人工智能', 'AIArt']);
  });
  it('deduplicates without dropping short tags', () => {
    assert.deepEqual(parseEnglishPost('#AI #ai #ML #3D').hashtags, ['AI', 'ML', '3D']);
  });
  it('accepts adjacent closing-hash tags and fullwidth hashes', () => {
    assert.deepEqual(parseEnglishPost('#人工智能##动画# ＃AI').hashtags, ['人工智能', '动画', 'AI']);
  });
  it('formats caption-only, tag-only and combined output', () => {
    assert.equal(formatBilibiliCaption('', ['人工智能']), '#人工智能');
    assert.equal(formatBilibiliCaption('你好', []), '你好');
    assert.equal(formatBilibiliCaption('你好', ['动画']), '你好\n\n#动画');
  });
  it('expands acronym, camelCase and underscore hashtags before translation', () => {
    assert.equal(tagToWords('AIArt'), 'AI art');
    assert.equal(tagToWords('MachineLearning'), 'machine learning');
    assert.equal(tagToWords('textToImage'), 'text to image');
    assert.equal(tagToWords('my_new_video'), 'my new video');
  });
});

describe('local translation contract', () => {
  it('translates caption sentences AND every hashtag', async () => {
    const calls: string[] = [];
    const result = await translatePost('Hello world.\n\n#animation #music', {
      translate: async (text) => {
        calls.push(text);
        return ({ 'Hello world.': '你好，世界。', animation: '动画', music: '音乐' })[text] ?? text;
      },
    });
    assert.deepEqual(calls, ['Hello world.', 'animation', 'music']);
    assert.equal(result.caption, '你好，世界。\n\n#动画 #音乐');
    assert.equal('videosScanned' in result, false);
  });
  it('supports captions without hashtags', async () => {
    const result = await translatePost('Hello.', { translate: async () => '你好。' });
    assert.equal(result.caption, '你好。');
    assert.deepEqual(result.tags, []);
  });
  it('routes Chinese source through the selected language pair', async () => {
    const result = await translatePost('你好\n#动画#', { translate: async (text) => text === '你好' ? 'Hello' : 'animation' }, { sourceLanguage: 'zh', targetLanguage: 'en' });
    assert.equal(result.caption, 'Hello\n\n#animation');
  });
  it('uses the model for short English tags after phrase expansion', async () => {
    const result = await translatePost('#AI #machinelearning #shortfilm #matcha', { translate: async (text) => ({ 'artificial intelligence': '人工智能', 'machine learning': '机器学习', 'short film': '短片', matcha: '抹茶' })[text] ?? text });
    assert.deepEqual(result.tags.map((t) => t.translated), ['人工智能', '机器学习', '短片', '抹茶']);
  });
  it('preserves links and emojis without passing them through the model', async () => {
    const source = 'I made 3 matcha drinks 😃 https://example.com/a';
    const result = await translateUnit(source, { translate: async (text) => text }, {});
    assert.equal(result, source);
  });
  it('flags changed numbers for explicit review', async () => {
    const result = await translatePost('I made 3 matcha drinks.', { translate: async () => '我做了饮料。' });
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings.join(' '), /numbers/);
  });
  it('keeps mixed scripts together while protecting flags and keycap emoji', async () => {
    const calls: string[] = [];
    const source = 'Hello 你好 🇨🇳 1️⃣ world';
    const result = await translateUnit(source, { translate: async (text) => { calls.push(text); return text === 'Hello 你好' ? '嗨 你好' : '世界'; } }, {});
    assert.equal(result, '嗨 你好 🇨🇳 1️⃣ 世界');
    assert.deepEqual(calls, ['Hello 你好', 'world']);
  });
  it('does not silently discard a caption when a provider returns blank output', async () => {
    await assert.rejects(() => translatePost('Hello', { translate: async () => '  ' }), /original is retained/);
  });
  it('stops within a protected-text unit after cancellation', async () => {
    const controller = new AbortController();
    let calls = 0;
    await assert.rejects(() => translateUnit('Hello 😃 world', { translate: async () => {
      calls++; controller.abort(); return '你好';
    } }, { signal: controller.signal }), /cancelled/);
    assert.equal(calls, 1);
  });
  it('recovers on a new request after a failed or cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    const model = { translate: async () => '你好' };
    await assert.rejects(() => translatePost('Hello', model, { signal: controller.signal }), /cancelled/);
    await assert.rejects(() => translatePost('Hello', { translate: async () => { throw new Error('temporary failure'); } }), /temporary failure/);
    assert.equal((await translatePost('Hello', model)).caption, '你好');
  });
  it('returns a real model failure, never a dictionary caption fallback', async () => {
    await assert.rejects(() => translatePost('Write a whole caption.', { translate: async () => { throw Error('model unavailable'); } }), /model unavailable/);
  });
  it('reports completion and honors cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() => translatePost('Hello', { translate: async () => '你好' }, { signal: controller.signal }), /cancelled/);
    const updates: number[] = [];
    await translatePost('Hello #AI', { translate: async () => '你好' }, { onProgress: ({ completed }) => updates.push(completed) });
    assert.deepEqual(updates, [0, 1, 2]);
  });
  it('does not truncate oversized inputs', async () => {
    await assert.rejects(() => translatePost('a'.repeat(4001), { translate: async () => 'a' }), /not been cut/);
    await assert.rejects(() => translatePost('', { translate: async () => '' }), /Paste/);
  });
});

describe('offline release policy', () => {
  it('permits explicit model setup while blocking backup and remote updates', () => {
    const { expo } = JSON.parse(readFileSync('app.json', 'utf8'));
    assert.equal(expo.android.allowBackup, false);
    assert.ok(!expo.android.blockedPermissions.includes('android.permission.INTERNET'));
    assert.ok(expo.android.permissions.includes('android.permission.INTERNET'));
    assert.ok(expo.android.blockedPermissions.includes('android.permission.RECORD_AUDIO'));
    assert.equal(expo.updates.enabled, false);
  });
  it('has no old scraping/ranking engine or runtime API URLs', () => {
    const files = readdirSync('src/engine');
    for (const name of ['bilibili.ts', 'topic-brain.ts', 'tag-ranker.ts', 'dictionary.ts']) assert.ok(!files.includes(name));
    for (const file of files.filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))) {
      assert.doesNotMatch(readFileSync(`src/engine/${file}`, 'utf8'), /\bfetch\s*\(|XMLHttpRequest|api\.bilibili/);
    }
  });
});

