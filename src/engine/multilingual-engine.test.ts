import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translatePost, translateUnit, tagToWords } from './translate-post';

test('Japanese and Chinese sources reach the selected target without an ASCII gate', async () => {
  const calls: {text:string;source?:string;target?:string}[]=[];
  const result=await translatePost('今日はいい天気です。\n#旅行', {translate:async(text,options)=> {
    calls.push({text,source:options?.sourceLanguage,target:options?.targetLanguage}); return text==='旅行'?'voyage':'Il fait beau.';
  }}, {sourceLanguage:'ja',targetLanguage:'fr'});
  assert.deepEqual(calls,[{text:'今日はいい天気です。',source:'ja',target:'fr'},{text:'旅行',source:'ja',target:'fr'}]);
  assert.equal(result.caption,'Il fait beau.\n\n#voyage');
});
test('no English-to-Chinese dictionary shortcut contaminates any pair', async()=> {
  const calls:string[]=[];
  const result=await translatePost('matcha\n#AI', {translate:async text=> {calls.push(text);return text==='matcha'?'matcha':'intelligence artificielle';}}, {sourceLanguage:'en',targetLanguage:'fr'});
  assert.deepEqual(calls,['matcha','artificial intelligence']); assert.equal(result.caption,'matcha\n\n#intelligenceartificielle');
  assert.equal(tagToWords('ai','fr'),'ai');
});
test('mixed scripts retain their context while URLs and emoji remain byte-exact', async()=> {
  const calls:string[]=[];
  const source='Hello 神你好 👩🏽‍💻 HTTPS://example.com/Ａ#AI fin';
  const result=await translateUnit(source,{translate:async text=>{calls.push(text);return text;}},{sourceLanguage:'zh',targetLanguage:'en'});
  assert.deepEqual(calls,['Hello 神你好','fin']); assert.equal(result,source);
});
test('rejects invalid and equal pairs before model use, including protected-only input',async()=> {
  const model={translate:async()=>{throw new Error('must not call');}};
  await assert.rejects(translatePost('Hello',model,{sourceLanguage:'en',targetLanguage:'en'}),/different/);
  await assert.rejects(translatePost('😃',model,{sourceLanguage:'bad' as 'en'}),/supported/);
});
