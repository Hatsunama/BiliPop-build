// Upstream table: https://huggingface.co/tencent/Hy-MT2-1.8B/blob/9a341cd1b679d3efd23b46e847b01745a71ed792/README.md#supported-languages
// Upstream support is not adapted-Q8 quality certification for every direction.
export const LANGUAGE_OPTIONS = [
  {
    "code": "zh",
    "name": "Simplified Chinese"
  },
  {
    "code": "en",
    "name": "English"
  },
  {
    "code": "fr",
    "name": "French"
  },
  {
    "code": "pt",
    "name": "Portuguese"
  },
  {
    "code": "es",
    "name": "Spanish"
  },
  {
    "code": "ja",
    "name": "Japanese"
  },
  {
    "code": "tr",
    "name": "Turkish"
  },
  {
    "code": "ru",
    "name": "Russian"
  },
  {
    "code": "ar",
    "name": "Arabic"
  },
  {
    "code": "ko",
    "name": "Korean"
  },
  {
    "code": "th",
    "name": "Thai"
  },
  {
    "code": "it",
    "name": "Italian"
  },
  {
    "code": "de",
    "name": "German"
  },
  {
    "code": "vi",
    "name": "Vietnamese"
  },
  {
    "code": "ms",
    "name": "Malay"
  },
  {
    "code": "id",
    "name": "Indonesian"
  },
  {
    "code": "tl",
    "name": "Filipino"
  },
  {
    "code": "hi",
    "name": "Hindi"
  },
  {
    "code": "zh-Hant",
    "name": "Traditional Chinese"
  },
  {
    "code": "pl",
    "name": "Polish"
  },
  {
    "code": "cs",
    "name": "Czech"
  },
  {
    "code": "nl",
    "name": "Dutch"
  },
  {
    "code": "km",
    "name": "Khmer"
  },
  {
    "code": "my",
    "name": "Burmese"
  },
  {
    "code": "fa",
    "name": "Persian"
  },
  {
    "code": "gu",
    "name": "Gujarati"
  },
  {
    "code": "ur",
    "name": "Urdu"
  },
  {
    "code": "te",
    "name": "Telugu"
  },
  {
    "code": "mr",
    "name": "Marathi"
  },
  {
    "code": "he",
    "name": "Hebrew"
  },
  {
    "code": "bn",
    "name": "Bengali"
  },
  {
    "code": "ta",
    "name": "Tamil"
  },
  {
    "code": "uk",
    "name": "Ukrainian"
  },
  {
    "code": "bo",
    "name": "Tibetan"
  },
  {
    "code": "kk",
    "name": "Kazakh"
  },
  {
    "code": "mn",
    "name": "Mongolian"
  },
  {
    "code": "ug",
    "name": "Uyghur"
  },
  {
    "code": "yue",
    "name": "Cantonese"
  }
] as const;

export type LanguageCode = typeof LANGUAGE_OPTIONS[number]["code"];
export const DEFAULT_SOURCE_LANGUAGE: LanguageCode = "en";
export const DEFAULT_TARGET_LANGUAGE: LanguageCode = "zh";
export function languageName(code: string): string {
  const language = LANGUAGE_OPTIONS.find((item) => item.code === code);
  if (!language) throw new Error("Choose a supported language.");
  return language.name;
}
export function validateLanguagePair(source: string, target: string): void {
  languageName(source); languageName(target);
  if (source === target) throw new Error("Choose different source and target languages.");
}
