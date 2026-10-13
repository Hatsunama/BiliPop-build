import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenHarness } from './helpers/component-harness.mjs';

test('CaptionAction-style local thank-you flow retains edits and supports button/hardware dismissal', async () => {
  const h = await screenHarness({ 'bilipop.draft.v1': 'Original', 'bilipop.result.v1': '校对输出' }); await h.mount();
  try {
    for (let iteration = 0; iteration < 3; iteration++) {
      await h.press('Hatsu Is Here For You');
      const modal = h.root().findByType('Modal');
      assert.equal(modal.props.visible, true);
      assert.deepEqual(Array.from(modal.props.supportedOrientations), ['portrait', 'landscape']);
      assert.equal(modal.props.animationType, 'none', 'No motion preference race for local thanks');
      const text = h.root().findAllByType('Text').map((node) => node.props.children);
      assert.ok(text.includes('If you want to support Hatsu please subscribe to the Patreon @Hatsunama'));
      if (iteration % 2) await h.act(() => modal.props.onRequestClose());
      else await h.press('Back to Home');
      assert.equal(h.root().findByType('Modal').props.visible, false);
      assert.equal(h.snapshot().draft, 'Original'); assert.equal(h.snapshot().output, '校对输出');
    }
    await h.press('POP IT!'); await h.press('Hatsu Is Here For You'); await h.press('Back to Home');
    assert.equal(h.snapshot().busy, true);
    await h.press('Cancel'); await h.act(() => h.calls[0].resolve('旧结果'));
    assert.equal(h.snapshot().output, '校对输出');
    await h.unmount(); await h.mount();
    assert.equal(h.root().findByType('Modal').props.visible, false);
    assert.equal(h.snapshot().draft, 'Original'); assert.equal(h.snapshot().output, '校对输出');
  } finally { await h.unmount(); }
});
