# Translation model and runtime notices

The current BiliPop candidate uses **Hatsunama/caption-studio-hy-mt2-1.8b-q8**, derived from **Tencent Hy-MT2-1.8B**. Copyright (C) 2026 Tencent. All rights reserved. Hatsunama modified the upstream model through targeted preference adaptation (step 64), adapter merge and Q8 LiteRT conversion. Apache License 2.0 applies.

- Pinned candidate card: https://huggingface.co/Hatsunama/caption-studio-hy-mt2-1.8b-q8/blob/4d8552d273b5b4e064358e1a6ff37b396d0726e5/README.md
- Candidate notice: https://huggingface.co/Hatsunama/caption-studio-hy-mt2-1.8b-q8/blob/4d8552d273b5b4e064358e1a6ff37b396d0726e5/NOTICE.txt
- Candidate license: https://huggingface.co/Hatsunama/caption-studio-hy-mt2-1.8b-q8/blob/4d8552d273b5b4e064358e1a6ff37b396d0726e5/LICENSE.txt
- Upstream attribution: https://huggingface.co/tencent/Hy-MT2-1.8B
- Runtime: Google LiteRT-LM 0.17.1, Apache-2.0: https://github.com/google-ai-edge/LiteRT-LM/tree/v0.17.1

The app fetches only the pinned, unchanged Hatsunama file after explicit setup. BiliPop does not alter or publish the hosted weights. The application adds local lifecycle, integrity, prompt serialization and hashtag formatting. The complete model notice, Apache license, and the distributed LiteRT-LM third-party notices are embedded in assets/licenses/translation-notices.modeldata. Model and dependency licensing is distinct from BiliPop's MIT application license. Expo, React Native, Kotlin, Gson and their dependencies retain their own licenses. No model author endorses BiliPop, and translations have no guarantee of accuracy or fitness for a particular purpose.

## Historical OPUS baseline, not the current app runtime

The retained tests/model-quality/legacy-opus files reproduce earlier evaluation tooling. They are not imported by the app or bundled as model weights. Earlier releases used Helsinki-NLP OPUS-MT, Xenova conversion revision 046f55aec303cdee3e0318604406d4df20f1e8ea, ONNX Runtime (Microsoft, MIT) and Tokenizers.js (Hugging Face, Apache-2.0). No historical download link or upstream repository has been modified.

- Original model: https://huggingface.co/Helsinki-NLP/opus-mt-en-zh
- Original training project: https://github.com/Helsinki-NLP/Tatoeba-Challenge/tree/master/models/eng-zho
- Converted model: https://huggingface.co/Xenova/opus-mt-en-zh
- Apache-2.0: https://www.apache.org/licenses/LICENSE-2.0
- Broader OPUS-MT project attribution: https://creativecommons.org/licenses/by/4.0/
- ONNX Runtime: https://github.com/microsoft/onnxruntime/blob/main/LICENSE
- Tokenizers.js: https://github.com/huggingface/tokenizers.js/blob/main/LICENSE
