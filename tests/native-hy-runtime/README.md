# Hy-MT2 native lifecycle/download tests

The harness compiles and executes the production serial controller, pinned model store and preparation gate on the JVM with explicit inference/HTTP doubles. It downloads no model, contacts no URL, uses no emulator or phone, and writes temporary build/test files only. Real JNI/model execution and packaging are separate gates.

Core tests with an existing Kotlin 2.1.20 Gradle artifact cache:

```sh
python tests/native-hy-runtime/run.py --cache /path/to/gradle-home/caches/modules-2/files-2.1
```

Full compile-level API verification needs compatible official Kotlin compiler artifacts (2.3.20 is the selected Gradle/Pika candidate), the actual LiteRT-LM 0.17.1 classes.jar extracted from its AAR, actual Expo/ReactAndroid classes and an Android SDK android.jar. Extra dependency directories use the same group/artifact/version/hash/file.jar hierarchy as the Gradle cache:

```sh
python tests/native-hy-runtime/run.py --cache /path/to/existing/cache \
  --compiler-cache /path/to/verified/kotlin23/dependencies --compiler-version 2.3.20 \
  --litert-classes /path/to/litertlm-classes.jar \
  --bridge-classpath /path/to/android.jar:/path/to/react-classes.jar:/path/to/expo-classes.jar
```

The runner never suppresses Kotlin metadata checks. 2.1.20 cannot read the actual AAR's 2.4 metadata. Actual Kotlin 2.3.20 probes compiled the full unchanged bridge against its non-strict metadata and passed the JVM suite with both stdlib 2.3.20 and 2.4.0. This does not verify Pika execution or an Android build. Adding --bridge-classpath compiles the real Expo registration too; merely compiling the controller with fake inference is not native-binding verification. The final printed result explicitly says JNI inference was not run.

Tests cover cancellation before/while native work, no early close, release ordering, stale epochs, recovery, input/output limits, duplicate initialization, immutable file pins, integrity/atomic activation, exact and ignored Range behavior, corrupt hash/range, low storage, redirect restrictions, cancellation/partial discard, interrupted transfer, Android version/ABI gating before side effects and readiness only after successful initialization.

`BridgeQueueTests.kt` additionally checks the real bridge's queue-registration source against a scheduler model of Expo's actual `DEFAULT`/`CustomQueue` dispatch. Held fake download, initialization and inference work must leave both an unrelated default-queue operation (such as Clipboard) and status reads responsive before completion. This reproduced a timeout against the original default-queue bridge. It also executes the production queue owner to verify readiness invalidation on release, error/recreation states, pending-work rejection on destroy, terminal cleanup order and closed scopes. It is explicitly a source-wiring/scheduler regression, not Android HandlerThread, JSI or actual Clipboard execution. Full compile-level verification uses the real Expo `runOnQueue(CoroutineScope)` API.
