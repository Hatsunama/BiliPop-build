# Historical OPUS evaluator fixture

The current app uses Hy-MT2/LiteRT-LM. This isolated legacy source fixture is not imported by the app and includes no model weights or prior QA results.

Run evaluator control-flow tests without model inference:

    node --import tsx --test tests/model-quality/evaluator.test.mjs

The tests replace file/session/inference boundaries and cover integrity checks, semantic pass/fail reporting and session cleanup. Passing these tests does not establish current model translation quality, Android correctness or release readiness.

The optional evaluate.mjs requires the exact historical local assets and does not download them. It is not run by the public APK workflow.
