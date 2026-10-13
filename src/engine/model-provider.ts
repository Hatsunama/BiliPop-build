import { MODEL_BYTES, type ModelStatus } from './model-contract';
import type { TextTranslator } from './translate-post';
export { MODEL_BYTES, type ModelStatus } from './model-contract';
const unsupported = (): ModelStatus => ({ state: 'unsupported', downloadedBytes: 0, totalBytes: MODEL_BYTES,
  error: 'On-device translation requires the Android app. This browser is a UI preview.' });
export async function getModelStatus(): Promise<ModelStatus> { return unsupported(); }
export async function downloadModel(_onProgress?: (status: ModelStatus) => void): Promise<ModelStatus> { return unsupported(); }
export function cancelModelDownload(): void {}
export async function discardPartialModel(): Promise<ModelStatus> { return unsupported(); }
export async function releaseTranslator(): Promise<void> {}
export async function getTranslator(): Promise<TextTranslator> {
  throw new Error('On-device translation requires the Android app. This browser is a UI preview only.');
}
export async function getModelNotices(): Promise<string> {
  return 'Hatsunama/caption-studio-hy-mt2-1.8b-q8, based on Tencent Hy-MT2-1.8B. Apache-2.0. ' +
    'See THIRD_PARTY_NOTICES.md and the bundled translation notices. One-time model download requires internet; inference stays on-device.';
}
