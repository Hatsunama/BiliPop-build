import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { cancelModelDownload, downloadModel, getModelStatus, getTranslator, getModelNotices, MODEL_BYTES, type ModelStatus } from '@/engine/model-provider';
import { DEFAULT_SOURCE_LANGUAGE, DEFAULT_TARGET_LANGUAGE, LANGUAGE_OPTIONS, languageName, type LanguageCode } from '@/engine/languages';
import { translatePost, validatePostInput, type Progress } from '@/engine/translate-post';
import { readDraft, readResult, saveDraft, saveResult, readSourceLanguage, readTargetLanguage, saveSourceLanguage, saveTargetLanguage, readResultLanguages, saveResultLanguages } from '@/storage/device-storage';
import { colors, radii } from '@/theme';
import { LanguageSelector } from './language-selector';
import { RefractBackground } from './refract-background';

const SAMPLE = 'I make videos about artificial intelligence.\n\n#AI #MachineLearning #AIArt';
const displayFont = Platform.select({ android: 'sans-serif-black', default: 'system-ui' });
const bodyFont = Platform.select({ android: 'sans-serif-medium', default: 'system-ui' });
type LanguagePair = { sourceLanguage: LanguageCode; targetLanguage: LanguageCode };
type SavedField = 'draft' | 'output' | 'sourceLanguage' | 'targetLanguage' | 'outputLanguages';
const isLanguage = (value: unknown): value is LanguageCode => LANGUAGE_OPTIONS.some((item) => item.code === value);
const byteLabel = (bytes: number) => `${(Math.max(0, bytes) / 1_000_000_000).toFixed(2)} GB`;
const readWarning = 'Could not open local drafts. Nothing was deleted. Use Retry saved text to recover the unavailable field.';
const labelReadWarning = 'Could not open the saved output language label. Your text is unchanged.';
function readSavedOutputLanguages(text: string): LanguagePair | null {
  const saved = readResultLanguages();
  if (!saved) return null;
  const metadata: unknown = JSON.parse(saved);
  if (typeof metadata === 'object' && metadata !== null && 'text' in metadata && metadata.text === text &&
    'sourceLanguage' in metadata && isLanguage(metadata.sourceLanguage) && 'targetLanguage' in metadata && isLanguage(metadata.targetLanguage)) {
    return { sourceLanguage: metadata.sourceLanguage, targetLanguage: metadata.targetLanguage };
  }
  return null;
}

function initialFields() {
  const fields = { draft: '', output: '', sourceLanguage: DEFAULT_SOURCE_LANGUAGE, targetLanguage: DEFAULT_TARGET_LANGUAGE,
    outputLanguages: null as LanguagePair | null, unreadable: { draft: false, output: false }, errors: { draft: '', output: '', sourceLanguage: '', targetLanguage: '', outputLanguages: '' } };
  for (const [key, read] of [['draft', readDraft], ['output', readResult]] as const) {
    try { fields[key] = read() ?? ''; }
    catch { fields.errors[key] = readWarning; fields.unreadable[key] = true; }
  }
  for (const [key, read] of [['sourceLanguage', readSourceLanguage], ['targetLanguage', readTargetLanguage]] as const) {
    try { const value = read(); if (isLanguage(value)) fields[key] = value; }
    catch { fields.errors[key] = 'Could not open saved language choices. Your saved text was not changed.'; }
  }
  try { fields.outputLanguages = readSavedOutputLanguages(fields.output); }
  catch { fields.errors.outputLanguages = labelReadWarning; }
  return fields;
}

export function BiliPopScreen() {
  const [initial] = useState(initialFields);
  const [draft, setDraft] = useState(initial.draft);
  const [output, setOutput] = useState(initial.output);
  const [sourceLanguage, setSourceLanguage] = useState<LanguageCode>(initial.sourceLanguage);
  const [targetLanguage, setTargetLanguage] = useState<LanguageCode>(initial.targetLanguage);
  const [outputLanguages, setOutputLanguages] = useState(initial.outputLanguages);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [copyError, setCopyError] = useState('');
  const actionError = [error, copyError].filter(Boolean).join('\n');
  const [storageErrors, setStorageErrors] = useState(initial.errors);
  const [unreadable, setUnreadable] = useState(initial.unreadable);
  const unreadableFields = useRef(initial.unreadable);
  const storageError = [...new Set(Object.values(storageErrors).filter(Boolean))].join('\n');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadCancelling, setDownloadCancelling] = useState(false);
  const [notices, setNotices] = useState('');
  const [showThanks, setShowThanks] = useState(false);
  const { width } = useWindowDimensions();
  const controller = useRef<AbortController | null>(null);
  const downloadOwner = useRef<object | null>(null);
  const downloadCancelRequested = useRef(false);
  const statusRevision = useRef(0);
  const alive = useRef(true);
  const copyRevision = useRef(0);
  const modelReady = modelStatus?.state === 'ready' && !downloadBusy;

  useEffect(() => {
    alive.current = true;
    const revision = ++statusRevision.current;
    void getModelStatus().then((status) => {
      if (alive.current && statusRevision.current === revision) setModelStatus(status);
    }).catch((caught) => {
      if (alive.current && statusRevision.current === revision) setModelStatus({ state: 'error', downloadedBytes: 0, totalBytes: MODEL_BYTES,
        error: caught instanceof Error ? caught.message : 'Could not check the model on this device.' });
    });
    return () => {
      alive.current = false;
      // Invalidate current requests, including late status and clipboard callbacks.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      copyRevision.current++;
      const pending = controller.current;
      controller.current = null;
      pending?.abort();
      if (downloadOwner.current) { downloadOwner.current = null; cancelModelDownload(); }
    };
  }, []);

  const externalDownload = !downloadBusy && (modelStatus?.state === 'downloading' || modelStatus?.state === 'verifying');
  useEffect(() => {
    if (!externalDownload) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const revision = statusRevision.current;
    const ownsStatus = () => !disposed && alive.current && statusRevision.current === revision;
    const refresh = async () => {
      try {
        const status = await getModelStatus();
        if (!ownsStatus()) return;
        setModelStatus(status);
        if (status.state === 'downloading' || status.state === 'verifying') timer = setTimeout(() => { void refresh(); }, 500);
        else { setDownloadCancelling(false); downloadCancelRequested.current = false; }
      } catch (caught) {
        if (ownsStatus()) {
          setModelStatus((previous) => ({ state: 'error', downloadedBytes: previous?.downloadedBytes ?? 0,
            totalBytes: previous?.totalBytes ?? MODEL_BYTES, error: caught instanceof Error ? caught.message : 'Could not check model setup. Retry when you’re ready.' }));
          setDownloadCancelling(false); downloadCancelRequested.current = false;
        }
      }
    };
    // A reopened screen may observe a previous download finishing cancellation.
    // Status reads never start a download, and only one read is in flight.
    timer = setTimeout(() => { void refresh(); }, 500);
    return () => { disposed = true; if (timer !== undefined) clearTimeout(timer); };
  }, [externalDownload]);

  const persist = (field: SavedField, value: string, save: (value: string) => void) => {
    let message = '';
    try { save(value); }
    catch { message = 'Local saving failed. Copy your text before closing the app.'; }
    setStorageErrors((previous) => ({ ...previous, [field]: message }));
  };
  const resetCopy = () => { copyRevision.current++; setCopied(false); };
  const editDraft = (text: string) => {
    if (!alive.current || controller.current || unreadableFields.current.draft) return;
    setDraft(text); resetCopy(); persist('draft', text, saveDraft);
  };
  const storeOutput = (text: string, pair: LanguagePair | null) => {
    if (!alive.current || unreadableFields.current.output) return;
    setOutput(text); setOutputLanguages(pair); resetCopy();
    let message = '';
    try {
      // Clear old provenance first: a failed text or metadata write must never
      // attach an old language label to newly saved text (even identical text).
      saveResultLanguages('');
      saveResult(text);
      if (pair) saveResultLanguages(JSON.stringify({ text, ...pair }));
    } catch { message = 'Local saving failed. Copy your text before closing the app.'; }
    setStorageErrors((previous) => ({ ...previous, output: message, outputLanguages: '' }));
  };
  const editOutput = (text: string) => { if (!controller.current) storeOutput(text, outputLanguages); };
  const retrySavedText = () => {
    if (!alive.current || controller.current) return;
    const remaining = { ...unreadableFields.current };
    const messages: Partial<Record<SavedField, string>> = {};
    let recovered = false;
    for (const [field, read] of [['draft', readDraft], ['output', readResult]] as const) {
      if (!remaining[field]) continue; // Never reload a field the user could edit.
      try {
        const text = read() ?? '';
        if (field === 'draft') setDraft(text);
        else {
          setOutput(text); setOutputLanguages(null);
          try { setOutputLanguages(readSavedOutputLanguages(text)); messages.outputLanguages = ''; }
          catch { messages.outputLanguages = labelReadWarning; }
        }
        remaining[field] = false; messages[field] = ''; recovered = true;
      } catch { messages[field] = readWarning; }
    }
    unreadableFields.current = remaining;
    setUnreadable(remaining);
    setStorageErrors((previous) => ({ ...previous, ...messages }));
    if (recovered) resetCopy();
  };

  const selectLanguage = (kind: 'source' | 'target', value: LanguageCode) => {
    if (controller.current || busy) return;
    if (kind === 'source') { setSourceLanguage(value); persist('sourceLanguage', value, saveSourceLanguage); }
    else { setTargetLanguage(value); persist('targetLanguage', value, saveTargetLanguage); }
  };

  const startDownload = async () => {
    if (downloadOwner.current || controller.current) return;
    const current = {};
    downloadOwner.current = current;
    downloadCancelRequested.current = false;
    statusRevision.current++;
    setDownloadBusy(true); setDownloadCancelling(false);
    const ownsDownload = () => alive.current && downloadOwner.current === current;
    try {
      const status = await downloadModel((value) => { if (ownsDownload()) setModelStatus(value); });
      if (ownsDownload()) setModelStatus(status);
    } catch (caught) {
      if (ownsDownload()) setModelStatus((previous) => ({ state: 'error', downloadedBytes: previous?.downloadedBytes ?? 0,
        totalBytes: previous?.totalBytes ?? MODEL_BYTES, error: caught instanceof Error ? caught.message : 'Model download failed. Your text is safe.' }));
    } finally {
      if (downloadOwner.current === current) {
        downloadOwner.current = null;
        if (alive.current) { setDownloadBusy(false); setDownloadCancelling(false); }
      }
    }
  };
  const cancelDownload = () => {
    if ((!downloadOwner.current && !externalDownload) || downloadCancelRequested.current) return;
    downloadCancelRequested.current = true;
    setDownloadCancelling(true);
    cancelModelDownload();
  };
  const cancel = () => {
    const pending = controller.current;
    if (!pending) return;
    // Revoke ownership before aborting, so an old native completion cannot save.
    controller.current = null;
    pending.abort();
    setBusy(false); setProgress(null);
    setError('Translation cancelled. Your original text is unchanged.');
  };
  const translate = async () => {
    if (controller.current || busy || !modelReady || !draft.trim() || unreadableFields.current.draft || unreadableFields.current.output) return;
    try { validatePostInput(draft, { sourceLanguage, targetLanguage }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Check your input and language choices.'); return; }
    const input = draft;
    const pair = { sourceLanguage, targetLanguage };
    setBusy(true); resetCopy(); setError(''); setCopyError(''); setProgress(null);
    const current = new AbortController();
    controller.current = current;
    const ownsRequest = () => alive.current && controller.current === current && !current.signal.aborted;
    try {
      const model = await getTranslator();
      if (!ownsRequest()) return;
      const result = await translatePost(input, model, {
        ...pair, signal: current.signal,
        onProgress: (value) => { if (ownsRequest()) setProgress(value); },
      });
      if (ownsRequest()) {
        storeOutput(result.caption, pair);
        if (result.warnings.length) setError(result.warnings.join('\n'));
      }
    } catch (caught) {
      if (ownsRequest()) setError(caught instanceof Error ? caught.message : 'Translation failed. Your original is safe.');
    } finally {
      if (controller.current === current) {
        controller.current = null;
        if (alive.current) { setBusy(false); setProgress(null); }
      }
    }
  };
  const copy = async () => {
    const revision = ++copyRevision.current;
    setCopied(false);
    try {
      await Clipboard.setStringAsync(output);
      if (alive.current && copyRevision.current === revision) { setCopied(true); setCopyError(''); }
    } catch {
      if (alive.current && copyRevision.current === revision) setCopyError('Could not copy. You can select and copy the output manually.');
    }
  };
  const statusText = !modelStatus ? 'Checking the model on this device…'
    : downloadCancelling ? 'Cancelling model download…'
    : modelStatus.state === 'ready' ? 'Model downloaded. Translation runs on this device.'
    : modelStatus.state === 'downloading' ? `Downloading model: ${byteLabel(modelStatus.downloadedBytes)} / ${byteLabel(modelStatus.totalBytes)}`
    : modelStatus.state === 'verifying' ? 'Verifying the downloaded model before use…'
    : downloadBusy ? 'Starting model download…'
    : modelStatus.state === 'paused' ? `Download paused at ${byteLabel(modelStatus.downloadedBytes)}. Resume when you’re ready.`
    : modelStatus.state === 'unsupported' ? modelStatus.error ?? 'This browser is a UI preview. On-device translation requires the Android app.'
    : modelStatus.state === 'error' ? modelStatus.error ?? 'Model setup failed. Retry when you’re ready.'
    : `First use: download the ${byteLabel(MODEL_BYTES)} translation model. Internet is needed for this download; translation then works offline.`;
  const canDownload = modelStatus && ['missing', 'paused', 'error'].includes(modelStatus.state) && !downloadBusy;
  const popDisabled = busy || !modelReady || !draft.trim() || unreadable.draft || unreadable.output;

  return (
    <View style={styles.root}>
      <RefractBackground paused={busy} />
      <SafeAreaView style={styles.safe}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.scroll, width < 400 && styles.narrowScroll]} keyboardShouldPersistTaps="handled">
          <Text style={[styles.kicker, styles.onBackground]}>your words. more languages.</Text>
          <Text style={[styles.title, styles.onBackground]}>BiliPop</Text>
          <Text style={[styles.subtitle, styles.onBackground]}>Translate text and hashtags between languages, on your phone.</Text>
          <Pressable accessibilityRole="button" testID="translate-button" onPress={() => { void translate(); }}
            disabled={popDisabled} style={({ pressed }) => [styles.popButton, pressed && styles.pressed, popDisabled && styles.disabled]}>
            <Text style={styles.popText}>POP IT!</Text>
          </Pressable>
          <View testID="model-status" style={styles.status}>
            {!modelStatus || downloadBusy || externalDownload ? <ActivityIndicator color={colors.mint} /> : null}
            <Text testID="model-status-message" accessibilityLiveRegion="polite" style={[styles.meta, styles.onBackground]}>{statusText}</Text>
            {canDownload ? <Pressable accessibilityRole="button" testID="download-model" onPress={() => { void startDownload(); }} style={styles.copyButton}>
              <Text style={styles.copyText}>{modelStatus.state === 'paused' ? 'Resume download' : modelStatus.state === 'error' ? 'Retry download' : 'Download model'}</Text>
            </Pressable> : null}
            {downloadBusy || externalDownload ? <Pressable accessibilityRole="button" disabled={downloadCancelling} onPress={cancelDownload} style={styles.copyButton}>
              <Text style={styles.copyText}>Cancel download</Text>
            </Pressable> : null}
          </View>
          {busy ? <View style={styles.card}>
            <ActivityIndicator color={colors.bubbleDeep} />
            <Text testID="translation-progress" accessibilityLiveRegion="polite" style={styles.meta}>
              {progress ? `Translating on your phone: ${progress.completed} / ${progress.total}` : 'Loading the downloaded translation model…'}
            </Text>
            <Pressable accessibilityRole="button" onPress={cancel} style={styles.sample}><Text style={styles.meta}>Cancel</Text></Pressable>
          </View> : null}
          {actionError ? <Text selectable accessibilityRole="alert" style={styles.error}>{actionError}</Text> : null}
          {storageError ? <Text selectable accessibilityRole="alert" style={styles.error}>{storageError}</Text> : null}
          {unreadable.draft || unreadable.output ? <Pressable accessibilityRole="button" disabled={busy} onPress={retrySavedText} style={styles.copyButton}>
            <Text style={styles.copyText}>Retry saved text</Text>
          </Pressable> : null}
          <View style={styles.card}>
            <Text style={styles.label}>input text + hashtags</Text>
            <TextInput accessibilityLabel="Input text and hashtags" testID="source-input" value={draft}
              onChangeText={editDraft} editable={!busy && !unreadable.draft} multiline textAlignVertical="top"
              placeholder={unreadable.draft ? 'Saved input is temporarily unavailable' : 'Paste your text and #hashtags'} placeholderTextColor={colors.inkSoft}
              autoCorrect={false} style={styles.input} />
            {!draft && !unreadable.draft && sourceLanguage === 'en' ? <Pressable accessibilityRole="button" onPress={() => editDraft(SAMPLE)} style={styles.sample}>
              <Text style={styles.meta}>Try an AI video example</Text>
            </Pressable> : null}
            <Text style={styles.meta}>{draft.length} / 4,000 characters per translation</Text>
          </View>
          <View testID="language-controls" style={styles.card}>
            <LanguageSelector kind="source" value={sourceLanguage} disabled={busy} onChange={(value) => selectLanguage('source', value)} />
            <LanguageSelector kind="target" value={targetLanguage} disabled={busy} onChange={(value) => selectLanguage('target', value)} />
            <Text style={styles.meta}>38 options from the upstream language table. Quality varies by language and needs review. Choices apply to the next translation.</Text>
          </View>
          <View style={styles.card} testID="translation-result">
            <Text style={styles.label}>output text + hashtags</Text>
            <Text testID="output-language-label" style={styles.meta}>{outputLanguages
              ? `Last translation: ${languageName(outputLanguages.sourceLanguage)} → ${languageName(outputLanguages.targetLanguage)}`
              : output ? 'Saved text. Its translation languages were not recorded.' : `Next translation: ${languageName(targetLanguage)}`}</Text>
            <Text style={styles.meta}>Machine translation. Review and edit before sharing. This saved output changes only when you edit it or finish another translation.</Text>
            <TextInput accessibilityLabel="Editable output text and hashtags" testID="translated-output"
              value={output} onChangeText={editOutput} editable={!busy && !unreadable.output} multiline textAlignVertical="top"
              placeholder={unreadable.output ? 'Saved output is temporarily unavailable' : 'Your translation appears here'} placeholderTextColor={colors.inkSoft}
              autoCorrect={false} style={[styles.input, styles.output]} />
            <Pressable accessibilityRole="button" disabled={busy || !output} onPress={() => { void copy(); }} style={[styles.copyButton, !output && styles.disabled]}>
              <Text style={styles.copyText}>{copied ? 'COPIED!' : 'COPY TEXT + TAGS'}</Text>
            </Pressable>
          </View>
          <Text style={[styles.hint, styles.onBackground]}>Both fields and language choices save locally. Your text is not sent to a server. No accounts, trend searches or uploads. Names, slang and context can still need correction.</Text>
          <Text style={[styles.meta, styles.onBackground]}>Translation model: Hatsunama/caption-studio-hy-mt2-1.8b-q8, based on HY-MT2. See model credits and licenses.</Text>
          <Pressable accessibilityRole="button" style={styles.sample} onPress={() => {
            if (notices) { setNotices(''); return; }
            void getModelNotices().then((value) => { if (alive.current) setNotices(value); })
              .catch(() => { if (alive.current) setError('Could not open the model notices.'); });
          }}><Text style={styles.meta}>{notices ? 'Hide licenses' : 'Model credits and licenses'}</Text></Pressable>
          {notices ? <Text selectable style={[styles.meta, styles.onBackground]}>{notices}</Text> : null}
          <Pressable accessibilityRole="button" onPress={() => setShowThanks(true)} style={styles.copyButton}>
            <Text style={styles.copyText}>Hatsu Is Here For You</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
      <Modal visible={showThanks} animationType="none" supportedOrientations={['portrait', 'landscape']}
        onRequestClose={() => setShowThanks(false)}>
        <SafeAreaView style={styles.thanksRoot}>
          <ScrollView contentContainerStyle={[styles.scroll, styles.thanksScroll]}>
            <View style={styles.card}>
              <Text accessibilityRole="header" style={styles.thanksTitle}>Thank you</Text>
              <Text style={styles.subtitle}>Thanks for downloading BiliPop and spending time with it. Hope your captions make your world a little brighter.</Text>
              <Text selectable style={styles.hint}>If you want to support Hatsu please subscribe to the Patreon @Hatsunama</Text>
              <Pressable accessibilityRole="button" onPress={() => setShowThanks(false)} style={styles.copyButton}>
                <Text style={styles.copyText}>Back to Home</Text>
              </Pressable>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  thanksRoot: { flex: 1, backgroundColor: '#0A0B0E' },
  thanksScroll: { flexGrow: 1, justifyContent: 'center' },
  thanksTitle: { fontFamily: displayFont, color: colors.bubbleDeep, fontSize: 28, lineHeight: 34 },
  onBackground: { color: '#FFF7FB', textShadowColor: '#000000', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  root: { flex: 1, backgroundColor: '#0A0B0E' },
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 60, gap: 16, width: '100%', maxWidth: 720, alignSelf: 'center' },
  narrowScroll: { paddingHorizontal: 16 },
  kicker: { fontFamily: bodyFont, color: colors.inkSoft, fontSize: 13, letterSpacing: 1.2, textTransform: 'uppercase' },
  title: { fontFamily: displayFont, color: colors.ink, fontSize: 56, lineHeight: 60 },
  subtitle: { fontFamily: bodyFont, color: colors.ink, fontSize: 17, lineHeight: 24 },
  status: { gap: 10 },
  card: { backgroundColor: colors.cream, borderRadius: radii.card, padding: 16, borderWidth: 2, borderColor: colors.ink, gap: 12 },
  label: { fontFamily: displayFont, color: colors.bubbleDeep, fontSize: 14, textTransform: 'uppercase' },
  input: { minHeight: 150, fontFamily: bodyFont, color: colors.ink, fontSize: 17, lineHeight: 25 },
  output: { minHeight: 180 },
  sample: { alignSelf: 'flex-start', backgroundColor: colors.lemon, borderRadius: radii.pill, padding: 12, minHeight: 44 },
  meta: { fontFamily: bodyFont, color: colors.inkSoft, fontSize: 13, lineHeight: 19 },
  popButton: { backgroundColor: colors.bubbleDeep, borderRadius: radii.pill, minHeight: 64, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.ink },
  popText: { fontFamily: displayFont, color: colors.cream, fontSize: 24 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
  copyButton: { backgroundColor: colors.mint, borderRadius: radii.pill, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.ink },
  copyText: { fontFamily: displayFont, color: colors.ink, fontSize: 17 },
  error: { color: colors.ink, backgroundColor: colors.lemon, padding: 14, borderRadius: 12, fontSize: 15 },
  hint: { fontFamily: bodyFont, color: colors.inkSoft, fontSize: 14, lineHeight: 21, textAlign: 'center' },
});
