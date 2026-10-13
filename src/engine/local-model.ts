import { buildTranslationPrompt, type LanguagePairOptions } from './model-contract';

export type TranslateOptions = LanguagePairOptions & { signal?: AbortSignal };
export interface TextModelRuntime {
  epoch(): number;
  cancel(): void;
  translate(prompt: string, requestEpoch: number): Promise<string>;
}
export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Translation cancelled. Your original text is unchanged.');
}

/** Text-in/text-out. Tokenization and chat templating belong to the pinned LiteRT artifact. */
export class LocalTranslator {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly runtime: TextModelRuntime, private readonly isValid: () => boolean = () => true) {}

  translate(text: string, options: TranslateOptions = {}): Promise<string> {
    options = { ...options };
    const run = this.queue.then(async () => {
      if (!this.isValid()) throw new Error('Translation cancelled. Your original is unchanged.');
      checkCancelled(options.signal);
      if (!text.trim()) return text;
      const prompt = buildTranslationPrompt(text, options);
      const requestEpoch = this.runtime.epoch();
      const cancel = () => this.runtime.cancel();
      options.signal?.addEventListener('abort', cancel, { once: true });
      try {
        checkCancelled(options.signal);
        const output = await this.runtime.translate(prompt, requestEpoch);
        checkCancelled(options.signal);
        if (!this.isValid()) throw new Error('Translation cancelled. Your original is unchanged.');
        if (!output.trim()) throw new Error('No translation produced. Your original is retained.');
        return output.trim();
      } finally { options.signal?.removeEventListener('abort', cancel); }
    });
    this.queue = run.catch(() => {});
    return run;
  }
}
