# BiliPop

On-device text translation with source and target language selection. Captions and hashtags are optional.

This repository contains the current BiliPop source candidate and required notices, with a fresh source history. An unsigned APK build is only a compilation and packaging check; real model inference, phone acceptance, signing and release remain separate gates. No model weights or signing keys are included.

## How it works

1. Choose source and target languages, then enter text, hashtags, or both.
2. On Android, explicitly download the pinned Hatsunama translation model once. The app shows progress, Cancel, Resume and Retry. The model is 1,815,668,080 bytes, approximately 1.69 GiB; keep an additional 256 MiB free for setup.
3. The downloaded file must pass its exact size and SHA-256 checks, then the local runtime must initialize successfully before translation is enabled.
4. Tap **POP IT!**. Text inference runs only on the device. Review and edit the result, then copy it. Hashtags use one opening # each, separated by spaces, such as `#travel #coffee`.

The model is **Hatsunama/caption-studio-hy-mt2-1.8b-q8**, the targeted-preference-adapted, merged Q8 version of Tencent Hy-MT2-1.8B. It is not the old generic OPUS model. The app downloads only the exact revision and file recorded in [the model contract](assets/translation/model-contract.json). Hosted models and existing Hugging Face links are not changed.

The selector exposes 38 entries from the explicit upstream support table, including Simplified Chinese, Traditional Chinese and Cantonese. These are supported-language claims, not proof that the adapted Q8 model has been quality-graded for every direction. Review important translations. Model-only checks reported on the candidate card do not establish BiliPop app acceptance.

## Network, storage and limits

- Internet is needed for explicit model setup/resume. After successful setup, translation is local and can work offline. There is no cloud translation, account, analytics or developer backend. The only model request starts at the pinned public Hatsunama Hugging Face URL and follows approved HTTPS Hugging Face download redirects. Source and translated text are never network inputs.
- Interrupted downloads remain resumable in private app storage. Only a full verified file is atomically activated. Invalid size/hash data is rejected. The app does not download model weights during a build or bundle 1.69 GiB in its APK.
- The original draft and editable output are saved separately on the device. Language selection and completed-output language provenance are saved locally. Translation failure/cancellation does not replace the original or publish a partial result. App backup and remote updates remain disabled.
- Up to 4,000 input characters and 30 distinct hashtags per request. Sentences are translated serially. URLs, emoji and whitespace around translated segments stay intact; Chinese and other source scripts are translated according to the selected pair.
- The artifact has a 1,024-token total context with 256 output tokens reserved. LiteRT-LM 0.17.1 has no exposed pre-generation token-count API, so the app uses a conservative full-rendered UTF-8 byte bound and rejects over-limit sentences/context instead of cutting them. It also rejects output/context token-limit exhaustion. Long sentences may need splitting even when the overall request is below 4,000 characters.
- The app's minimum SDK remains 24. This model runtime requires Android 8.0/API26 or newer and a supported 64-bit process (arm64-v8a or x86_64). Unsupported devices retain access to saved text and are blocked from downloading or starting the model. Actual memory capacity and latency still need device measurement; no universal RAM minimum is asserted.

Your keyboard, clipboard, browser and apps receiving pasted text have their own privacy behavior. There is no automatic posting or claims about hashtag popularity.

## Source checks

```sh
npm ci
EXPO_NO_TELEMETRY=1 npm run check
node scripts/verify-model-contract.mjs
node --import tsx --test tests/model-quality/evaluator.test.mjs
```

The last command tests the retained **historical OPUS evaluator's control flow**, not Hy-MT2 quality. Its saved baseline implementation is isolated under tests/model-quality/legacy-opus and is not imported by the app. scripts/fetch-model.mjs is now a no-network compatibility alias for contract verification.

The cloud-tested JVM lifecycle/download harness is documented in [tests/native-hy-runtime/README.md](tests/native-hy-runtime/README.md). The unchanged native bridge compiles against actual LiteRT-LM, Expo, ReactAndroid and Android API classes with Kotlin 2.3.20 and metadata checks enabled, including with the LiteRT-requested Kotlin 2.4.0 standard library. This is compile-level evidence, not JNI execution or an APK build. Expo's supported Gradle mods align android.kotlinVersion and the root Kotlin Gradle plugin classpath at 2.3.20: Pika 0.3.2 publishes a matching compiler artifact for 2.3.20 but none for 2.4.0. The property alone does not override React Native's older buildscript plugin dependency. Full Gradle/Pika compilation, packaging and device validation remain pending.

`npm run web` is a UI preview. It cannot download or run this Android translation runtime. Expo Go is not a substitute for the native module.

## Build and release gates

Build orchestration remains `npm run build:qa` for an isolated app.bilipop.qa candidate and `npm run build:unsigned` for unsigned production-identity artifacts. It verifies only model metadata before native build; weights are not fetched. Package identity, version, draft data and existing signing material are not changed by this source migration.

Full Gradle/React Native integration, packaging, model download/recovery on real Android storage, JNI inference, memory/latency and multilingual meaning-quality review remain required. Do not label the source candidate ready for distribution based on passing JS or JVM-double tests. Retain the current signing identity for compatible updates; never uninstall or clear app data to resolve a signing problem.

The canonical [Hatsu background](docs/BACKGROUND_PROVENANCE.md) and source regression tests are included. The native-emulator workflow is retained for source regression coverage with its only job explicitly disabled. It cannot allocate an emulator runner in this repository. No historical release installer is included.

[Model and runtime attribution](THIRD_PARTY_NOTICES.md) and full offline notices are included. The dedicated build workflow uses a pinned source commit and a standard public Ubuntu runner to produce only an unsigned ARM64 APK, its checksum and minimal provenance. It does not sign, publish releases, fetch model weights, run an emulator or perform device installation.
