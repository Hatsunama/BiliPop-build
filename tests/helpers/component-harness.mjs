import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { act, create } from 'react-test-renderer';

// Runs the unchanged production TSX and real React hooks/reconciliation. Only
// platform boundaries are replaced; this is not a native rendering/device test.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(import.meta.url);
const { translatePost, validatePostInput } = require('../../src/engine/translate-post.ts');
export const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
export function loadProduction(path, replacements, globals = {}) {
  const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: path,
  }).outputText;
  const module = { exports: {} };
  const context = { module, exports: module.exports, require: (name) => {
    if (Object.hasOwn(replacements, name)) return replacements[name];
    return require(name);
  }, AbortController, Error, console, ...globals };
  vm.runInNewContext(compiled, context, { filename: path });
  return module.exports;
}
export const nativeHosts = {
  ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', ScrollView: 'ScrollView',
  Text: 'Text', TextInput: 'TextInput', View: 'View', Modal: 'Modal',
  Platform: { select: (values) => values.android },
  StyleSheet: { create: (styles) => styles, absoluteFill: { position: 'absolute' } },
};
export async function screenHarness(initial = {}, config = {}) {
  const values = new Map(Object.entries(initial));
  const readFailures = new Set(), writeFailures = new Set();
  const writes = [], reads = [], calls = [], loads = [], copies = [], downloads = [], statusChecks = [];
  const failuresAfter = new Map(), timers = new Map();
  let nextTimer = 0;
  let cancelDownloads = 0, holdStatus = config.holdStatus ?? false;
  const modelBytes = 1_815_668_080;
  let currentStatus = { state: config.modelState ?? 'ready', downloadedBytes: config.modelState && config.modelState !== 'ready' ? 0 : modelBytes, totalBytes: modelBytes };
  let heldLoad = false, heldCopy = false;
  const storage = loadProduction(config.nativeStorage ? 'src/storage/device-storage.native.ts' : 'src/storage/device-storage.ts', { 'expo-sqlite/localStorage/install': {} }, { localStorage: {
    getItem: (key) => { reads.push(key); if (readFailures.has(key)) throw Error('read unavailable'); return values.get(key) ?? null; },
    setItem: (key, value) => { if (writeFailures.has(key)) throw Error('disk full');
      if (failuresAfter.has(key)) {
        const remaining = failuresAfter.get(key);
        if (remaining === 0) { failuresAfter.delete(key); throw Error('interrupted write'); }
        failuresAfter.set(key, remaining - 1);
      }
      writes.push([key, value]); values.set(key, value); },
  } });
  const model = { translate: (text, options) => { const job = { ...deferred(), text, signal: options?.signal, sourceLanguage: options?.sourceLanguage, targetLanguage: options?.targetLanguage }; calls.push(job); return job.promise; } };
  const provider = {
    getTranslator: () => { const job = deferred(); loads.push(job); if (!heldLoad) job.resolve(model); return job.promise; },
    getModelNotices: async () => 'Model license fixture',
    MODEL_BYTES: modelBytes,
    getModelStatus: () => { const job = deferred(); statusChecks.push(job); if (!holdStatus) job.resolve(currentStatus); return job.promise; },
    downloadModel: (onProgress) => { const job = { ...deferred(), onProgress }; downloads.push(job); return job.promise; },
    cancelModelDownload: () => { cancelDownloads++; },
  };
  const clipboard = { setStringAsync: (text) => { const job = { ...deferred(), text }; copies.push(job); if (!heldCopy) job.resolve(); return job.promise; } };
  const hosts = { ...nativeHosts, useWindowDimensions: () => config.viewport ?? { width: 390, height: 844 } };
  const languages = require('../../src/engine/languages.ts');
  const selector = loadProduction('src/components/language-selector.tsx', {
    'react-native': hosts, '@/engine/languages': languages, '@/theme': require('../../src/theme.ts'),
  });
  const { BiliPopScreen } = loadProduction('src/components/bili-pop-screen.tsx', {
    'react-native': hosts, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-clipboard': clipboard, '@/engine/model-provider': provider,
    '@/engine/translate-post': { translatePost, validatePostInput }, '@/storage/device-storage': storage,
    '@/theme': require('../../src/theme.ts'), '@/engine/languages': languages, './language-selector': selector, './refract-background': { RefractBackground: 'RefractBackground' },
  }, { setTimeout: (fn) => { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout: (id) => timers.delete(id) });
  let renderer;
  const mount = async () => { await act(async () => { renderer = create(React.createElement(BiliPopScreen)); }); };
  const byId = (id) => renderer.root.findByProps({ testID: id });
  const text = (node) => typeof node === 'string' ? node : node?.children?.map(text).join('') ?? '';
  const button = (label) => renderer.root.findAllByType('Pressable').find((x) => text(x) === label);
  const snapshot = () => ({
    draft: byId('source-input').props.value,
    output: renderer.root.findAllByProps({ testID: 'translated-output' })[0]?.props.value ?? '',
    busy: renderer.root.findByType('RefractBackground').props.paused,
    copied: Boolean(button('COPIED!')),
    alerts: renderer.root.findAllByProps({ accessibilityRole: 'alert' }).map(text),
    sourceEditable: byId('source-input').props.editable,
    popDisabled: byId('translate-button').props.disabled,
    progress: renderer.root.findAllByProps({ accessibilityLiveRegion: 'polite' }).filter((node) => node.props.testID !== 'model-status-message').map(text),
  });
  return {
    mount, unmount: async () => { await act(async () => renderer.unmount()); },
    act: async (fn) => { await act(async () => { await fn(); }); },
    edit: async (id, value) => { await act(async () => byId(id).props.onChangeText(value)); },
    press: async (label) => { await act(async () => { const b = button(label); if (!b) throw Error(`Missing button ${label}`); if (!b.props.disabled) b.props.onPress(); }); },
    burst: async (...labels) => { await act(async () => { for (const label of labels) button(label)?.props.onPress(); }); },
    snapshot, values, writes, reads, calls, loads, copies, downloads, statusChecks, readFailures, writeFailures, model,
    selectLanguage: async (kind, code) => { await act(async () => { const option = byId(`${kind}-language-${code}`); if (!option.props.disabled) option.props.onPress(); }); },
    resolveStatus: async () => { holdStatus = false; await act(async () => { for (const job of statusChecks) job.resolve(currentStatus); }); },
    downloadProgress: async (index, status) => { currentStatus = { ...currentStatus, ...status }; await act(async () => downloads[index].onProgress(currentStatus)); },
    finishDownload: async (index, status) => { currentStatus = { ...currentStatus, ...status, ...(status.state === 'ready' ? { downloadedBytes: modelBytes } : {}) }; await act(async () => downloads[index].resolve(currentStatus)); },
    cancelDownloadCount: () => cancelDownloads,
    pendingTimers: () => timers.size,
    runStatusTimer: async () => { const [id, fn] = timers.entries().next().value ?? []; if (!fn) throw Error('No status refresh scheduled'); timers.delete(id); await act(async () => fn()); },
    holdStatus: (value) => { holdStatus = value; },
    setModelState: (status) => { currentStatus = { ...currentStatus, ...status }; },
    failWriteOnceAfter: (key, successfulWrites) => failuresAfter.set(key, successfulWrites),
    root: () => renderer.root,
    holdLoad: (value) => { heldLoad = value; }, holdCopy: (value) => { heldCopy = value; },
  };
}
