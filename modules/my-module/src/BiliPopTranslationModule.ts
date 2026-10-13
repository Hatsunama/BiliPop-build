import { NativeModule, requireNativeModule } from 'expo';
import type { ModelStatus } from '../../../src/engine/model-contract';

type ModelEvents = { onModelStatus: (status: ModelStatus) => void };
declare class BiliPopTranslationModule extends NativeModule<ModelEvents> {
  load(): Promise<void>;
  translate(prompt: string, epoch: number): Promise<string>;
  epoch(): number;
  cancel(): void;
  release(): Promise<void>;
  getModelStatus(): Promise<ModelStatus>;
  downloadEpoch(): number;
  downloadModel(epoch: number): Promise<ModelStatus>;
  cancelModelDownload(): void;
  discardPartialModel(): Promise<ModelStatus>;
}
export default requireNativeModule<BiliPopTranslationModule>('BiliPopTranslation');
