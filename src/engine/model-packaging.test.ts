import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import contract from '../../assets/translation/model-contract.json';

test('native file pins match the shipped public contract and dependency is exact',()=> {
  const store=readFileSync('modules/my-module/android/src/main/java/app/bilipop/translation/PinnedModelStore.kt','utf8');
  assert.ok(store.includes(contract.artifact.revision));assert.ok(store.includes(contract.artifact.sha256));assert.ok(store.includes(String(contract.artifact.bytes)+'L'));
  assert.ok(store.includes('https://huggingface.co/'+contract.artifact.repo+'/resolve/$REVISION/model.litertlm'));
  const gradle=readFileSync('modules/my-module/android/build.gradle','utf8');assert.match(gradle,/com.google.ai.edge.litertlm:litertlm-android:0.17.1/);assert.doesNotMatch(gradle,/onnxruntime/);
  assert.deepEqual(readdirSync('assets/translation'),['model-contract.json']);
  const provider=readFileSync('src/engine/model-provider.native.ts','utf8');assert.doesNotMatch(provider,/encoder\.onnx|decoder\.onnx|tokenizer\.modeldata/);
});
test('build verification does not fetch or bundle model weights',()=> {
  for(const name of ['scripts/fetch-model.mjs','scripts/verify-model-contract.mjs','scripts/build-android.mjs'])
    assert.doesNotMatch(readFileSync(name,'utf8'),/\bfetch\s*\(|https?:\/\/huggingface\.co\/Xenova/);
  const {dependencies}=JSON.parse(readFileSync('package.json','utf8'));
  assert.equal(dependencies['@huggingface/tokenizers'],undefined);assert.equal(dependencies['onnxruntime-common'],undefined);
});
test('Kotlin 2.3.20 property override is idempotent and never suppresses metadata checks or raises SDK',()=> {
  let apply!: (value: {modResults:{type:string;key:string;value:string}[]})=>{modResults:{type:string;key:string;value:string}[]};
  const mod={exports:(_value:unknown)=>{}};
  vm.runInNewContext(readFileSync('plugins/with-litert-kotlin.js','utf8'),{module:mod,require:(name:string)=>{
    assert.equal(name,'expo/config-plugins');return {withGradleProperties:(_config:unknown,callback:typeof apply)=>{apply=callback;return {};},withProjectBuildGradle:(config:unknown)=>config};
  }});
  mod.exports({});
  const original={modResults:[{type:'property',key:'android.minSdkVersion',value:'24'},{type:'property',key:'android.kotlinVersion',value:'2.1.20'}]};
  const once=apply(original), twice=apply(once);
  assert.deepEqual(JSON.parse(JSON.stringify(twice.modResults)),[{type:'property',key:'android.minSdkVersion',value:'24'},{type:'property',key:'android.kotlinVersion',value:'2.3.20'}]);
  assert.doesNotMatch(readFileSync('modules/my-module/android/build.gradle','utf8'),/skip.metadata|skip-prerelease/);
  const require=createRequire(import.meta.url);
  assert.doesNotThrow(()=>require('expo/config-plugins').withGradleProperties);
});
