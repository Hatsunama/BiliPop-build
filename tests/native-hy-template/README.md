# Empty-preface regression

The actual BiliPop Kotlin adapter is compiled with explicit SDK doubles and the production serial controller. It fails on the original `renderPrefaceIntoString` call, then passes with first-message-only accounting. It verifies UTF-8/full-wrapper accounting, successful dispatch, the exact 768-byte boundary, pre-dispatch rejection above the boundary, and conversation cleanup after rejection. Existing native-hy-runtime tests cover cancellation, failures, retries and terminal ownership.

```
python tests/native-hy-template/run.py --cache /path/to/kotlin-2.1.20-jars
python tests/native-hy-runtime/run.py --cache /path/to/gradle-shaped-cache
```

The separate Python test runs the actual extracted template with MiniJinja 2.12.0 (PyPI), reproduces the original empty-message error, and checks exact first-turn text for English, CJK/emoji, accents and delimiter-like literal input:

```
python tests/native-hy-template/template_test.py
```

Fixture provenance: bytes 16439..17092 (654 UTF-8 bytes) within the first 1 MiB of `Hatsunama/caption-studio-hy-mt2-1.8b-q8`, revision `4d8552d273b5b4e064358e1a6ff37b396d0726e5`, `model.litertlm`. Expected artifact SHA-256 `ed7747292c58435ab6e4b58bd7837c566737aae3eec5da6e3c328998529dcf97`; template SHA-256 `b7491ec0e9c869dfce20f2176758099bf248d979dd05530ede99deb21698acee`. Only a bounded 1 MiB HTTP range was retrieved, so this step does not independently verify the entire model hash.

Upstream semantics: `google-ai-edge/LiteRT-LM` tag `v0.17.1`, `runtime/conversation/conversation.cc`, `GetSingleTurnTextFromFullHistory` lines 257–323 and `RenderPrefaceIntoString` lines 915–940. The fresh empty-preface first-message path renders the complete new prompt, while the separate preface path always evaluates the empty message array. Kotlin `Conversation.kt` lines 704–735 expose these methods for testing/logging.

These tests do not prove Android JNI execution or translation quality. Keep the exact pinned model and SDK, then verify the final APK with the first `Hello.` English-to-Chinese request, repeated requests, cancellation and recovery on actual supported hardware before claiming the release works.
