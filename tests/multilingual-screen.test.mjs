import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenHarness } from './helpers/component-harness.mjs';
import { colors, radii } from '../src/theme.ts';

const flatStyle = (value) => Object.assign({}, ...(Array.isArray(value) ? value.flat(Infinity).filter(Boolean) : [value]));
const textOf = (node) => typeof node === 'string' ? node : node?.children?.map(textOf).join('') ?? '';
const byId = (h, testID) => h.root().findByProps({ testID });
const hostOrder = (h) => h.root().findAll((node) => typeof node.type === 'string' && node.props.testID).map((node) => node.props.testID);
const selected = (h, kind) => byId(h, `${kind}-language-selector`).findAllByType('Pressable').find((node) => node.props.accessibilityState?.selected)?.props.accessibilityLabel;

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`POP occupies the removed oval position and both labeled scrollers stay between fields at ${viewport.width}×${viewport.height}`, async () => {
    const h = await screenHarness({}, { viewport }); await h.mount();
    try {
      const order = hostOrder(h);
      const pop = byId(h, 'translate-button');
      const index = pop.parent.children.indexOf(pop);
      assert.equal(textOf(pop.parent.children[index - 1]), 'Translate text and hashtags between languages, on your phone.');
      const scrollStyle = flatStyle(pop.parent.props.contentContainerStyle);
      assert.equal(scrollStyle.width, '100%'); assert.equal(scrollStyle.maxWidth, 720);
      assert.equal(scrollStyle.paddingHorizontal, viewport.width < 400 ? 16 : 20);
      assert.ok(!h.root().findAllByType('View').some((node) => {
        const style = flatStyle(node.props.style);
        return style.backgroundColor === colors.lemon && style.borderRadius === radii.pill;
      }), 'No yellow oval View remains');
      assert.ok(order.indexOf('translate-button') < order.indexOf('source-input'), 'POP is above input in the old privacy oval position');
      assert.ok(order.includes('translated-output'), 'The empty output stays visible');
      assert.ok(order.indexOf('source-input') < order.indexOf('source-language-selector'));
      assert.ok(order.indexOf('source-language-selector') < order.indexOf('target-language-selector'));
      assert.ok(order.indexOf('target-language-selector') < order.indexOf('translated-output'));
      for (const [kind, heading] of [['source', 'INPUT LANGUAGE'], ['target', 'OUTPUT LANGUAGE']]) {
        const selector = byId(h, `${kind}-language-selector`);
        assert.match(textOf(selector), new RegExp(heading));
        assert.equal(flatStyle(selector.props.style).width, '100%');
        const scroller = selector.findByType('ScrollView');
        assert.equal(scroller.props.horizontal, true);
        assert.equal(scroller.findAllByType('Pressable').length, 38);
        assert.ok(scroller.findAllByType('Pressable').every((node) => node.props.accessibilityLabel.startsWith(kind === 'source' ? 'Input language:' : 'Output language:')));
      }
      assert.ok(!textOf(h.root()).includes('Offline translation · No accounts · No trend searches'));
      assert.match(textOf(h.root()), /upstream.*38|38.*upstream/i);
      assert.equal(h.root().findByType('RefractBackground').props.paused, false);
    } finally { await h.unmount(); }
  });
}

test('language choices persist, bind the real translation request, and cannot change during inference', async () => {
  const h = await screenHarness(); await h.mount();
  try {
    await h.selectLanguage('source', 'ja'); await h.selectLanguage('target', 'fr');
    await h.edit('source-input', 'こんにちは');
    const lateLanguagePress = byId(h, 'target-language-de').props.onPress;
    await h.press('POP IT!');
    await h.act(lateLanguagePress);
    await h.edit('source-input', 'Late input event'); await h.edit('translated-output', 'Late output event');
    assert.equal(h.snapshot().draft, 'こんにちは'); assert.equal(h.snapshot().output, '');
    assert.equal(h.calls[0].sourceLanguage, 'ja'); assert.equal(h.calls[0].targetLanguage, 'fr');
    for (const kind of ['source', 'target']) assert.ok(byId(h, `${kind}-language-selector`).findAllByType('Pressable').every((node) => node.props.disabled));
    await h.selectLanguage('target', 'de');
    assert.match(selected(h, 'target'), /French/);
    await h.act(() => h.calls[0].resolve('Bonjour'));
    assert.equal(h.snapshot().draft, 'こんにちは'); assert.equal(h.snapshot().output, 'Bonjour');
    assert.match(textOf(byId(h, 'output-language-label')), /French/);
    await h.selectLanguage('target', 'de');
    assert.match(textOf(byId(h, 'output-language-label')), /French/, 'Changing next target must not relabel the last result');
    await h.unmount(); await h.mount();
    assert.match(selected(h, 'source'), /Japanese/); assert.match(selected(h, 'target'), /German/);
    assert.match(textOf(byId(h, 'output-language-label')), /French/, 'Saved result provenance survives relaunch');
  } finally { await h.unmount(); }
});

test('cancelled requests cannot write a result under a newly selected language pair', async () => {
  const h = await screenHarness({ 'bilipop.draft.v1': 'Hello', 'bilipop.result.v1': 'Saved edit' }); await h.mount();
  try {
    await h.press('POP IT!'); await h.press('Cancel');
    await h.selectLanguage('target', 'de'); await h.press('POP IT!');
    await h.act(() => h.calls[0].resolve('过期'));
    assert.equal(h.snapshot().output, 'Saved edit'); assert.equal(h.snapshot().busy, true);
    await h.act(() => h.calls[1].resolve('Hallo'));
    assert.equal(h.snapshot().output, 'Hallo'); assert.match(textOf(byId(h, 'output-language-label')), /German/);
  } finally { await h.unmount(); }
});

test('first use checks real device status, then exposes explicit download, verification, readiness, and offline translation', async () => {
  const h = await screenHarness({ 'bilipop.draft.v1': 'Hello' }, { modelState: 'missing', holdStatus: true }); await h.mount();
  try {
    assert.equal(h.snapshot().popDisabled, true);
    assert.match(textOf(byId(h, 'model-status')), /Checking/);
    assert.doesNotMatch(textOf(byId(h, 'model-status')), /bundled|ready/i);
    await h.resolveStatus();
    assert.match(textOf(byId(h, 'model-status')), /1\.82 GB/);
    assert.equal(h.downloads.length, 0, 'Opening the screen never starts a network download');
    await h.press('Download model');
    assert.equal(h.downloads.length, 1);
    await h.downloadProgress(0, { state: 'downloading', downloadedBytes: 800_000_000 });
    assert.match(textOf(byId(h, 'model-status')), /0\.80 GB \/ 1\.82 GB/);
    assert.equal(h.snapshot().popDisabled, true);
    await h.downloadProgress(0, { state: 'verifying', downloadedBytes: 1_815_668_080 });
    assert.match(textOf(byId(h, 'model-status')), /Verifying/);
    assert.equal(h.snapshot().popDisabled, true, 'Receiving all bytes does not make the model ready');
    await h.finishDownload(0, { state: 'ready' });
    assert.equal(h.snapshot().popDisabled, false);
    await h.press('POP IT!'); await h.act(() => h.calls[0].resolve('你好'));
    assert.equal(h.snapshot().output, '你好'); assert.equal(h.downloads.length, 1);
  } finally { await h.unmount(); }
});

test('download cancel, retry, storage errors, late callbacks, and relaunch keep text and readiness honest', async () => {
  const h = await screenHarness({ 'bilipop.draft.v1': 'Keep source', 'bilipop.result.v1': 'Keep edit' }, { modelState: 'missing' }); await h.mount();
  try {
    await h.press('Download model'); await h.downloadProgress(0, { state: 'downloading', downloadedBytes: 200_000_000 });
    await h.press('Cancel download'); assert.equal(h.cancelDownloadCount(), 1);
    assert.match(textOf(byId(h, 'model-status')), /Cancelling/);
    await h.finishDownload(0, { state: 'paused', downloadedBytes: 200_000_000 });
    assert.equal(h.snapshot().popDisabled, true);
    await h.press('Resume download');
    await h.downloadProgress(0, { state: 'ready' });
    assert.equal(h.snapshot().popDisabled, true, 'A stale completed download cannot enable POP during a retry');
    await h.act(() => h.downloads[1].reject(Error('Not enough storage. Free space and retry.')));
    assert.match(textOf(byId(h, 'model-status')), /Not enough storage/);
    assert.equal(h.snapshot().draft, 'Keep source'); assert.equal(h.snapshot().output, 'Keep edit');
    await h.press('Retry download'); await h.finishDownload(2, { state: 'ready' });
    assert.equal(h.snapshot().popDisabled, false);
    await h.unmount(); await h.mount();
    assert.equal(h.snapshot().popDisabled, false, 'Relaunch rechecks actual ready state');
    assert.equal(h.snapshot().draft, 'Keep source'); assert.equal(h.snapshot().output, 'Keep edit');
  } finally { await h.unmount(); }
});

test('download callbacks after unmount never own a relaunched screen', async () => {
  const h = await screenHarness({ 'bilipop.draft.v1': 'Hello' }, { modelState: 'missing' }); await h.mount();
  try {
    await h.press('Download model'); await h.unmount();
    assert.equal(h.cancelDownloadCount(), 1);
    await h.mount();
    await h.downloadProgress(0, { state: 'ready' });
    assert.equal(h.snapshot().popDisabled, true);
    await h.finishDownload(0, { state: 'ready' });
    assert.equal(h.snapshot().popDisabled, true, 'An old download promise cannot set new screen state');
  } finally { await h.unmount(); }
});

test('language write/read failures remain separate from text saves and never destroy stored choices', async () => {
  const sourceKey = 'bilipop.sourceLanguage.v1', targetKey = 'bilipop.targetLanguage.v1';
  const h = await screenHarness({ [sourceKey]: 'ja', [targetKey]: 'fr', 'bilipop.draft.v1': 'Saved source' });
  h.readFailures.add(sourceKey); await h.mount();
  try {
    assert.match(selected(h, 'source'), /English/); assert.match(selected(h, 'target'), /French/);
    assert.match(h.snapshot().alerts.join(), /saved language choices/);
    assert.equal(h.values.get(sourceKey), 'ja');
    h.readFailures.clear(); h.writeFailures.add(targetKey);
    await h.selectLanguage('target', 'de');
    await h.edit('source-input', 'New source');
    assert.match(h.snapshot().alerts.join(), /Local saving failed/);
    assert.equal(h.values.get(targetKey), 'fr');
    h.writeFailures.clear(); await h.selectLanguage('target', 'de'); await h.selectLanguage('source', 'ja');
    assert.deepEqual(h.snapshot().alerts, []);
    await h.unmount(); await h.mount();
    assert.match(selected(h, 'source'), /Japanese/); assert.match(selected(h, 'target'), /German/);
  } finally { await h.unmount(); }
});

test('an interrupted output provenance write never labels identical text with an older target', async () => {
  const metadataKey = 'bilipop.resultLanguages.v1';
  const h = await screenHarness({ 'bilipop.draft.v1': 'Hello' }); await h.mount();
  try {
    await h.selectLanguage('target', 'fr'); await h.press('POP IT!'); await h.act(() => h.calls[0].resolve('Shared word'));
    await h.selectLanguage('target', 'de'); await h.press('POP IT!');
    h.failWriteOnceAfter(metadataKey, 1);
    await h.act(() => h.calls[1].resolve('Shared word'));
    assert.match(h.snapshot().alerts.join(), /Local saving failed/);
    assert.match(textOf(byId(h, 'output-language-label')), /German/, 'In-memory provenance remains correct');
    await h.unmount(); await h.mount();
    assert.equal(h.snapshot().output, 'Shared word');
    assert.doesNotMatch(textOf(byId(h, 'output-language-label')), /French/, 'Interrupted metadata leaves an unknown label rather than stale provenance');
  } finally { await h.unmount(); }
});

test('same-language choices show a useful error without loading a large model or changing saved output', async () => {
  const h = await screenHarness({ 'bilipop.draft.v1': 'Hello', 'bilipop.result.v1': 'Saved edit' }); await h.mount();
  try {
    await h.selectLanguage('target', 'en'); await h.press('POP IT!');
    assert.match(h.snapshot().alerts.join(), /different.*languages/i);
    assert.equal(h.loads.length, 0); assert.equal(h.calls.length, 0);
    assert.equal(h.snapshot().busy, false); assert.equal(h.snapshot().output, 'Saved edit');
  } finally { await h.unmount(); }
});

test('rapid repeated download and cancel presses share one owned setup operation', async () => {
  const h = await screenHarness({}, { modelState: 'missing' }); await h.mount();
  try {
    await h.burst('Download model', 'Download model', 'Download model');
    assert.equal(h.downloads.length, 1);
    await h.burst('Cancel download', 'Cancel download', 'Cancel download');
    assert.equal(h.cancelDownloadCount(), 1);
    await h.finishDownload(0, { state: 'paused' });
    await h.press('Resume download'); assert.equal(h.downloads.length, 2);
  } finally { await h.unmount(); }
});

test('web preview cannot pretend inference is available', async () => {
  const h = await screenHarness({ 'bilipop.draft.v1': 'Hello' }, { modelState: 'unsupported' }); await h.mount();
  try {
    assert.match(textOf(byId(h, 'model-status')), /UI preview/);
    assert.equal(h.snapshot().popDisabled, true);
    await h.burst('POP IT!');
    assert.equal(h.loads.length, 0); assert.equal(h.downloads.length, 0);
    assert.equal(h.root().findAllByProps({ testID: 'download-model' }).length, 0);
  } finally { await h.unmount(); }
});

test('reopening during a settling native download refreshes status without starting another download', async () => {
  const h = await screenHarness({ 'bilipop.draft.v1': 'Hello' }, { modelState: 'downloading' }); await h.mount();
  try {
    assert.equal(h.pendingTimers(), 1);
    assert.equal(h.snapshot().popDisabled, true);
    h.holdStatus(true); await h.runStatusTimer();
    assert.equal(h.statusChecks.length, 2);
    assert.equal(h.pendingTimers(), 0, 'Only one status request may be in flight');
    h.setModelState({ state: 'paused', downloadedBytes: 200_000_000 }); await h.resolveStatus();
    assert.equal(h.pendingTimers(), 0);
    assert.match(textOf(byId(h, 'model-status')), /paused/);
    assert.equal(h.downloads.length, 0, 'Read-only recovery never initiates a download');
    await h.press('Resume download'); assert.equal(h.downloads.length, 1);
  } finally { await h.unmount(); }
});

test('status refresh after unmount cannot enable a relaunched screen and leaves no timer', async () => {
  const h = await screenHarness({ 'bilipop.draft.v1': 'Hello' }, { modelState: 'verifying' }); await h.mount();
  try {
    h.holdStatus(true); await h.runStatusTimer();
    await h.unmount(); assert.equal(h.pendingTimers(), 0);
    h.holdStatus(false); h.setModelState({ state: 'missing' }); await h.mount();
    await h.act(() => h.statusChecks[1].resolve({ state: 'ready', downloadedBytes: 1_815_668_080, totalBytes: 1_815_668_080 }));
    assert.equal(h.snapshot().popDisabled, true);
    assert.equal(h.pendingTimers(), 0);
  } finally { await h.unmount(); }
});

test('the English sample is only offered for English input and never changes a selected pair', async () => {
  const h = await screenHarness(); await h.mount();
  try {
    await h.selectLanguage('source', 'ja'); await h.selectLanguage('target', 'fr');
    assert.ok(!h.root().findAllByType('Pressable').some((node) => textOf(node) === 'Try an AI video example'));
    assert.match(selected(h, 'source'), /Japanese/); assert.match(selected(h, 'target'), /French/);
    await h.selectLanguage('source', 'en'); await h.press('Try an AI video example');
    assert.match(h.snapshot().draft, /I make videos/); assert.match(selected(h, 'target'), /French/);
  } finally { await h.unmount(); }
});

test('every interrupted output-save boundary preserves original text or an honest unknown label', async () => {
  const resultKey = 'bilipop.result.v1', metadataKey = 'bilipop.resultLanguages.v1';
  for (const boundary of ['clear-metadata', 'write-text', 'write-metadata']) {
    const original = 'Previously saved';
    const h = await screenHarness({ 'bilipop.draft.v1': 'Hello', [resultKey]: original,
      [metadataKey]: JSON.stringify({ text: original, sourceLanguage: 'en', targetLanguage: 'fr' }) });
    await h.mount();
    try {
      await h.selectLanguage('target', 'de'); await h.press('POP IT!');
      if (boundary === 'clear-metadata') h.failWriteOnceAfter(metadataKey, 0);
      else if (boundary === 'write-text') h.failWriteOnceAfter(resultKey, 0);
      else h.failWriteOnceAfter(metadataKey, 1);
      await h.act(() => h.calls[0].resolve('New translation'));
      assert.match(h.snapshot().alerts.join(), /Local saving failed/);
      assert.equal(h.snapshot().output, 'New translation', 'The live field keeps unsaved text available to copy');
      await h.unmount(); await h.mount();
      assert.equal(h.snapshot().output, boundary === 'write-metadata' ? 'New translation' : original);
      const label = textOf(byId(h, 'output-language-label'));
      if (boundary === 'clear-metadata') assert.match(label, /French/, 'Only the old text and old metadata survived');
      else assert.match(label, /not recorded/, 'Partially saved provenance is explicitly unknown');
      assert.doesNotMatch(label, /German/, 'An incomplete save never claims a newly selected target on relaunch');
    } finally { await h.unmount(); }
  }
});

test('unreadable result metadata never deletes text or silently rewrites its saved language label', async () => {
  const key = 'bilipop.resultLanguages.v1';
  const metadata = JSON.stringify({ text: 'Saved edit', sourceLanguage: 'ja', targetLanguage: 'fr' });
  const h = await screenHarness({ 'bilipop.result.v1': 'Saved edit', [key]: metadata });
  h.readFailures.add(key); await h.mount();
  try {
    assert.equal(h.snapshot().output, 'Saved edit');
    assert.match(textOf(byId(h, 'output-language-label')), /not recorded/);
    assert.match(h.snapshot().alerts.join(), /saved output language label/);
    assert.equal(h.writes.length, 0); assert.equal(h.values.get(key), metadata);
    h.readFailures.clear(); await h.unmount(); await h.mount();
    assert.match(textOf(byId(h, 'output-language-label')), /Japanese → French/);
  } finally { await h.unmount(); }
});

test('failed saved-input reads quarantine sample and edit writes until recovery succeeds', async () => {
  const draftKey = 'bilipop.draft.v1';
  const h = await screenHarness({ [draftKey]: 'Important legacy draft', 'bilipop.result.v1': 'Old reviewed result' });
  h.readFailures.add(draftKey); await h.mount();
  try {
    const sample = h.root().findAllByType('Pressable').find((node) => textOf(node) === 'Try an AI video example');
    if (sample) await h.act(() => sample.props.onPress());
    await h.edit('source-input', 'Cannot replace an unread draft');
    assert.equal(h.values.get(draftKey), 'Important legacy draft');
    assert.equal(h.snapshot().draft, ''); assert.equal(h.snapshot().sourceEditable, false);
    assert.match(h.snapshot().alerts.join(), /Could not open local/);
    await h.edit('translated-output', 'Safe independent edit');
    assert.equal(h.values.get('bilipop.result.v1'), 'Safe independent edit', 'Readable fields remain editable');
    await h.press('Retry saved text');
    assert.equal(h.values.get(draftKey), 'Important legacy draft');
    assert.match(h.snapshot().alerts.join(), /Could not open local/, 'A failed retry cannot clear the warning');
    h.readFailures.clear(); const before = h.writes.length;
    await h.press('Retry saved text');
    assert.equal(h.snapshot().draft, 'Important legacy draft'); assert.equal(h.writes.length, before, 'Recovery reads without writing');
    assert.equal(h.snapshot().sourceEditable, true); assert.deepEqual(h.snapshot().alerts, []);
    await h.edit('source-input', 'Explicit edit after recovery');
    assert.equal(h.values.get(draftKey), 'Explicit edit after recovery');
    await h.unmount(); await h.mount();
    assert.equal(h.snapshot().draft, 'Explicit edit after recovery');
    assert.equal(h.snapshot().output, 'Safe independent edit');
  } finally { await h.unmount(); }
});

test('failed saved-output reads block edits and translation writes while preserving independent input edits', async () => {
  const resultKey = 'bilipop.result.v1';
  const h = await screenHarness({ 'bilipop.draft.v1': 'Important source', [resultKey]: 'Important reviewed output',
    'bilipop.resultLanguages.v1': JSON.stringify({ text: 'Important reviewed output', sourceLanguage: 'ja', targetLanguage: 'fr' }) });
  h.readFailures.add(resultKey); await h.mount();
  try {
    await h.edit('translated-output', 'Cannot replace an unread output');
    await h.burst('POP IT!');
    assert.equal(h.values.get(resultKey), 'Important reviewed output');
    assert.equal(h.loads.length, 0); assert.equal(h.calls.length, 0);
    assert.equal(byId(h, 'translated-output').props.editable, false);
    assert.equal(h.snapshot().popDisabled, true);
    await h.edit('source-input', 'Independent source edit');
    assert.equal(h.values.get('bilipop.draft.v1'), 'Independent source edit');
    assert.match(h.snapshot().alerts.join(), /Could not open local/);
    await h.press('Retry saved text'); assert.match(h.snapshot().alerts.join(), /Could not open local/);
    h.readFailures.clear(); const before = h.writes.length; await h.press('Retry saved text');
    assert.equal(h.snapshot().output, 'Important reviewed output');
    assert.match(textOf(byId(h, 'output-language-label')), /Japanese → French/);
    assert.equal(h.writes.length, before);
    assert.equal(byId(h, 'translated-output').props.editable, true);
    assert.equal(h.snapshot().popDisabled, false);
    await h.press('POP IT!'); await h.press('Cancel');
    await h.act(() => h.calls[0].resolve('Stale result after recovery'));
    assert.equal(h.values.get(resultKey), 'Important reviewed output');
    await h.press('POP IT!'); await h.act(() => h.calls[1].resolve('New complete translation'));
    assert.equal(h.values.get(resultKey), 'New complete translation');
  } finally { await h.unmount(); }
});


test('saved-text retry from an unmounted screen performs no reads or writes', async () => {
  const h = await screenHarness({ 'bilipop.draft.v1': 'Original stored draft' });
  h.readFailures.add('bilipop.draft.v1'); await h.mount();
  try {
    const retry = h.root().findAllByType('Pressable').find((node) => textOf(node) === 'Retry saved text').props.onPress;
    await h.unmount(); h.readFailures.clear(); await h.mount();
    await h.edit('source-input', 'New live edit');
    const reads = h.reads.length, writes = h.writes.length;
    await h.act(retry);
    assert.equal(h.reads.length, reads); assert.equal(h.writes.length, writes);
    assert.equal(h.snapshot().draft, 'New live edit');
  } finally { await h.unmount(); }
});


for (const reason of [
  'This translation model requires Android 8.0 or newer. Saved text remains available.',
  'This translation model requires a supported 64-bit device. Saved text remains available.',
]) test(`unsupported Android setup preserves its native requirement: ${reason}`, async () => {
  const h = await screenHarness({ 'bilipop.draft.v1': 'Keep original', 'bilipop.result.v1': 'Keep reviewed output' }, { modelState: 'unsupported' });
  h.setModelState({ state: 'unsupported', error: reason });
  await h.mount();
  try {
    assert.equal(textOf(byId(h, 'model-status-message')), reason);
    assert.equal(h.snapshot().popDisabled, true);
    assert.equal(h.root().findAllByProps({ testID: 'download-model' }).length, 0);
    assert.equal(h.loads.length, 0); assert.equal(h.downloads.length, 0);
    assert.equal(h.snapshot().draft, 'Keep original'); assert.equal(h.snapshot().output, 'Keep reviewed output');
    await h.edit('source-input', 'Still editable');
    assert.equal(h.snapshot().draft, 'Still editable');
    assert.equal(h.snapshot().output, 'Keep reviewed output');
  } finally { await h.unmount(); }
});
