import { Tokenizer } from '@huggingface/tokenizers';
import type * as Ort from 'onnxruntime-common';

export type ModelRuntime = Pick<typeof Ort, 'Tensor' | 'InferenceSession'>;
export type TranslateOptions = { signal?: AbortSignal };

export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Translation cancelled. Your original text is unchanged.');
}

// Runs only bundled Marian EN→ZH graphs. No network or fallback vocabulary.
export class LocalTranslator {
  constructor(
    private ort: ModelRuntime,
    private tokenizer: Tokenizer,
    private encoder: Ort.InferenceSession,
    private decoder: Ort.InferenceSession,
  ) {}

  async translate(text: string, { signal }: TranslateOptions = {}): Promise<string> {
    checkCancelled(signal);
    const candidate = text.normalize('NFKC');
    if (!candidate.trim() || !/[A-Za-z]/.test(candidate)) return text;
    // Marian's multilingual Chinese target requires a sentence-initial language ID.
    const languageId = this.tokenizer.token_to_id('>>cmn_Hans<<');
    if (languageId !== 5) throw new Error('The bundled tokenizer does not match the translation model.');
    const ids = [languageId, ...this.tokenizer.encode(candidate).ids];
    if (ids.length > 256) {
      throw new Error('One sentence is too long for the local model. Split it into shorter sentences.');
    }
    const { Tensor } = this.ort;
    const owned = new Set<Ort.Tensor>();
    const own = (tensor: Ort.Tensor) => { owned.add(tensor); return tensor; };
    const drop = (tensor: Ort.Tensor) => { if (owned.delete(tensor)) tensor.dispose(); };
    const past: Record<string, Ort.Tensor> = {};
    try {
      const input = own(new Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]));
      const mask = own(new Tensor('int64', new BigInt64Array(ids.length).fill(1n), [1, ids.length]));
      const encoded = await this.encoder.run({ input_ids: input, attention_mask: mask });
      for (const tensor of Object.values(encoded)) own(tensor);
      const hidden = encoded.last_hidden_state;
      if (!hidden) throw new Error('The encoder output does not match the bundled model.');
      for (const name of this.decoder.inputNames.filter((name) => name.startsWith('past_key_values.'))) {
        past[name] = own(new Tensor('float32', new Float32Array(0), [1, 8, 0, 64]));
      }
      type Beam = { tokens: number[]; score: number; past: Record<string, Ort.Tensor> };
      const width = 4;
      let beams: Beam[] = [{ tokens: [65000], score: 0, past }];
      const finished: { tokens: number[]; score: number }[] = [];
      for (let step = 0; step < 192; step++) {
        checkCancelled(signal);
        const candidates: Beam[] = [];
        for (const beam of beams) {
          checkCancelled(signal);
          const decoderInput = own(new Tensor('int64', BigInt64Array.of(BigInt(beam.tokens.at(-1)!)), [1, 1]));
          const useCache = own(new Tensor('bool', Uint8Array.of(step > 0 ? 1 : 0), [1]));
          const output = await this.decoder.run({
            input_ids: decoderInput, encoder_attention_mask: mask,
            encoder_hidden_states: hidden, use_cache_branch: useCache, ...beam.past,
          });
          for (const tensor of Object.values(output)) own(tensor);
          drop(decoderInput); drop(useCache);
          const scores = output.logits;
          if (!scores || scores.data.length !== 65001) throw new Error('The decoder output does not match the bundled model.');
          const logits = scores.data as Float32Array;
          const top: { id: number; value: number }[] = [];
          let max = -Infinity;
          for (let id = 0; id < 65000; id++) {
            const value = logits[id]!;
            if (value > max) max = value;
            if (top.length < width * 2 || value > top[top.length - 1]!.value) {
              top.push({ id, value });
              top.sort((a, b) => b.value - a.value);
              if (top.length > width * 2) top.pop();
            }
          }
          if (!Number.isFinite(max)) throw new Error('The local model returned invalid scores.');
          let sum = 0;
          for (let id = 0; id < 65000; id++) sum += Math.exp(logits[id]! - max);
          const logSum = max + Math.log(sum);
          drop(scores);
          const nextPast = { ...beam.past };
          for (const [name, tensor] of Object.entries(output)) {
            if (!name.startsWith('present.')) continue;
            if (step > 0 && name.includes('.encoder.')) { drop(tensor); continue; }
            nextPast[name.replace('present.', 'past_key_values.')] = tensor;
          }
          for (const { id, value } of top) {
            candidates.push({ tokens: [...beam.tokens, id], score: beam.score + value - logSum, past: nextPast });
          }
        }
        candidates.sort((a, b) => b.score - a.score);
        const active: Beam[] = [];
        for (const [rank, candidate] of candidates.entries()) {
          if (candidate.tokens.at(-1) === 0) {
            if (rank < width && candidate.tokens.length > 2) {
              finished.push({ tokens: candidate.tokens, score: candidate.score / (candidate.tokens.length - 1) });
            }
          } else active.push(candidate);
          if (active.length === width) break;
        }
        finished.sort((a, b) => b.score - a.score);
        if (finished.length > width) finished.length = width;
        beams = active;
        const keep = new Set([input, mask, hidden, ...beams.flatMap((beam) => Object.values(beam.past))]);
        for (const tensor of owned) if (!keep.has(tensor)) drop(tensor);
        if (finished.length === width || beams.length === 0) break;
      }
      checkCancelled(signal);
      if (!finished.length) throw new Error('Translation reached its limit. Split this sentence and try again.');
      const result = this.tokenizer.decode(finished[0]!.tokens, { skip_special_tokens: true }).trim();
      if (!result) throw new Error('No translation produced. Original text retained.');
      return result;
    } finally {
      for (const tensor of owned) tensor.dispose();
    }
  }

  async release(): Promise<void> {
    await this.encoder.release();
    await this.decoder.release();
  }
}

