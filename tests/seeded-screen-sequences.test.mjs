import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { screenHarness } from './helpers/component-harness.mjs';
const D = 'bilipop.draft.v1', R = 'bilipop.result.v1';

// Independent oracle: user-visible fields and durability are updated from the
// action contract, never read back from the component to form expectations.
for (const seed of [0xB11B0B, 0xC0FFEE, 0x51A7E]) {
  test(`seeded screen state/persistence sequence seed=${seed}`, async () => {
    const h = await screenHarness(); h.holdCopy(true); await h.mount();
    let random = seed, sequence = 0;
    const next = (n) => { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; return (random >>> 0) % n; };
    const oracle = { draft: '', output: '', savedDraft: '', savedOutput: '', busy: false, copied: false,
      error: '', saveDraftFailed: false, saveOutputFailed: false, draftDiskBroken: false, outputDiskBroken: false, revision: 0, active: null };
    const translations = [], copies = [], trace = [], coverage = new Set();
    const write = (field, value) => {
      oracle[field] = value; oracle.copied = false; oracle.revision++;
      const failed = oracle[field === 'draft' ? 'draftDiskBroken' : 'outputDiskBroken'];
      oracle[field === 'draft' ? 'saveDraftFailed' : 'saveOutputFailed'] = failed;
      if (!failed) oracle[field === 'draft' ? 'savedDraft' : 'savedOutput'] = value;
    };
    async function perform(action) {
      const entry = { action, ordinal: sequence++ }; coverage.add(action);
      switch (action) {
        case 'draft': {
          const value = `Caption ${sequence}`; entry.value = value;
          await h.edit('source-input', value); write('draft', value); break;
        }
        case 'edit': {
          const value = `手工校对 ${sequence}`; entry.value = value;
          await h.edit('translated-output', value); write('output', value); break;
        }
        case 'pop': {
          await h.burst('POP IT!', 'POP IT!', 'POP IT!');
          const job = { job: h.calls.at(-1), result: `翻译 ${oracle.draft.match(/\d+/)[0]}`, settled: false, source: oracle.draft };
          translations.push(job); oracle.active = job; oracle.busy = true; oracle.copied = false; oracle.revision++; oracle.error = '';
          assert.equal(job.job.text, oracle.draft); entry.source = oracle.draft; break;
        }
        case 'cancel':
          await h.burst('Cancel', 'Cancel'); oracle.active = null; oracle.busy = false;
          oracle.error = 'Translation cancelled. Your original text is unchanged.'; break;
        case 'resolve': case 'reject': {
          const unsettled = translations.filter((x) => !x.settled); const item = unsettled[next(unsettled.length)];
          entry.source = item.source; entry.stale = oracle.active !== item; item.settled = true;
          await h.act(() => action === 'resolve' ? item.job.resolve(item.result) : item.job.reject(Error('Controlled failure')));
          if (oracle.active === item) {
            if (action === 'resolve') write('output', item.result); else oracle.error = 'Controlled failure';
            oracle.active = null; oracle.busy = false;
          }
          break;
        }
        case 'copy':
          await h.press(oracle.copied ? 'COPIED!' : 'COPY TEXT + TAGS');
          copies.push({ job: h.copies.at(-1), revision: ++oracle.revision, settled: false });
          assert.equal(h.copies.at(-1).text, oracle.output); entry.text = oracle.output; break;
        case 'copyResolve': case 'copyReject': {
          const unsettled = copies.filter((x) => !x.settled); const item = unsettled[next(unsettled.length)]; item.settled = true;
          entry.stale = item.revision !== oracle.revision;
          await h.act(() => action === 'copyResolve' ? item.job.resolve() : item.job.reject(Error('Clipboard unavailable')));
          if (item.revision === oracle.revision) {
            if (action === 'copyResolve') oracle.copied = true;
            else oracle.error = 'Could not copy. You can select and copy the output manually.';
          }
          break;
        }
        case 'diskDraft': case 'diskOutput': {
          const field = action === 'diskDraft' ? 'draftDiskBroken' : 'outputDiskBroken'; const key = action === 'diskDraft' ? D : R;
          oracle[field] = !oracle[field]; entry.broken = oracle[field];
          if (oracle[field]) h.writeFailures.add(key); else h.writeFailures.delete(key); break;
        }
        case 'relaunch':
          await h.unmount(); await h.mount();
          oracle.draft = oracle.savedDraft; oracle.output = oracle.savedOutput; oracle.active = null;
          oracle.busy = false; oracle.copied = false; oracle.error = ''; oracle.saveDraftFailed = false; oracle.saveOutputFailed = false;
          // Every old clipboard completion belongs to an unmounted component.
          oracle.revision++; for (const item of copies) item.revision = -1;
          break;
        default: throw Error(`Unknown action ${action}`);
      }
      trace.push(entry);
      const actual = h.snapshot();
      const expected = { draft: oracle.draft, output: oracle.output, busy: oracle.busy, copied: oracle.copied,
        hasError: Boolean(oracle.error), storageWarning: oracle.saveDraftFailed || oracle.saveOutputFailed,
        savedDraft: oracle.savedDraft, savedOutput: oracle.savedOutput };
      const observed = { draft: actual.draft, output: actual.output, busy: actual.busy, copied: actual.copied,
        hasError: actual.alerts.some((x) => !x.startsWith('Local saving failed')),
        storageWarning: actual.alerts.some((x) => x.startsWith('Local saving failed')),
        savedDraft: h.values.get(D) ?? '', savedOutput: h.values.get(R) ?? '' };
      entry.expected = expected; entry.observed = observed;
      assert.deepEqual(observed, expected, `seed=${seed} trace=${JSON.stringify(trace.map(({ action, source, stale }) => ({ action, source, stale })))}`);
      if (oracle.error) assert.ok(actual.alerts.includes(oracle.error));
      assert.equal(actual.sourceEditable, !oracle.busy);
      assert.equal(actual.popDisabled, oracle.busy || !oracle.draft.trim());
    }
    try {
      // Ensure every seed exercises a meaningful chained path before scrambling.
      for (const action of ['draft', 'pop', 'resolve', 'edit', 'copy', 'copyResolve', 'draft', 'pop', 'reject', 'pop', 'cancel', 'draft', 'pop', 'resolve', 'resolve', 'relaunch']) await perform(action);
      for (let step = 0; step < 320; step++) {
        const actions = ['diskDraft', 'diskOutput', 'relaunch'];
        if (!oracle.busy) {
          actions.push('draft', 'draft');
          if (oracle.draft) actions.push('pop', 'pop');
          if (oracle.output) actions.push('edit', 'copy');
        } else actions.push('cancel', 'cancel');
        if (translations.some((x) => !x.settled)) actions.push('resolve', 'resolve', 'reject');
        if (copies.some((x) => !x.settled)) actions.push('copyResolve', 'copyReject');
        await perform(actions[next(actions.length)]);
      }
      for (const action of ['draft', 'edit', 'pop', 'cancel', 'resolve', 'reject', 'copy', 'copyResolve', 'copyReject', 'diskDraft', 'diskOutput', 'relaunch']) assert.ok(coverage.has(action), `seed missed ${action}`);
    } finally {
      await h.unmount();
      if (process.env.BILIPOP_TRACE_DIR) {
        mkdirSync(process.env.BILIPOP_TRACE_DIR, { recursive: true });
        writeFileSync(`${process.env.BILIPOP_TRACE_DIR}/seed-${seed}.json`, JSON.stringify({ seed, coverage: [...coverage], trace }, null, 2));
      }
    }
  });
}
