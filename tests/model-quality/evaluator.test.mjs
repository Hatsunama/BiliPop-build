import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

// Execute the actual evaluator body. Only file/native-model/session boundaries
// are replaced; these tests do not perform inference or prove model quality.
const source = readFileSync(process.env.BILIPOP_EVALUATOR_SOURCE ?? new URL('./evaluate.mjs', import.meta.url), 'utf8');
const footer = 'main().catch((error) => { console.error(error); process.exitCode = 2; });';
assert.ok(source.includes(footer), 'The entry-point wrapper must remain explicitly identified.');
const executable = source.replace(/^import .*;\n/gm, '')
  .replaceAll('import.meta.url', '"file:///model-quality/evaluate.mjs"')
  .replace(footer, 'globalThis.runEvaluator = main;');
const bytes = Buffer.from('model fixture bytes');
const hash = createHash('sha256').update(bytes).digest('hex');
const validCase = () => ({ id: 'matcha', input: 'matcha latte', requiredFragments: ['抹茶'], forbiddenFragments: ['火柴'] });
const fixture = () => ({ modelRevision: '046f55aec303cdee3e0318604406d4df20f1e8ea',
  assetSha256: Object.fromEntries(['encoder.onnx', 'decoder.onnx', 'tokenizer.modeldata', 'tokenizer-config.modeldata'].map((name) => [name, hash])),
  cases: [validCase()] });

function harness(data = fixture(), options = {}) {
  const state = { created: [], released: [], outputs: [], inferred: 0 };
  const processState = { exitCode: 0 };
  const session = (name) => ({ async release() {
    state.released.push(name);
    if (options.releaseFailure === name) throw Error(`${name} release failed`);
  } });
  const context = vm.createContext({ URL, createHash, process: processState,
    performance: { now: () => 1 },
    console: { log: (line) => state.outputs.push(JSON.parse(line)) },
    readFile: async (path) => String(path).endsWith('cases.json') ? JSON.stringify(data) : '{}',
    createReadStream: async function* () { yield bytes; },
    Tokenizer: class {},
    ort: { InferenceSession: { create: async (path) => {
      const name = path.includes('encoder') ? 'encoder' : 'decoder';
      if (options.createFailure === name) throw Error(`${name} initialization failed`);
      state.created.push(name); return session(name);
    } } },
    LocalTranslator: class {
      constructor(_ort, _tokenizer, encoder, decoder) {
        if (options.constructorFailure) throw Error('translator construction failed');
        this.encoder = encoder; this.decoder = decoder;
      }
      async release() { await this.encoder.release(); await this.decoder.release(); }
    },
    translatePost: async () => {
      state.inferred++;
      if (options.inferenceFailure) throw Error('inference failed');
      return { caption: options.output ?? '抹茶拿铁' };
    },
  });
  new vm.Script(executable, { filename: 'actual-evaluate.mjs' }).runInContext(context);
  return { state, process: processState, run: () => context.runEvaluator() };
}

test('empty case lists fail before creating sessions or reporting success', async () => {
  const data = fixture(); data.cases = [];
  const h = harness(data);
  await assert.rejects(h.run, /Invalid quality fixture/);
  assert.deepEqual(h.state.created, []);
  assert.deepEqual(h.state.outputs, []);
});

for (const [name, change] of [
  ['missing required fragments', (item) => { delete item.requiredFragments; }],
  ['required fragments as string', (item) => { item.requiredFragments = '抹茶'; }],
  ['forbidden fragments as null', (item) => { item.forbiddenFragments = null; }],
  ['nonstring required fragment', (item) => { item.requiredFragments = [123]; }],
  ['empty required fragment', (item) => { item.requiredFragments = ['']; }],
  ['blank forbidden fragment', (item) => { item.forbiddenFragments = ['  ']; }],
  ['no constraints', (item) => { item.requiredFragments = []; item.forbiddenFragments = []; }],
  ['contradictory constraints', (item) => { item.forbiddenFragments = ['抹茶']; }],
]) {
  test(`malformed constraints fail before model initialization: ${name}`, async () => {
    const data = fixture(); change(data.cases[0]); const h = harness(data);
    await assert.rejects(h.run, /Invalid quality fixture/);
    assert.deepEqual(h.state.created, []);
    assert.equal(h.state.inferred, 0);
  });
}

test('both sessions close when translator construction fails after decoder initialization', async () => {
  const h = harness(fixture(), { constructorFailure: true });
  await assert.rejects(h.run, /translator construction failed/);
  assert.deepEqual(h.state.created, ['encoder', 'decoder']);
  assert.deepEqual(h.state.released.sort(), ['decoder', 'encoder']);
});

test('encoder closes when decoder initialization fails', async () => {
  const h = harness(fixture(), { createFailure: 'decoder' });
  await assert.rejects(h.run, /decoder initialization failed/);
  assert.deepEqual(h.state.released, ['encoder']);
});

test('valid successful and semantically failing evaluations close both sessions exactly once', async () => {
  for (const [output, exitCode] of [['抹茶拿铁', 0], ['火柴拿铁', 1]]) {
    const h = harness(fixture(), { output }); await h.run();
    assert.equal(h.process.exitCode, exitCode);
    assert.deepEqual(h.state.released.sort(), ['decoder', 'encoder']);
    assert.equal(h.state.outputs.at(-1).cases, 1);
    assert.equal(h.state.outputs.at(-1).failed, exitCode);
  }
});

test('inference failure closes both sessions exactly once', async () => {
  const h = harness(fixture(), { inferenceFailure: true });
  await assert.rejects(h.run, /inference failed/);
  assert.deepEqual(h.state.released.sort(), ['decoder', 'encoder']);
});

test('encoder cleanup still runs when decoder cleanup fails', async () => {
  const h = harness(fixture(), { constructorFailure: true, releaseFailure: 'decoder' });
  await assert.rejects(h.run);
  assert.deepEqual(h.state.released.sort(), ['decoder', 'encoder']);
});

for (const [name, change] of [
  ['empty asset map', (data) => { data.assetSha256 = {}; }],
  ['missing asset map', (data) => { delete data.assetSha256; }],
  ['null asset map', (data) => { data.assetSha256 = null; }],
  ['array asset map', (data) => { data.assetSha256 = []; }],
  ['partial asset map', (data) => { delete data.assetSha256['decoder.onnx']; }],
  ['extra asset name', (data) => { data.assetSha256['unexpected.onnx'] = hash; }],
  ['nonstring hash', (data) => { data.assetSha256['encoder.onnx'] = 123; }],
  ['short hash', (data) => { data.assetSha256['encoder.onnx'] = 'a'.repeat(63); }],
  ['long hash', (data) => { data.assetSha256['encoder.onnx'] = 'a'.repeat(65); }],
  ['nonhex hash', (data) => { data.assetSha256['encoder.onnx'] = 'g'.repeat(64); }],
  ['blank model revision', (data) => { data.modelRevision = ''; }],
  ['missing model revision', (data) => { delete data.modelRevision; }],
  ['nonhex model revision', (data) => { data.modelRevision = 'g'.repeat(40); }],
  ['wrong-length model revision', (data) => { data.modelRevision = 'a'.repeat(39); }],
  ['duplicate case IDs', (data) => { data.cases.push(validCase()); }],
  ['duplicate padded case IDs', (data) => { data.cases.push({ ...validCase(), id: ' matcha ' }); }],
]) {
  test(`invalid fixture integrity fails before model allocation: ${name}`, async () => {
    const data = fixture(); change(data); const h = harness(data);
    await assert.rejects(h.run, /Invalid quality fixture/);
    assert.deepEqual(h.state.created, []);
    assert.deepEqual(h.state.outputs, []);
    assert.equal(h.state.inferred, 0);
  });
}

test('uppercase SHA256 values verify against the same bytes', async () => {
  const data = fixture();
  for (const name of Object.keys(data.assetSha256)) data.assetSha256[name] = hash.toUpperCase();
  const h = harness(data); await h.run();
  assert.equal(h.state.outputs[0].assetPinsVerified, 4);
  assert.equal(h.process.exitCode, 0);
  assert.deepEqual(h.state.released.sort(), ['decoder', 'encoder']);
});

test('well-formed but incorrect asset hash fails before any model allocation', async () => {
  const data = fixture(); data.assetSha256['encoder.onnx'] = '0'.repeat(64);
  const h = harness(data);
  await assert.rejects(h.run, /Model asset pin mismatch: encoder.onnx/);
  assert.deepEqual(h.state.created, []);
  assert.deepEqual(h.state.outputs, []);
});
