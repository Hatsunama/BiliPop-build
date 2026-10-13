import { LocalTranslator, type TextModelRuntime } from './local-model';

export interface ManagedTextRuntime extends TextModelRuntime { load(): Promise<void>; release(): Promise<void> }
/** A rejected load is retryable; release invalidates in-flight/queued callers. */
export class ModelManager {
  private model: Promise<LocalTranslator> | undefined;
  private lifecycle: Promise<unknown> = Promise.resolve();
  private generation = 0;
  constructor(private readonly runtime: ManagedTextRuntime) {}
  get(): Promise<LocalTranslator> {
    if (this.model) return this.model;
    const generation = this.generation;
    const loaded = this.lifecycle.then(async () => {
      if (generation !== this.generation) throw new Error('Translation cancelled. Your original is unchanged.');
      await this.runtime.load();
      if (generation !== this.generation) throw new Error('Translation cancelled. Your original is unchanged.');
      return new LocalTranslator(this.runtime, () => generation === this.generation);
    });
    this.lifecycle = loaded.catch(() => {});
    this.model = loaded;
    void loaded.catch(() => { if (this.model === loaded) this.model = undefined; });
    return loaded;
  }
  release(): Promise<void> {
    this.generation++;
    this.model = undefined;
    this.runtime.cancel();
    const released = this.lifecycle.then(() => this.runtime.release());
    this.lifecycle = released.catch(() => {});
    return released;
  }
}
