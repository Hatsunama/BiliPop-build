import { checkCancelled, type TranslateOptions } from './local-model';
import { formatBilibiliCaption, parseEnglishPost } from './parse-post';
import { DEFAULT_SOURCE_LANGUAGE, DEFAULT_TARGET_LANGUAGE, validateLanguagePair, type LanguageCode } from './languages';

export type TextTranslator = { translate: (text: string, options?: TranslateOptions) => Promise<string> };
export type TranslationResult = { description: string; tags: { original: string; translated: string }[]; caption: string; warnings: string[] };
export type Progress = { completed: number; total: number };

const TAG_PHRASES: Record<string, string> = {
  ai: 'artificial intelligence', aiart: 'AI art', aivideo: 'AI video',
  aigenerated: 'AI generated', machinelearning: 'machine learning',
  deeplearning: 'deep learning', generativeai: 'generative AI',
  texttovideo: 'text to video', texttoimage: 'text to image',
  shortfilm: 'short film', shortfilms: 'short films', behindthescenes: 'behind the scenes',
};
const PROTECTED = /(https?:\/\/[^\s]+|\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:[\u{E0020}-\u{E007E}]+\u{E007F})?(?:[\uFE0F\u200D\p{Emoji_Modifier}]|\p{Extended_Pictographic}(?:[\u{E0020}-\u{E007E}]+\u{E007F})?)*)/giu;

export function tagToWords(tag: string, sourceLanguage: LanguageCode = DEFAULT_SOURCE_LANGUAGE): string {
  // Keep retained Han spelling even when a tag mixes it with compatibility Latin.
  const candidate = tag.replace(/[^\p{Script=Han}]+/gu, (part) => part.normalize('NFKC'));
  if (!/[A-Za-z]/.test(candidate)) return tag;
  const key = candidate.toLowerCase().replace(/_/g, '');
  return sourceLanguage === 'en' && Object.hasOwn(TAG_PHRASES, key) ? TAG_PHRASES[key]! : candidate.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/_+/g, ' ');
}

export async function translateUnit(text: string, model: TextTranslator, options: TranslateOptions): Promise<string> {
  checkCancelled(options.signal);
  const parts = text.split(PROTECTED);
  const output: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    checkCancelled(options.signal);
    const part = parts[i]!;
    if (i % 2 === 1 || !part.trim()) { output.push(part); continue; }
    // Preserve source spelling; the model owns all languages, including mixed scripts.
    const candidate = part.trim();
    if (!/[\p{L}\p{N}]/u.test(candidate)) { output.push(part); continue; }
    const leading = part.match(/^\s*/u)![0];
    const trailing = part.match(/\s*$/u)![0];
    const translated = await model.translate(candidate, options);
    checkCancelled(options.signal);
    if (!translated.trim()) throw new Error('No translation produced. Your original is retained.');
    output.push(leading + translated.trim() + trailing);
  }
  return output.join('');
}

export async function translatePost(input: string, model: TextTranslator,
  options: TranslateOptions & { onProgress?: (progress: Progress) => void } = {}): Promise<TranslationResult> {
  if (!input.trim()) throw new Error('Paste text or hashtags first.');
  const sourceLanguage = options.sourceLanguage ?? DEFAULT_SOURCE_LANGUAGE;
  const targetLanguage = options.targetLanguage ?? DEFAULT_TARGET_LANGUAGE;
  validateLanguagePair(sourceLanguage, targetLanguage);
  const request = { ...options, sourceLanguage, targetLanguage };
  if (input.length > 4000) throw new Error('Please translate up to 4,000 characters at a time. Your draft has not been cut.');
  const parsed = parseEnglishPost(input);
  if (parsed.hashtags.length > 30) throw new Error('Please translate up to 30 hashtags at a time.');
  const parts = parsed.body.split(/(\n+|(?<=[.!?])[^\S\n]+|(?<=[。！？]))/u);
  const total = parts.filter((part) => /\S/.test(part)).length + parsed.hashtags.length;
  let completed = 0;
  const progress = () => options.onProgress?.({ completed, total });
  progress();
  const translatedParts: string[] = [];
  for (const part of parts) {
    checkCancelled(options.signal);
    if (!/\S/.test(part)) { translatedParts.push(part); continue; }
    translatedParts.push(await translateUnit(part, model, request));
    completed++; progress();
  }
  const tags: TranslationResult['tags'] = [];
  for (const original of parsed.hashtags) {
    checkCancelled(options.signal);
    const translated = (await translateUnit(tagToWords(original, sourceLanguage), model, request))
      .replace(/[\s#＃]+/gu, '').replace(/[。.!！?？]+$/u, '');
    if (!translated) throw new Error(`No translation for #${original}. Your original is retained.`);
    tags.push({ original, translated });
    completed++; progress();
  }
  checkCancelled(options.signal);
  const description = translatedParts.join('').trim();
  const warnings: string[] = [];
  const sourceNumbers = parsed.body.match(/\d+(?:[.,]\d+)*/g) ?? [];
  const resultNumbers = description.match(/\d+(?:[.,]\d+)*/g) ?? [];
  if (JSON.stringify(sourceNumbers) !== JSON.stringify(resultNumbers)) warnings.push('Check the numbers: the model changed their written form.');
  return { description, tags, warnings, caption: formatBilibiliCaption(description, [...new Set(tags.map((tag) => tag.translated))]) };
}

