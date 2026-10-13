import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translatePost, tagToWords } from '../src/engine/translate-post.ts';
import { parseEnglishPost } from '../src/engine/parse-post.ts';
import { LocalTranslator } from '../src/engine/local-model.ts';
import { ModelManager } from '../src/engine/model-manager.ts';
import * as contract from '../src/engine/model-contract.ts';
import { loadProduction, screenHarness } from './helpers/component-harness.mjs';

for (const source of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
  test(`prototype-like caption text reaches the model: ${source}`, async () => {
    const calls=[];
    const result=await translatePost(source,{translate:async text=>{calls.push(text);return '正常译文';}});
    assert.deepEqual(calls,[source]);assert.equal(result.caption,'正常译文');
  });
}
for (const tag of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'unknownTag']) {
  test(`unknown hashtag reaches translation without inherited values: ${tag}`, async()=> {
    const calls=[];assert.equal(typeof tagToWords(tag),'string');
    const result=await translatePost(`#${tag}`,{translate:async text=>{calls.push(text);return '标签';}});
    assert.deepEqual(calls,[tagToWords(tag).trim()]);assert.equal(result.caption,'#标签');
  });
}
test('former Chinese dictionary terms now use the selected trained model',async()=> {
  for(const input of ['artificial intelligence','machine learning','deep learning','large language model','large language models','generative ai','short film','short films','matcha']) {
    const calls=[];
    assert.equal((await translatePost(input,{translate:async text=>{calls.push(text);return 'traduction';}},{sourceLanguage:'en',targetLanguage:'fr'})).caption,'traduction');
    assert.deepEqual(calls,[input]);
  }
});
for(const input of ['Ｈｅｌｌｏ ｗｏｒｌｄ','𝐇𝐞𝐥𝐥𝐨','Hello ｗｏｒｌｄ']) {
  test(`preserves original Unicode spelling at the trained model boundary: ${input}`,async()=> {
    const calls=[];assert.equal((await translatePost(input,{translate:async text=>{calls.push(text);return '你好';}})).caption,'你好');assert.deepEqual(calls,[input]);
  });
}
test('fullwidth/stylized tags still normalize for hashtag expansion and deduplication',async()=> {
  const calls=[];
  const result=await translatePost('＃ＡＩ #𝐀𝐈 #ＭａｃｈｉｎｅＬｅａｒｎｉｎｇ',{translate:async text=>{calls.push(text);return text==='artificial intelligence'?'人工智能':'机器学习';}});
  assert.equal(result.caption,'#人工智能 #机器学习');assert.deepEqual(calls,['artificial intelligence','machine learning']);
  assert.equal(tagToWords('ｍｙ＿ＮｅｗＶｉｄｅｏ'),'my New Video');assert.deepEqual(result.tags.map(t=>t.original),['ＡＩ','ＭａｃｈｉｎｅＬｅａｒｎｉｎｇ']);
});
const england=String.fromCodePoint(0x1f3f4,0xe0067,0xe0062,0xe0065,0xe006e,0xe0067,0xe007f);
const points=text=>Array.from(text,c=>c.codePointAt(0));
for(const scheme of ['https','HTTPS','hTtPs','HTTP']) {
  test(`preserves exact ${scheme} URL and subdivision flag at the provider boundary`,async()=> {
    const url=`${scheme}://example.com/Ａ?x=1&#thing`;
    const protectedText=`${england} 🇨🇳 1️⃣ 👩🏽‍💻 ${url}`;
    const input=`Ｈｅｌｌｏ 神你好 ${protectedText} 𝐟𝐫𝐢𝐞𝐧𝐝 #AI`;
    assert.deepEqual(parseEnglishPost(input).hashtags,['AI']);const calls=[];
    const result=await translatePost(input,{translate:async text=>{calls.push(text);return text==='artificial intelligence'?'人工智能':text;}});
    assert.deepEqual(calls,['Ｈｅｌｌｏ 神你好','𝐟𝐫𝐢𝐞𝐧𝐝','artificial intelligence']);
    assert.deepEqual(points(result.caption),points(`Ｈｅｌｌｏ 神你好 ${protectedText} 𝐟𝐫𝐢𝐞𝐧𝐝\n\n#人工智能`));
  });
}
test('Chinese source text is translated while protected-only text remains byte-exact',async()=> {
  const input=`神 你好 ${england} HTTPS://example.com/Ａ#AI`;const calls=[];
  const result=await translatePost(input,{translate:async text=>{calls.push(text);return 'Hello';}},{sourceLanguage:'zh',targetLanguage:'en'});
  assert.deepEqual(calls,['神 你好']);assert.deepEqual(points(result.caption),points(`Hello ${england} HTTPS://example.com/Ａ#AI`));
});
async function nativeHarness() {
  const bridgeCalls=[];
  const native={load:async()=>{},release:async()=>{},epoch:()=>17,cancel:()=>{},translate:async(prompt,epoch)=>{bridgeCalls.push({prompt,epoch});return '译文';}};
  const provider=loadProduction('src/engine/model-provider.native.ts',{
    'expo-asset':{Asset:{fromModule:()=>({localUri:'file:///bundled/fixture',downloadAsync:async()=>{}})}},
    'expo-file-system':{File:class{async text(){return '{}';}}},
    './model-manager':{ModelManager},'./model-contract':contract,
    '../../modules/my-module/src/BiliPopTranslationModule':{__esModule:true,default:native},
  });
  return {model:await provider.getTranslator(),bridgeCalls};
}
for(const input of ['Ｈｅｌｌｏ','𝐇𝐞𝐥𝐥𝐨','Hello ｗｏｒｌｄ']) {
  test(`native provider sends a text prompt, no Marian token IDs: ${input}`,async()=> {
    const h=await nativeHarness();assert.equal(await h.model.translate(input),'译文');
    assert.deepEqual(h.bridgeCalls,[{prompt:contract.buildTranslationPrompt(input),epoch:17}]);
  });
  test(`pure provider propagates model failure with exact original spelling: ${input}`,async()=> {
    const stop=Error('native boundary reached');const received=[];
    const model=new LocalTranslator({epoch:()=>2,cancel:()=>{},translate:async prompt=>{received.push(prompt);throw stop;}});
    await assert.rejects(model.translate(input),e=>e===stop);assert.deepEqual(received,[contract.buildTranslationPrompt(input)]);
  });
}
test('actual native JS provider receives only unprotected text and routes Chinese too',async()=> {
  const h=await nativeHarness();const url='HtTpS://example.com/Ａ?x=1&#tag';
  const result=await translatePost(`Ｈｅｌｌｏ ${url} ${england} friend`,h.model);
  assert.deepEqual(h.bridgeCalls.map(c=>c.prompt),['Ｈｅｌｌｏ','friend'].map(t=>contract.buildTranslationPrompt(t)));
  assert.deepEqual(points(result.caption),points(`译文 ${url} ${england} 译文`));
  assert.equal(await h.model.translate('神你好',{sourceLanguage:'zh',targetLanguage:'en'}),'译文');assert.equal(h.bridgeCalls.length,3);
});
test('screen persists legitimate translated captions and retains the exact source draft',async()=> {
  const h=await screenHarness({'bilipop.result.v1':'上次译文'});await h.mount();
  try {
    for(const input of ['constructor','__proto__','Ｈｅｌｌｏ']) {
      const start=h.calls.length;await h.edit('source-input',input);await h.press('POP IT!');
      assert.equal(h.snapshot().output,start?'正常译文':'上次译文');assert.equal(h.calls.length,start+1);assert.equal(h.calls[start].text,input);
      await h.act(()=>h.calls[start].resolve('正常译文'));assert.equal(h.values.get('bilipop.result.v1'),'正常译文');assert.equal(h.values.get('bilipop.draft.v1'),input);
      await h.unmount();await h.mount();assert.equal(h.snapshot().output,'正常译文');assert.equal(h.snapshot().draft,input);
    }
  } finally {await h.unmount();}
});
test('mixed Han/fullwidth tag source reaches the model without a Han bypass',async()=> {
  const calls=[];const result=await translatePost('#神Ｈｅｌｌｏ',{translate:async text=>{calls.push(text);return '标签';}});
  assert.deepEqual(calls,['神Hello']);assert.equal(result.caption,'#标签');assert.equal(result.tags[0].original,'神Ｈｅｌｌｏ');
});
test('existing English hashtag phrases retain documented expansion only for English source',()=> {
  const phrases={ai:'artificial intelligence',aiart:'AI art',aivideo:'AI video',aigenerated:'AI generated',machinelearning:'machine learning',deeplearning:'deep learning',generativeai:'generative AI',texttovideo:'text to video',texttoimage:'text to image',shortfilm:'short film',shortfilms:'short films',behindthescenes:'behind the scenes'};
  for(const [tag,expected] of Object.entries(phrases)){assert.equal(tagToWords(tag),expected);assert.equal(tagToWords(tag,'fr'),tag);}
});
test('cancelled native input never reaches the text bridge',async()=> {
  const h=await nativeHarness();const controller=new AbortController();controller.abort();
  await assert.rejects(h.model.translate('Ｈｅｌｌｏ',{signal:controller.signal}),/cancelled/);assert.equal(h.bridgeCalls.length,0);
});
test('pure provider routes Chinese unchanged into the prompt and rejects cancelled input',async()=> {
  const calls=[];const model=new LocalTranslator({epoch:()=>0,cancel:()=>{},translate:async p=>{calls.push(p);return 'Hello';}});
  assert.equal(await model.translate('神你好',{sourceLanguage:'zh',targetLanguage:'en'}),'Hello');assert.match(calls[0],/"神你好"$/);
  const controller=new AbortController();controller.abort();await assert.rejects(model.translate('Ｈｅｌｌｏ',{signal:controller.signal}),/cancelled/);assert.equal(calls.length,1);
});
for(const protectedEmoji of [`😃${england}`,`${england}${england}`]) {
  test(`adjacent pictographs retain every subdivision tag sequence: ${points(protectedEmoji).join(',')}`,async()=> {
    const h=await nativeHarness();const result=await translatePost(`Hello ${protectedEmoji} friend`,h.model);
    assert.deepEqual(h.bridgeCalls.map(c=>c.prompt),['Hello','friend'].map(t=>contract.buildTranslationPrompt(t)));
    assert.deepEqual(points(result.caption),points(`译文 ${protectedEmoji} 译文`));
  });
}
test('fullwidth underscore stays inside hashtags through parsing, deduplication and translation',async()=> {
  const input='#ｍｙ＿ＮｅｗＶｉｄｅｏ #my_NewVideo#＃ＡＩ';assert.deepEqual(parseEnglishPost(input),{body:'',hashtags:['ｍｙ＿ＮｅｗＶｉｄｅｏ','ＡＩ']});const calls=[];
  const result=await translatePost(input,{translate:async text=>{calls.push(text);return text==='artificial intelligence'?'人工智能':'我的新视频';}});
  assert.deepEqual(calls,['my New Video','artificial intelligence']);assert.equal(result.description,'');assert.equal(result.caption,'#我的新视频 #人工智能');assert.deepEqual(result.tags.map(t=>t.original),['ｍｙ＿ＮｅｗＶｉｄｅｏ','ＡＩ']);
});
test('fullwidth underscore obeys the same hashtag left boundary as ASCII underscore',()=> {
  for(const separator of ['_','＿'])assert.deepEqual(parseEnglishPost(`code${separator}#Tag`),{body:`code${separator}#Tag`,hashtags:[]});
});
