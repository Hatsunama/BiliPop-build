import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatBilibiliCaption, parseEnglishPost } from './parse-post';
import { translatePost } from './translate-post';

const identityModel = { translate: async (text: string) => text };

describe('ordinary social hashtag formatting', () => {
  it('adds one opening hash per tag and a space between tags', () => {
    assert.equal(formatBilibiliCaption('happy day', ['day', 'happy']), 'happy day\n\n#day #happy');
    assert.equal(formatBilibiliCaption('', ['day']), '#day');
    assert.equal(formatBilibiliCaption('', []), '');
    assert.equal(formatBilibiliCaption('body only', []), 'body only');
  });

  it('reproduces the reported caption without adding closing or adjacent hashes', async () => {
    const result = await translatePost('happy day #day #happy', identityModel);
    assert.equal(result.description, 'happy day');
    assert.deepEqual(result.tags, [
      { original: 'day', translated: 'day' }, { original: 'happy', translated: 'happy' },
    ]);
    assert.equal(result.caption, 'happy day\n\n#day #happy');
  });

  for (const input of ['#day #happy', '#day#happy', '#day##happy#', '＃day＃happy', '＃day＃＃happy＃']) {
    it(`retains both tag meanings from existing/adjacent hashes: ${input}`, async () => {
      assert.deepEqual(parseEnglishPost(input), { body: '', hashtags: ['day', 'happy'] });
      const result = await translatePost(input, identityModel);
      assert.equal(result.caption, '#day #happy');
      // Pasting generated output back into the parser is stable, including a
      // duplicate first tag immediately followed by the next tag.
      assert.deepEqual(parseEnglishPost(result.caption), { body: '', hashtags: ['day', 'happy'] });
      assert.deepEqual(parseEnglishPost('#day#DAY#happy'), { body: '', hashtags: ['day', 'happy'] });
    });
  }

  it('retains mixed Unicode spelling and deduplicates source and translated tags', async () => {
    const input = '#cafe\u0301 ＃你好_world #नमस्ते #東京 #CAFÉ';
    const result = await translatePost(input, identityModel);
    assert.deepEqual(result.tags.map((tag) => tag.original), ['cafe\u0301', '你好_world', 'नमस्ते', '東京']);
    assert.equal(result.caption, '#café #你好world #नमस्ते #東京');
    const merged = await translatePost('#day #happy', { translate: async () => '美好' });
    assert.deepEqual(merged.tags.map((tag) => tag.original), ['day', 'happy']);
    assert.equal(merged.caption, '#美好');
  });

  it('does not rewrite body hashes, code notation, paragraphs or protected URL fragments', async () => {
    const body = 'C# stays.\n\nRead https://example.com/Ａ?x=1&#day and HTTPS://example.com/#happy';
    assert.equal(formatBilibiliCaption(body, ['day', 'happy']), `${body}\n\n#day #happy`);
    const result = await translatePost(`${body}\n\n#day #happy`, identityModel);
    assert.equal(result.description, body);
    assert.equal(result.caption, `${body}\n\n#day #happy`);
    assert.deepEqual(parseEnglishPost('C# code_word#tag /#path #123'), {
      body: 'C# code_word#tag /#path #123', hashtags: [],
    });
  });

  it('gives complete URLs precedence immediately after a legacy closing hash', async () => {
    for (const hash of ['#', '＃']) {
      for (const scheme of ['http', 'https', 'HTTP', 'hTtPs']) {
        const url = `${scheme}://example.com/Ａ?x=1&#happy`;
        const input = `${hash}day${hash}${url}`;
        assert.deepEqual(parseEnglishPost(input), { body: url, hashtags: ['day'] });
        const calls: string[] = [];
        const result = await translatePost(input, { translate: async (text) => { calls.push(text); return text; } });
        assert.deepEqual(calls, ['day'], 'No part of the protected URL reaches the model');
        assert.equal(result.description, url);
        assert.equal(result.caption, `${url}\n\n#day`);
      }
    }
  });

  it('protects hash-prefixed URLs beside legacy tags without deleting literal hashes', async () => {
    // Exact follow-up regression: the second # is literal URL-prefix text,
    // not permission to consume the URL scheme as a hashtag.
    assert.deepEqual(parseEnglishPost('#day##https://example.com/#happy'), {
      body: '#https://example.com/#happy', hashtags: ['day'],
    });
    for (const closingHash of ['#', '＃']) {
      for (const prefix of ['#', '＃', '##', '＃#']) {
        for (const scheme of ['http', 'https', 'HTTP', 'hTtPs']) {
          const url = `${scheme}://example.com/Ａ?x=1&#happy`;
          const literal = `${prefix}${url}`;
          assert.deepEqual(parseEnglishPost(literal), { body: literal, hashtags: [] });
          const input = `#day${closingHash}${literal} #joy`;
          assert.deepEqual(parseEnglishPost(input), { body: literal, hashtags: ['day', 'joy'] });
          const calls: string[] = [];
          const result = await translatePost(input, { translate: async (text) => { calls.push(text); return text; } });
          assert.deepEqual(calls, ['day', 'joy'], 'Neither hash punctuation nor any URL bytes reach the model');
          assert.equal(result.caption, `${literal}\n\n#day #joy`);
        }
      }
    }
    for (const input of ['#https #httpTag #https_foo', '#https#httpTag#https_foo']) {
      assert.deepEqual(parseEnglishPost(input), { body: '', hashtags: ['https', 'httpTag', 'https_foo'] });
    }
  });

  it('removes model-provided tag wrappers only in the tag translation path', async () => {
    const calls: string[] = [];
    const result = await translatePost('C# body #day #happy', { translate: async (text) => {
      calls.push(text);
      return ({ 'C# body': 'C# body', day: ' #日子# ', happy: '＃快乐＃。' })[text] ?? text;
    } });
    assert.deepEqual(calls, ['C# body', 'day', 'happy']);
    assert.equal(result.caption, 'C# body\n\n#日子 #快乐');
  });

  it('keeps the 30-distinct-tag limit and rejects excess adjacent tags before inference', async () => {
    const tags = Array.from({ length: 30 }, (_, i) => `tag${i}`);
    const accepted = await translatePost(tags.map((tag) => `#${tag}`).join('') + '#TAG0', identityModel);
    assert.equal(accepted.tags.length, 30);
    assert.equal(accepted.caption, tags.map((tag) => `#${tag}`).join(' '));
    let calls = 0;
    await assert.rejects(() => translatePost(tags.map((tag) => `#${tag}`).join('') + '#extra', {
      translate: async (text) => { calls++; return text; },
    }), /up to 30 hashtags/);
    assert.equal(calls, 0);
  });
});
