// No network and no model download. The small APK contains metadata/notices only.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const contract = JSON.parse(readFileSync(new URL('../assets/translation/model-contract.json', import.meta.url), 'utf8'));
assert.equal(contract.artifact.repo, 'Hatsunama/caption-studio-hy-mt2-1.8b-q8');
assert.equal(contract.artifact.revision, '4d8552d273b5b4e064358e1a6ff37b396d0726e5');
assert.equal(contract.artifact.bytes, 1815668080);
assert.equal(contract.artifact.sha256, 'ed7747292c58435ab6e4b58bd7837c566737aae3eec5da6e3c328998529dcf97');
assert.equal(contract.artifact.url, `https://huggingface.co/${contract.artifact.repo}/resolve/${contract.artifact.revision}/model.litertlm`);
assert.deepEqual(readdirSync(new URL('../assets/translation/', import.meta.url)), ['model-contract.json'], 'Model weights must not be bundled into this small-APK build.');
console.log('Pinned Hatsunama model contract verified. Weights are downloaded explicitly in the Android app.');
