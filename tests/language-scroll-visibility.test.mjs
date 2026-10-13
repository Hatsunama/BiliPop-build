import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { createRequire } from 'node:module';
import { loadProduction, nativeHosts, screenHarness } from './helpers/component-harness.mjs';

const require = createRequire(import.meta.url);
const languages = require('../src/engine/languages.ts');
const { LanguageSelector } = loadProduction('src/components/language-selector.tsx', {
  'react-native': nativeHosts, '@/engine/languages': languages, '@/theme': require('../src/theme.ts'),
});
const geometry = (code) => ({ x: languages.LANGUAGE_OPTIONS.findIndex((item) => item.code === code) * 128, width: 120 });
const totalWidth = languages.LANGUAGE_OPTIONS.length * 128 - 8;
const event = (layout) => ({ nativeEvent: { layout } });
const expectedX = (code, viewport = 300) => Math.max(0, Math.min(totalWidth - viewport, geometry(code).x + 60 - viewport / 2));
const selectedScroller = (root, kind) => root.findByProps({ testID: `${kind}-language-selector` }).findByType('ScrollView');
async function layout(root, kind, code, order = ['option', 'viewport', 'content'], viewport = 300) {
  for (const part of order) await act(async () => {
    const scroll = selectedScroller(root, kind);
    if (part === 'viewport') scroll.props.onLayout?.(event({ width: viewport, height: 46 }));
    if (part === 'content') scroll.props.onContentSizeChange?.(totalWidth, 46);
    if (part === 'option') root.findByProps({ testID: `${kind}-language-${code}` }).props.onLayout?.(event(geometry(code)));
  });
}
function nodeMock(calls) {
  return (element) => element.type === 'ScrollView' ? {
    scrollTo: (options) => calls.push({ label: element.props.accessibilityLabel, x: options.x, animated: options.animated }),
  } : null;
}

for (const saved of [{}, { 'bilipop.sourceLanguage.v1': 'ja', 'bilipop.targetLanguage.v1': 'uk' }]) {
  test(`both selected pills are visible on launch and restart: ${JSON.stringify(saved)}`, async () => {
    const calls = [];
    const h = await screenHarness(saved, { createNodeMock: nodeMock(calls) });
    const source = saved['bilipop.sourceLanguage.v1'] ?? 'en';
    const target = saved['bilipop.targetLanguage.v1'] ?? 'ar';
    for (let restart = 0; restart < 2; restart++) {
      await h.mount();
      try {
        calls.length = 0;
        await layout(h.root(), 'source', source);
        await layout(h.root(), 'target', target, ['content', 'option', 'viewport']);
        assert.deepEqual(calls, [
          { label: 'Input language options', x: expectedX(source), animated: false },
          { label: 'Output language options', x: expectedX(target), animated: false },
        ]);
        assert.deepEqual(h.writes, [], 'Positioning never writes preferences');
      } finally { await h.unmount(); }
    }
  });
}

for (const order of [
  ['option', 'viewport', 'content'], ['content', 'viewport', 'option'], ['viewport', 'option', 'content'],
]) test(`waits for selected pill, viewport and content: ${order.join(' → ')}`, async () => {
  const calls = [];
  let renderer;
  await act(async () => { renderer = create(React.createElement(LanguageSelector, { kind: 'source', value: 'en', disabled: false, onChange() {} }), { createNodeMock: nodeMock(calls) }); });
  try {
    await layout(renderer.root, 'source', 'en', order.slice(0, 2));
    assert.equal(calls.length, 0, 'Do not consume initial positioning before all geometry exists');
    await layout(renderer.root, 'source', 'en', order.slice(2));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].x, expectedX('en'));
  } finally { await act(async () => renderer.unmount()); }
});

test('changed values and rotation reveal selection, while duplicate layout and unrelated renders leave manual scrolling alone', async () => {
  const calls = [];
  let renderer;
  const render = (value, disabled = false) => React.createElement(LanguageSelector, { kind: 'source', value, disabled, onChange() {} });
  await act(async () => { renderer = create(render('en'), { createNodeMock: nodeMock(calls) }); });
  try {
    await layout(renderer.root, 'source', 'en');
    assert.equal(calls.length, 1);
    // A native swipe does not change selection. Repeated geometry and disabled
    // updates (e.g. progress/text/status rendering) must not reset its offset.
    await act(async () => renderer.update(render('en', true)));
    await layout(renderer.root, 'source', 'en');
    assert.equal(calls.length, 1);
    await act(async () => renderer.update(render('ja')));
    assert.equal(calls.length, 1, 'New selection waits if its layout has not arrived');
    await layout(renderer.root, 'source', 'ja', ['option']);
    assert.equal(calls.at(-1).x, expectedX('ja'));
    await layout(renderer.root, 'source', 'ja', ['viewport'], 640);
    assert.equal(calls.at(-1).x, expectedX('ja', 640));
    assert.equal(calls.length, 3);
    await act(async () => renderer.update(render('en')));
    assert.equal(calls.at(-1).x, expectedX('en', 640), 'Previously measured selection is revealed without another native layout');
    assert.equal(calls.length, 4);
    await layout(renderer.root, 'source', 'fr', ['option']);
    assert.equal(calls.length, 4, 'Unselected layout does not disturb manual browsing');
  } finally { await act(async () => renderer.unmount()); }
});

test('last option clamps to the available range and retries after incomplete content measurement', async () => {
  const calls = [];
  const code = languages.LANGUAGE_OPTIONS.at(-1).code;
  let renderer;
  await act(async () => { renderer = create(React.createElement(LanguageSelector, { kind: 'target', value: code, disabled: false, onChange() {} }), { createNodeMock: nodeMock(calls) }); });
  try {
    await layout(renderer.root, 'target', code, ['option', 'viewport']);
    await act(async () => selectedScroller(renderer.root, 'target').props.onContentSizeChange(100, 46));
    assert.equal(calls.length, 0);
    await layout(renderer.root, 'target', code, ['content']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].x, totalWidth - 300);
    await layout(renderer.root, 'target', code, ['viewport'], totalWidth + 100);
    assert.equal(calls.at(-1).x, 0, 'All options fit without a negative offset');
  } finally { await act(async () => renderer.unmount()); }
});

test('fractional last-pill edge rounding is tolerated, but genuinely incomplete content still waits', async () => {
  const calls = [];
  const code = languages.LANGUAGE_OPTIONS.at(-1).code;
  const pill = { x: 4080.761962890625, width: 123.0478515625 };
  const content = 4203.8095703125;
  let renderer;
  await act(async () => { renderer = create(React.createElement(LanguageSelector, { kind: 'target', value: code, disabled: false, onChange() {} }), { createNodeMock: nodeMock(calls) }); });
  try {
    await layout(renderer.root, 'target', code, ['viewport']);
    await act(async () => renderer.root.findByProps({ testID: `target-language-${code}` }).props.onLayout(event(pill)));
    await act(async () => selectedScroller(renderer.root, 'target').props.onContentSizeChange(content - 1, 46));
    assert.equal(calls.length, 0, 'An edge more than one layout unit beyond content must wait');
    await act(async () => selectedScroller(renderer.root, 'target').props.onContentSizeChange(content, 46));
    assert.equal(calls.length, 1, 'Separate native rounding of position and width must not hide the last selection');
    assert.equal(calls[0].x, content - 300, 'Clamp to actual content, not the tolerated edge');
  } finally { await act(async () => renderer.unmount()); }
});
