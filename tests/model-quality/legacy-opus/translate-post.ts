import { checkCancelled, type TranslateOptions } from './local-model';
import { formatBilibiliCaption, parseEnglishPost } from './parse-post';

export type TextTranslator = { translate: (text: string, options?: TranslateOptions) => Promise<string> };
export type TranslationResult = { description: string; tags: { original: string; translated: string }[]; caption: string; warnings: string[] };
export type Progress = { completed: number; total: number };

// Terminology constraints supplement sentence translation; never a sentence fallback.
const TERMS: Record<string, string> = {
  'artificial intelligence': '人工智能', 'machine learning': '机器学习',
  'deep learning': '深度学习', 'large language model': '大语言模型',
  'large language models': '大语言模型', 'generative ai': '生成式人工智能',
  'short film': '短片', 'short films': '短片', 'matcha': '抹茶',
};
const TAG_PHRASES: Record<string, string> = {
  ai: 'artificial intelligence', aiart: 'AI art', aivideo: 'AI video',
  aigenerated: 'AI generated', machinelearning: 'machine learning',
  deeplearning: 'deep learning', generativeai: 'generative AI',
  texttovideo: 'text to video', texttoimage: 'text to image',
  shortfilm: 'short film', shortfilms: 'short films', behindthescenes: 'behind the scenes',
};
const PROTECTED = /(https?:\/\/[^\s]+|\p{Script=Han}+|\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:[\u{E0020}-\u{E007E}]+\u{E007F})?(?:[\uFE0F\u200D\p{Emoji_Modifier}]|\p{Extended_Pictographic}(?:[\u{E0020}-\u{E007E}]+\u{E007F})?)*)/giu;

export function tagToWords(tag: string): string {
  // Keep retained Han spelling even when a tag mixes it with compatibility Latin.
  const candidate = tag.replace(/[^\p{Script=Han}]+/gu, (part) => part.normalize('NFKC'));
  if (!/[A-Za-z]/.test(candidate)) return tag;
  const key = candidate.toLowerCase().replace(/_/g, '');
  return Object.hasOwn(TAG_PHRASES, key) ? TAG_PHRASES[key]! : candidate.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/_+/g, ' ');
}

export async function translateUnit(text: string, model: TextTranslator, options: TranslateOptions): Promise<string> {
  checkCancelled(options.signal);
  const candidate = text.normalize('NFKC');
  if (!/[A-Za-z]/.test(candidate)) return text;
  const key = candidate.toLowerCase();
  if (Object.hasOwn(TERMS, key)) return TERMS[key]!;
  const parts = text.split(PROTECTED);
  const output: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    checkCancelled(options.signal);
    const part = parts[i]!;
    if (i % 2 === 1 || !part.trim()) { output.push(part); continue; }
    // Split first so compatibility normalization never rewrites protected text.
    const candidate = part.trim().normalize('NFKC');
    if (!/[A-Za-z]/.test(candidate)) { output.push(part); continue; }
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
  if (!input.trim()) throw new Error('Paste an English caption or hashtags first.');
  if (input.length > 4000) throw new Error('Please translate up to 4,000 characters at a time. Your draft has not been cut.');
  const parsed = parseEnglishPost(input);
  if (parsed.hashtags.length > 30) throw new Error('Please translate up to 30 hashtags at a time.');
  const parts = parsed.body.split(/(\n+|(?<=[.!?。！？])\s+)/u);
  const total = parts.filter((part) => /\S/.test(part)).length + parsed.hashtags.length;
  let completed = 0;
  const progress = () => options.onProgress?.({ completed, total });
  progress();
  const translatedParts: string[] = [];
  for (const part of parts) {
    checkCancelled(options.signal);
    if (!/\S/.test(part)) { translatedParts.push(part); continue; }
    translatedParts.push(await translateUnit(part, model, options));
    completed++; progress();
  }
  const tags: TranslationResult['tags'] = [];
  for (const original of parsed.hashtags) {
    checkCancelled(options.signal);
    const translated = (await translateUnit(tagToWords(original), model, options))
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
  for (const [english, chinese] of Object.entries(TERMS)) {
    if (new RegExp('\\b' + english + '\\b', 'i').test(parsed.body) && !description.includes(chinese)) {
      warnings.push(`Review the term “${english}”; its expected translation is “${chinese}”.`);
    }
  }
  return { description, tags, warnings, caption: formatBilibiliCaption(description, [...new Set(tags.map((tag) => tag.translated))]) };
}

