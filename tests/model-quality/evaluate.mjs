// HISTORICAL OPUS baseline only. Does not evaluate the new Hy-MT2 runtime.
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { Tokenizer } from '@huggingface/tokenizers';
import * as ort from 'onnxruntime-node';
import { LocalTranslator } from './legacy-opus/local-model.ts';
import { translatePost } from './legacy-opus/translate-post.ts';

function validateFixture(fixture) {
  const invalid = (reason) => { throw new Error(`Invalid quality fixture: ${reason}`); };
  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) invalid('must be an object');
  if (typeof fixture.modelRevision !== 'string' || !/^[a-f0-9]{40}$/i.test(fixture.modelRevision)) {
    invalid('modelRevision must be a 40-character hexadecimal Git commit');
  }
  const assetNames = ['encoder.onnx', 'decoder.onnx', 'tokenizer.modeldata', 'tokenizer-config.modeldata'];
  const pins = fixture.assetSha256;
  if (!pins || typeof pins !== 'object' || Array.isArray(pins) ||
      Object.keys(pins).length !== assetNames.length || !assetNames.every((name) => Object.hasOwn(pins, name))) {
    invalid('assetSha256 must contain exactly the four known model asset names');
  }
  for (const name of assetNames) {
    if (typeof pins[name] !== 'string' || !/^[a-f0-9]{64}$/i.test(pins[name])) {
      invalid(`assetSha256.${name} must be a 64-character hexadecimal SHA256`);
    }
  }
  if (!fixture || !Array.isArray(fixture.cases) || fixture.cases.length === 0) {
    invalid('at least one case is required');
  }
  const caseIds = new Set();
  for (const item of fixture.cases) {
    if (!item || typeof item.id !== 'string' || !item.id.trim() ||
        typeof item.input !== 'string' || !item.input.trim()) invalid('each case needs a nonblank id and input');
    const caseId = item.id.trim();
    if (caseIds.has(caseId)) invalid(`duplicate case id: ${caseId}`);
    caseIds.add(caseId);
    for (const key of ['requiredFragments', 'forbiddenFragments']) {
      if (!Array.isArray(item[key]) || item[key].some((part) => typeof part !== 'string' || !part.trim())) {
        invalid(`${item.id}: ${key} must be an array of nonblank strings`);
      }
    }
    if (item.requiredFragments.length + item.forbiddenFragments.length === 0) {
      invalid(`${item.id}: at least one semantic constraint is required`);
    }
    if (item.requiredFragments.some((part) => item.forbiddenFragments.includes(part))) {
      invalid(`${item.id}: the same fragment cannot be required and forbidden`);
    }
  }
}

async function main() {
  // Explicit opt-in evaluation. Uses existing local pinned assets; never downloads them.
  const fixture =
    JSON.parse(await readFile(new URL('./cases.json', import.meta.url), 'utf8'));
  validateFixture(fixture);
  const { cases } = fixture;
  for (const [filename, expected] of Object.entries(fixture.assetSha256)) {
    if (!/^[a-z.-]+$/.test(filename)) throw new Error('Unexpected model asset filename.');
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(`assets/translation/${filename}`)) digest.update(chunk);
    if (digest.digest('hex') !== expected.toLowerCase()) throw new Error(`Model asset pin mismatch: ${filename}`);
  }
  console.log(JSON.stringify({ modelRevision: fixture.modelRevision, assetPinsVerified: Object.keys(fixture.assetSha256).length }));
  const tokenizer = new Tokenizer(
    JSON.parse(await readFile('assets/translation/tokenizer.modeldata', 'utf8')),
    JSON.parse(await readFile('assets/translation/tokenizer-config.modeldata', 'utf8')),
  );
  const options = { intraOpNumThreads: 2, interOpNumThreads: 1 };
  const encoder = await ort.InferenceSession.create('assets/translation/encoder.onnx', options);
  let decoder;
  try {
    decoder = await ort.InferenceSession.create('assets/translation/decoder.onnx', options);
    const translator = new LocalTranslator(ort, tokenizer, encoder, decoder);
    let failed = 0;
    for (const item of cases) {
      const start = performance.now();
      const output = (await translatePost(item.input, translator)).caption;
      const missing = item.requiredFragments.filter((part) => !output.includes(part));
      const forbidden = item.forbiddenFragments.filter((part) => output.includes(part));
      const passed = missing.length === 0 && forbidden.length === 0;
      if (!passed) failed++;
      console.log(JSON.stringify({ id: item.id, input: item.input, output, passed, missing, forbidden,
        milliseconds: Math.round(performance.now() - start), scope: 'pinned-model semantic evaluation on ONNX Node CPU; not Android application correctness' }));
    }
    console.log(JSON.stringify({ cases: cases.length, passed: cases.length - failed, failed,
      interpretation: 'A pass only covers these terminology constraints. A failure identifies model-quality limitations, not an application crash.' }));
    if (failed) process.exitCode = 1;
  } finally {
    // This evaluator owns both sessions, even if translator construction fails.
    try { await decoder?.release(); } finally { await encoder.release(); }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 2; });
