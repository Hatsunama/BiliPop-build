import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelManager } from './model-manager';
import { LocalTranslator } from './local-model';

test('failed model initialization is retryable; callers share only successful load',async()=> {
  let loads=0;
  const manager=new ModelManager({load:async()=>{if(++loads===1)throw Error('memory');},release:async()=>{},epoch:()=>0,cancel:()=>{},translate:async()=> 'ok'});
  await assert.rejects(manager.get(),/memory/);
  const first=manager.get(),second=manager.get();assert.equal(first,second);await first;assert.equal(loads,2);
});
test('release invalidates pending loads and old translator handles; later load recovers',async()=> {
  let finish!:()=>void;let loads=0;const calls:string[]=[];
  const manager=new ModelManager({load:async()=>{loads++;if(loads===1)await new Promise<void>(r=>{finish=r;});},release:async()=>{calls.push('release');},epoch:()=>0,cancel:()=>{calls.push('cancel');},translate:async()=> 'ok'});
  const loading=manager.get();await new Promise(r=>setImmediate(r));const released=manager.release();finish();
  await assert.rejects(loading,/cancelled/);await released;
  const model=await manager.get();await manager.release();
  await assert.rejects(model.translate('stale'),/cancelled/);
  assert.equal(await (await manager.get()).translate('fresh'),'ok');
});
test('language pair is snapped at request creation, including queued requests',async()=> {
  const calls:string[]=[];let finish!:(value:string)=>void;
  const model=new LocalTranslator({epoch:()=>0,cancel:()=>{},translate:async p=>{calls.push(p);if(calls.length===1)return new Promise<string>(r=>{finish=r;});return 'ok';}});
  const first=model.translate('first');await new Promise(r=>setImmediate(r));
  const options:{sourceLanguage:'en';targetLanguage:'fr'|'ja'}={sourceLanguage:'en',targetLanguage:'fr'};
  const second=model.translate('second',options);options.targetLanguage='ja';finish('ok');await first;await second;
  assert.match(calls[1]!, /into French/);
});
