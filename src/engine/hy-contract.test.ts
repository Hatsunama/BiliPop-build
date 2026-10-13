import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTranslationPrompt, MODEL_BYTES, MODEL_URL, MODEL_SHA256 } from './model-contract';
import { LANGUAGE_OPTIONS, languageName, validateLanguagePair } from './languages';
import { LocalTranslator } from './local-model';

describe('Hatsunama Hy-MT2 contract', () => {
  it('uses the pinned trained candidate and never an upstream weight URL', () => {
    assert.equal(MODEL_BYTES, 1815668080);
    assert.equal(MODEL_URL, 'https://huggingface.co/Hatsunama/caption-studio-hy-mt2-1.8b-q8/resolve/4d8552d273b5b4e064358e1a6ff37b396d0726e5/model.litertlm');
    assert.equal(MODEL_SHA256, 'ed7747292c58435ab6e4b58bd7837c566737aae3eec5da6e3c328998529dcf97');
  });
  it('matches all four independently captured exact prompt goldens', () => {
    const fixtures = JSON.parse(readFileSync('tests/fixtures/hy-prompt-golden.json', 'utf8'));
    for (const f of fixtures) {
      const sourceLanguage = LANGUAGE_OPTIONS.find((l) => l.name === f.sourceLanguage)!.code;
      const targetLanguage = LANGUAGE_OPTIONS.find((l) => l.name === f.targetLanguage)!.code;
      assert.equal(buildTranslationPrompt(f.request.captions[0].text, { sourceLanguage, targetLanguage,
        contextBefore: f.request.contextBefore, contextAfter: f.request.contextAfter }), f.messages[0].content);
    }
  });
  it('has the complete explicit upstream language table with script-specific Chinese names', () => {
    assert.equal(LANGUAGE_OPTIONS.length, 38);
    assert.equal(new Set(LANGUAGE_OPTIONS.map((l) => l.code)).size, 38);
    assert.equal(languageName('zh'), 'Simplified Chinese');
    assert.equal(languageName('zh-Hant'), 'Traditional Chinese');
    assert.equal(languageName('yue'), 'Cantonese');
    assert.throws(() => languageName('auto'), /supported/);
    assert.throws(() => validateLanguagePair('en', 'en'), /different/);
    assert.throws(() => validateLanguagePair('invalid', 'en'), /supported/);
  });
  it('passes non-Latin text unchanged into the correct text prompt, never Marian IDs', async () => {
    const calls: string[] = [];
    const model = new LocalTranslator({ epoch: () => 2, cancel: () => {},
      translate: async (prompt: string, epoch: number) => { calls.push(prompt); assert.equal(epoch, 2); return 'Hello.'; } });
    assert.equal(await model.translate('你好。', { sourceLanguage: 'zh', targetLanguage: 'en' }), 'Hello.');
    assert.match(calls[0]!, /from Simplified Chinese into English/);
    assert.match(calls[0]!, /"你好。"$/);
  });
  it('rejects stale output after cancellation and removes the listener', async () => {
    const abort = new AbortController(); let cancels = 0;
    const model = new LocalTranslator({ epoch: () => 0, cancel: () => { cancels++; }, translate: async () => {
      abort.abort(); return 'stale';
    } });
    await assert.rejects(model.translate('Hello', { signal: abort.signal }), /cancelled/);
    assert.equal(cancels, 1);
    await assert.rejects(model.translate('Hello', { signal: abort.signal }), /cancelled/);
    assert.equal(cancels, 1);
  });
  it('serializes calls and does not run a queued request whose signal was cancelled', async () => {
    let finish!: (value:string)=>void; const calls: string[] = [];
    const model = new LocalTranslator({ epoch:()=>0, cancel:()=>{}, translate:async (prompt:string)=> {
      calls.push(prompt); return new Promise<string>((resolve)=> { finish=resolve; });
    }});
    const first = model.translate('One.');
    await new Promise((r)=>setImmediate(r));
    const abort = new AbortController(); const next = model.translate('Two.', { signal:abort.signal }); abort.abort();
    finish('一。'); assert.equal(await first,'一。'); await assert.rejects(next,/cancelled/); assert.equal(calls.length,1);
  });
  it('preserves original Unicode spelling and rejects blank model output', async () => {
    const calls: string[]=[];
    const model = new LocalTranslator({ epoch:()=>0,cancel:()=>{},translate:async p=>{calls.push(p);return ' ';} });
    await assert.rejects(model.translate('Ａ神'), /original/);
    assert.match(calls[0]!, /"Ａ神"$/);
  });
});
