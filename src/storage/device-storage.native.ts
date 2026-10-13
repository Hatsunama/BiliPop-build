import 'expo-sqlite/localStorage/install';

export function readDraft(): string | null { return localStorage.getItem('bilipop.draft.v1'); }
export function saveDraft(value: string): void { localStorage.setItem('bilipop.draft.v1', value); }
export function readResult(): string | null { return localStorage.getItem('bilipop.result.v1'); }
export function saveResult(value: string): void { localStorage.setItem('bilipop.result.v1', value); }

export function readSourceLanguage(): string | null { return localStorage.getItem('bilipop.sourceLanguage.v1') ?? null; }
export function saveSourceLanguage(value: string): void { localStorage.setItem('bilipop.sourceLanguage.v1', value); }

export function readTargetLanguage(): string | null { return localStorage.getItem('bilipop.targetLanguage.v1') ?? null; }
export function saveTargetLanguage(value: string): void { localStorage.setItem('bilipop.targetLanguage.v1', value); }

export function readResultLanguages(): string | null { return localStorage.getItem('bilipop.resultLanguages.v1') ?? null; }
export function saveResultLanguages(value: string): void { localStorage.setItem('bilipop.resultLanguages.v1', value); }
