package app.bilipop.translation

import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch

/** Expo's DEFAULT queue is shared by all modules, including Clipboard. Never
 * occupy it with model IO or a native terminal wait. Only this owner serializes
 * blocking mutations; read-only polling returns a snapshot while work is held. */
internal class TranslationWorkQueues(statusDispatcher: CoroutineDispatcher = Dispatchers.IO) {
  private val gate = ReentrantLock()
  private val closed = AtomicBoolean(false)
  private val closeLock = Any()
  private val dispatcher = Executors.newSingleThreadExecutor { task ->
    Thread(task, "BiliPop-model-work").apply { isDaemon = true }
  }.asCoroutineDispatcher()
  val workScope = CoroutineScope(SupervisorJob() + dispatcher)
  val statusScope = CoroutineScope(SupervisorJob() + statusDispatcher)
  private var cleanupJob: Job? = null
  @Volatile private var current = ModelStatus("verifying", 0, PinnedHyModel.spec.bytes)

  fun record(value: ModelStatus): ModelStatus = value.also { current = it }
  fun unprepared() { if (current.state == "ready") current = current.copy(state = "verifying") }

  fun <T> work(block: () -> T): T = gate.withLock {
    check(!closed.get()) { "Translation module is closed." }
    block()
  }

  fun status(refresh: () -> ModelStatus): ModelStatus {
    check(!closed.get()) { "Translation module is closed." }
    if (!gate.tryLock()) return current
    return try {
      check(!closed.get()) { "Translation module is closed." }
      record(refresh())
    } finally { gate.unlock() }
  }

  /** Invalidate queued callbacks, but do not interrupt/abandon running native work.
   * Cleanup acquires the same gate after its terminal callback and closes the
   * module-owned executor only after all active storage/engine owners exit. */
  fun close(cancelActive: () -> Unit, cleanup: () -> Unit): Job = synchronized(closeLock) {
    cleanupJob?.let { return@synchronized it }
    closed.set(true)
    unprepared()
    runCatching(cancelActive)
    // Keep queued Expo wrappers alive long enough to reject their promises at
    // the closed guard. Cancelling their launch first would skip functionBody
    // entirely, leaving already-created bridge promises unsettled.
    val pendingStatus = requireNotNull(statusScope.coroutineContext[Job]).children.toList()
    val finishing = CoroutineScope(SupervisorJob() + dispatcher)
    finishing.launch {
      // Unlike the serial worker, IO-dispatched observers may not have started
      // when this cleanup task runs. Drain those already-enqueued wrappers too.
      pendingStatus.joinAll()
      gate.withLock { cleanup() }
    }.also { job ->
      cleanupJob = job
      job.invokeOnCompletion {
        workScope.cancel(); statusScope.cancel(); dispatcher.close(); finishing.cancel()
      }
    }
  }
}
