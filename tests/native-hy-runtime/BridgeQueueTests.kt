package app.bilipop.translation

import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout

/** Source-wiring + scheduler regression, not Android/JSI execution. Dispatch
 * matches the actual cached Expo AsyncFunctionComponent CustomQueue/DEFAULT
 * branches. Actual Expo classes separately compile every registration. */
internal fun testBridgeQueues(source: File) = runBlocking {
  val bridge = source.readText()
  fun registration(name: String): String = Regex(
    "AsyncFunction\\(\"$name\"\\).*?(?=\\n    (?:AsyncFunction|OnDestroy))",
    RegexOption.DOT_MATCHES_ALL,
  ).find(bridge)?.value ?: error("Missing bridge registration: $name")
  val defaultDispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
  val expoDefault = CoroutineScope(SupervisorJob() + defaultDispatcher)
  try {
    for (name in listOf("downloadModel", "translate", "load")) {
      val queues = TranslationWorkQueues()
      val started = CountDownLatch(1)
      val terminal = CountDownLatch(1)
      val enteredState = if (name == "translate") "ready" else if (name == "load") "verifying" else "downloading"
      val scope = if (registration(name).contains(".runOnQueue(queues.workScope)")) queues.workScope else expoDefault
      val owner = scope.async {
        queues.work {
          queues.record(ModelStatus(enteredState, 3, 10))
          started.countDown()
          check(terminal.await(5, TimeUnit.SECONDS))
          queues.record(ModelStatus("ready", 10, 10))
        }
      }
      try {
        check(started.await(2, TimeUnit.SECONDS))
        // Clipboard and other unrelated modules retain their shared default queue.
        val clipboard = expoDefault.async { "copied existing text" }
        val statusScope = if (registration("getModelStatus").contains(".runOnQueue(queues.statusScope)")) queues.statusScope else expoDefault
        val status = statusScope.async { queues.status { error("Must not enter model/engine locks while work is held") } }
        check(withTimeout(500) { clipboard.await() } == "copied existing text") { "Clipboard blocked by $name" }
        check(withTimeout(500) { status.await() }.state == enteredState) { "Polling blocked by $name" }
        check(!owner.isCompleted) { "Responsiveness must be proven before native/download completion" }
        terminal.countDown()
        withTimeout(2000) { owner.await() }
        check(queues.status { ModelStatus("ready", 10, 10) }.state == "ready")
      } finally {
        terminal.countDown()
        queues.close({}, {}).join()
      }
    }
    println("PASS source-wired download/inference/init cannot stall shared Expo default work or status polling")
    for (name in listOf("downloadModel", "translate", "load", "release", "discardPartialModel")) {
      check(registration(name).contains(".runOnQueue(queues.workScope)")) { "$name must use the module-owned work scope" }
    }

    val queues = TranslationWorkQueues()
    val started = CountDownLatch(1)
    val terminal = CountDownLatch(1)
    val log = java.util.Collections.synchronizedList(mutableListOf<String>())
    val active = queues.workScope.async {
      queues.work {
        queues.record(ModelStatus("ready", 10, 10))
        started.countDown()
        check(terminal.await(5, TimeUnit.SECONDS))
        log.add("terminal")
      }
    }
    check(started.await(2, TimeUnit.SECONDS))
    val queued = queues.workScope.async {
      runCatching { queues.work { log.add("must-not-start") } }
    }
    val cleanup = queues.close({ log.add("cancel") }, { log.add("cleanup") })
    check(queues.close({ error("double cancel") }, { error("double cleanup") }) === cleanup)
    check(log == listOf("cancel") && !cleanup.isCompleted && !active.isCompleted)
    check(runCatching { queues.status { error("must not refresh after destroy") } }.isFailure)
    terminal.countDown()
    withTimeout(2000) { active.await(); cleanup.join() }
    check(withTimeout(2000) { queued.await() }.isFailure) { "Queued wrapper must drain with a closed error, not an unsettled promise" }
    check(log == listOf("cancel", "terminal", "cleanup"))
    check(!queues.workScope.coroutineContext[kotlinx.coroutines.Job]!!.isActive)
    check(!queues.statusScope.coroutineContext[kotlinx.coroutines.Job]!!.isActive)
    println("PASS destroy invalidates queued work, drains error settlement, retains terminal owner and closes scopes")

    val heldStatusDispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    val statusBlocker = CoroutineScope(SupervisorJob() + heldStatusDispatcher)
    val statusExecutorHeld = CountDownLatch(1)
    val statusExecutorFree = CountDownLatch(1)
    val blockedStatus = TranslationWorkQueues(heldStatusDispatcher)
    val blocker = statusBlocker.async { statusExecutorHeld.countDown(); check(statusExecutorFree.await(5, TimeUnit.SECONDS)) }
    try {
      check(statusExecutorHeld.await(2, TimeUnit.SECONDS))
      val pendingStatus = blockedStatus.statusScope.async {
        runCatching { blockedStatus.status { error("Destroyed status must never refresh") } }
      }
      val statusCleanup = blockedStatus.close({}, {})
      // Force cleanup to get as far as it can while the earlier status wrapper
      // is genuinely queued, not already running on a fast IO thread.
      Thread.sleep(30)
      check(!statusCleanup.isCompleted) { "Destroy must drain queued status wrappers before cancelling their scope" }
      statusExecutorFree.countDown()
      withTimeout(2000) { blocker.await(); statusCleanup.join() }
      check(withTimeout(2000) { pendingStatus.await() }.isFailure) { "Pending status must settle through the closed guard" }
    } finally {
      statusExecutorFree.countDown()
      blockedStatus.close({}, {}).join()
      statusBlocker.cancel(); heldStatusDispatcher.close()
    }
    println("PASS already-enqueued status wrappers drain to closed errors before scope disposal")

    val released = TranslationWorkQueues()
    val releaseStarted = CountDownLatch(1)
    val releaseDone = CountDownLatch(1)
    val releasing = released.workScope.async {
      released.work {
        released.record(ModelStatus("ready", 10, 10))
        released.unprepared()
        releaseStarted.countDown(); check(releaseDone.await(5, TimeUnit.SECONDS))
      }
    }
    check(releaseStarted.await(2, TimeUnit.SECONDS))
    check(released.status { error("Cannot initialize during release") }.state == "verifying")
    releaseDone.countDown(); releasing.await()
    val errorStatus = ModelStatus("error", 10, 10, "initialization failed")
    check(released.status { errorStatus }.state == "error")
    released.close({}, {}).join()
    val recreated = TranslationWorkQueues()
    check(recreated.status { ModelStatus("missing", 0, 10) }.state == "missing")
    recreated.close({}, {}).join()
    println("PASS release invalidates readiness; failed initialization/recreation cannot reuse ready snapshot")
  } finally { expoDefault.cancel(); defaultDispatcher.close() }
}
