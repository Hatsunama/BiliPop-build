/* eslint-disable @typescript-eslint/no-require-imports -- Metro needs static require calls for embedded notices. */
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import NativeTranslation from '../../modules/my-module/src/BiliPopTranslationModule';
import { ModelManager } from './model-manager';
import type { ModelStatus } from './model-contract';
export { MODEL_BYTES, type ModelStatus } from './model-contract';

const manager = new ModelManager(NativeTranslation);
export const getTranslator = () => manager.get();
export const releaseTranslator = () => manager.release();
export const getModelStatus = () => NativeTranslation.getModelStatus();
export const cancelModelDownload = () => NativeTranslation.cancelModelDownload();
export const discardPartialModel = () => NativeTranslation.discardPartialModel();
let download: Promise<ModelStatus> | undefined;

export function downloadModel(onProgress?: (status: ModelStatus) => void): Promise<ModelStatus> {
  const subscription = onProgress ? NativeTranslation.addListener('onModelStatus', onProgress) : undefined;
  if (!download) {
    const running = NativeTranslation.downloadModel(NativeTranslation.downloadEpoch()).finally(() => {
      if (download === running) download = undefined;
    });
    download = running;
  }
  return download.finally(() => subscription?.remove());
}
export async function getModelNotices(): Promise<string> {
  const asset = Asset.fromModule(require('../../assets/licenses/translation-notices.modeldata'));
  await asset.downloadAsync(); // This is an embedded notice asset, never model weights.
  if (!asset.localUri) throw new Error('Model notices are unavailable. See THIRD_PARTY_NOTICES.md.');
  return new File(asset.localUri).text();
}
