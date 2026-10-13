import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelManager } from '../src/engine/model-manager.ts';
import * as contract from '../src/engine/model-contract.ts';
import * as browserProvider from '../src/engine/model-provider.ts';
import { loadProduction, deferred } from './helpers/component-harness.mjs';

test('download callers share one native operation and each receives progress until settlement',async()=> {
  const job=deferred(),listeners=new Set();let downloads=0,removed=0,cancels=0;
  const native={downloadEpoch:()=>7,downloadModel:epoch=>{assert.equal(epoch,7);downloads++;return job.promise;},cancelModelDownload:()=>{cancels++;},addListener:(name,cb)=>{assert.equal(name,'onModelStatus');listeners.add(cb);return {remove:()=>{listeners.delete(cb);removed++;}};}};
  const provider=loadProduction('src/engine/model-provider.native.ts',{
    'expo-asset':{Asset:{}},'expo-file-system':{File:class{}},'./model-manager':{ModelManager},'./model-contract':contract,
    '../../modules/my-module/src/BiliPopTranslationModule':{__esModule:true,default:native},
  });
  const first=[],second=[];const a=provider.downloadModel(s=>first.push(s.state)),b=provider.downloadModel(s=>second.push(s.state));
  assert.equal(downloads,1);for(const callback of listeners)callback({state:'downloading',downloadedBytes:3,totalBytes:10});
  assert.deepEqual(first,['downloading']);assert.deepEqual(second,['downloading']);provider.cancelModelDownload();assert.equal(cancels,1);
  job.resolve({state:'paused',downloadedBytes:3,totalBytes:10});assert.equal((await a).state,'paused');assert.equal((await b).state,'paused');assert.equal(removed,2);assert.equal(listeners.size,0);
});
test('web preview cannot claim downloaded or running model readiness',async()=> {
  assert.equal((await browserProvider.getModelStatus()).state,'unsupported');
  assert.equal((await browserProvider.downloadModel()).state,'unsupported');
  await assert.rejects(browserProvider.getTranslator(),/UI preview/);
});
