// Upstream table: https://huggingface.co/tencent/Hy-MT2-1.8B/blob/9a341cd1b679d3efd23b46e847b01745a71ed792/README.md#supported-languages
// Upstream support is not adapted-Q8 quality certification for every direction.
export const LANGUAGE_OPTIONS = [
  {
    "code": "ar",
    "name": "Arabic"
  },
  {
    "code": "bn",
    "name": "Bengali"
  },
  {
    "code": "my",
    "name": "Burmese"
  },
  {
    "code": "yue",
    "name": "Cantonese"
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
    "code": "en",
    "name": "English"
  },
  {
    "code": "tl",
    "name": "Filipino"
  },
  {
    "code": "fr",
    "name": "French"
  },
  {
    "code": "de",
    "name": "German"
  },
  {
    "code": "gu",
    "name": "Gujarati"
  },
  {
    "code": "he",
    "name": "Hebrew"
  },
  {
    "code": "hi",
    "name": "Hindi"
  },
  {
    "code": "id",
    "name": "Indonesian"
  },
  {
    "code": "it",
    "name": "Italian"
  },
  {
    "code": "ja",
    "name": "Japanese"
  },
  {
    "code": "kk",
    "name": "Kazakh"
  },
  {
    "code": "km",
    "name": "Khmer"
  },
  {
    "code": "ko",
    "name": "Korean"
  },
  {
    "code": "ms",
    "name": "Malay"
  },
  {
    "code": "mr",
    "name": "Marathi"
  },
  {
    "code": "mn",
    "name": "Mongolian"
  },
  {
    "code": "fa",
    "name": "Persian"
  },
  {
    "code": "pl",
    "name": "Polish"
  },
  {
    "code": "pt",
    "name": "Portuguese"
  },
  {
    "code": "ru",
    "name": "Russian"
  },
  {
    "code": "zh",
    "name": "Simplified Chinese"
  },
  {
    "code": "es",
    "name": "Spanish"
  },
  {
    "code": "ta",
    "name": "Tamil"
  },
  {
    "code": "te",
    "name": "Telugu"
  },
  {
    "code": "th",
    "name": "Thai"
  },
  {
    "code": "bo",
    "name": "Tibetan"
  },
  {
    "code": "zh-Hant",
    "name": "Traditional Chinese"
  },
  {
    "code": "tr",
    "name": "Turkish"
  },
  {
    "code": "uk",
    "name": "Ukrainian"
  },
  {
    "code": "ur",
    "name": "Urdu"
  },
  {
    "code": "ug",
    "name": "Uyghur"
  },
  {
    "code": "vi",
    "name": "Vietnamese"
  }
] as const;

export type LanguageCode = typeof LANGUAGE_OPTIONS[number]["code"];
export const DEFAULT_SOURCE_LANGUAGE: LanguageCode = "en";
// The list is kept in deterministic alphabetical order by its visible English names.
export const DEFAULT_TARGET_LANGUAGE: LanguageCode = LANGUAGE_OPTIONS[0].code;
export function languageName(code: string): string {
  const language = LANGUAGE_OPTIONS.find((item) => item.code === code);
  if (!language) throw new Error("Choose a supported language.");
  return language.name;
}
export function validateLanguagePair(source: string, target: string): void {
  languageName(source); languageName(target);
  if (source === target) throw new Error("Choose different source and target languages.");
}
