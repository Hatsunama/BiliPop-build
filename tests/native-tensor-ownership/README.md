# Historical OPUS decoder ownership regression

The production app now uses Hy-MT2/LiteRT-LM. This retained harness defaults to
its frozen legacy decoder copy, not the new production module. Use
tests/native-hy-runtime for current lifecycle/download verification.

This offline JVM harness compiles the saved historical Kotlin decoder and its
helper types without Expo registration. ONNX tensors, sessions and results are
explicit doubles. It validates control flow and exactly-once cleanup, not JNI,
model quality, Android memory pressure, module registration or an APK build.
The decoder itself is extracted verbatim; no hand-translated implementation is
used. Compilation happens in a temporary directory removed at exit.

Run with an existing read-only Gradle artifact cache (no Gradle, SDK or download):

```sh
python tests/native-tensor-ownership/run.py --cache /path/to/gradle-home/caches/modules-2/files-2.1
```

The cache must contain Kotlin compiler/stdlib/script-runtime/daemon 1.9.24,
JetBrains annotations 13.0 and trove4j 1.0.20200330. `--java` selects the JVM.
`--source` can select a saved pre-repair Kotlin file for red verification.
This separate check is not automatically included in `npm test`.

## Coverage

18 cases cover construction failures at allocations 1–7 (input, mask, empty,
first decoder input/cache and later decoder input/cache), allocation `Error`
failures at 2/3/5, encoder and decoder run errors, missing hidden state/logits,
wrong vocabulary, nonfinite scores, cancellation after a decoder result, and a
three-step successful beam traversal. Every created tensor and result must be
closed exactly once. Every session invocation rejects already-closed input
resources, exercising retention of first-result encoder KV tensors while stale
results are released. The deterministic successful token sequence is asserted.

The original production decoder fails allocation cases 2/3/5/7 and allocation
Error cases 2/3/5. Nested `use` scopes repair these without changing beam scoring,
selection, model tensors, cancellation checks or result-retention policy.

A double cannot establish that native close never throws. Cleanup failures,
real allocator failure recovery, real cancellation latency and actual ONNX model
output remain separate verification work.
