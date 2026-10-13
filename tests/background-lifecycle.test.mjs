import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { deferred, loadProduction, nativeHosts } from './helpers/component-harness.mjs';

async function harness() {
  const query = deferred(); let motionListener, stateListener, removals = 0;
  const { RefractBackground } = loadProduction('src/components/refract-background.native.tsx', {
    'react-native': { ...nativeHosts,
      AccessibilityInfo: { isReduceMotionEnabled: () => query.promise,
        addEventListener: (_name, listener) => { motionListener = listener; return { remove: () => { removals++; } }; } },
      AppState: { currentState: 'active', addEventListener: (_name, listener) => { stateListener = listener; return { remove: () => { removals++; } }; } },
    }, 'expo-modules-core': { requireNativeViewManager: () => 'NativeBackground' },
  });
  let renderer; await act(async () => { renderer = create(React.createElement(RefractBackground)); });
  return {
    enabled: () => renderer.root.findByType('NativeBackground').props.motionEnabled,
    props: () => renderer.root.findByType('NativeBackground').props,
    query: async (value) => act(async () => query.resolve(value)),
    motion: async (value) => act(async () => motionListener(value)),
    state: async (value) => act(async () => stateListener(value)),
    paused: async (value) => act(async () => renderer.update(React.createElement(RefractBackground, { paused: value }))),
    unmount: async () => act(async () => renderer.unmount()), removed: () => removals,
  };
}
test('new accessibility event wins over an older pending reduce-motion query', async () => {
  const h = await harness();
  try {
    assert.equal(h.enabled(), false);
    await h.motion(true); await h.query(false);
    assert.equal(h.enabled(), false, 'Stale query must not re-enable motion after user preference changed');
    await h.motion(false); assert.equal(h.enabled(), true);
    await h.state('background'); assert.equal(h.enabled(), false);
    await h.state('active'); assert.equal(h.enabled(), true);
    await h.paused(true); assert.equal(h.enabled(), false);
    await h.state('inactive'); await h.state('active'); assert.equal(h.enabled(), false);
    await h.paused(false); assert.equal(h.enabled(), true);
    assert.equal(h.props().pointerEvents, 'none'); assert.equal(h.props().accessible, false);
  } finally { await h.unmount(); }
  assert.equal(h.removed(), 2);
});
test('initial preference, pause/resume, and unmount with outstanding accessibility query', async () => {
  const h = await harness(); await h.query(false); assert.equal(h.enabled(), true);
  await h.motion(true); await h.paused(true); await h.paused(false); assert.equal(h.enabled(), false);
  await h.unmount(); assert.equal(h.removed(), 2);
  const pending = await harness(); await pending.unmount(); await pending.query(false); assert.equal(pending.removed(), 2);
});
