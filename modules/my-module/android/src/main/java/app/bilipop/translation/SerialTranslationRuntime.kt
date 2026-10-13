package app.bilipop.translation

import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger

internal data class TokenUsage(val input: Int, val output: Int, val total: Int)
internal interface TranslationCallback {
  fun onText(text: String)
  fun onDone()
  fun onError(error: Throwable)
}
internal interface TranslationConversation : AutoCloseable {
  fun renderedInputBytes(prompt: String): Int
  fun start(prompt: String, callback: TranslationCallback)
  fun cancel()
  fun usage(): TokenUsage
}
internal interface TranslationEngine : AutoCloseable {
  fun conversation(): TranslationConversation
}

/** One native inference owner. Cancellation invalidates results immediately, but
 * ownership is held until the native terminal callback, then conversation close. */
internal class SerialTranslationRuntime(private val create: (File) -> TranslationEngine) {
  private val work = Any()
  private val state = Any()
  private val generation = AtomicInteger(0)
  private var engine: TranslationEngine? = null
  private var active: TranslationConversation? = null
  @Volatile private var destroyed = false

  fun epoch(): Int = generation.get()
  fun cancel() {
    generation.incrementAndGet()
    // A JNI cancel error must not release or close still-running native work.
    synchronized(state) { runCatching { active?.cancel() } }
  }
  fun load(file: File) = synchronized(work) {
    check(!destroyed) { "Translation runtime is closed." }
    if (engine == null) engine = create(file)
  }
  fun release() {
    cancel()
    synchronized(work) { engine?.close(); engine = null }
  }
  fun destroy() {
    destroyed = true
    release()
  }
  private fun checkEpoch(expected: Int) {
    check(!destroyed && generation.get() == expected) { "Translation cancelled. Your original is unchanged." }
  }
  fun translate(prompt: String, requestEpoch: Int): String = synchronized(work) {
    checkEpoch(requestEpoch)
    require(prompt.isNotBlank() && prompt.length <= 16000) { "Invalid or over-limit translation input." }
    val conversation = checkNotNull(engine) { "Download and prepare the translation model first." }.conversation()
    try {
      // 0.17.1 has no public pre-tokenization API. UTF-8 byte count of the complete
      // rendered prompt is a conservative byte-fallback-tokenizer upper bound.
      // This intentionally rejects some sentences that might fit; it never cuts input.
      require(conversation.renderedInputBytes(prompt) <= INPUT_BUDGET) {
        "This sentence or its context is too long for the local model. Split it into shorter sentences. Your original is retained."
      }
      val done = CountDownLatch(1)
      val output = StringBuilder()
      var failure: Throwable? = null
      val callback = object : TranslationCallback {
        override fun onText(text: String) { synchronized(output) { output.append(text) } }
        override fun onDone() { done.countDown() }
        override fun onError(error: Throwable) { failure = error; done.countDown() }
      }
      synchronized(state) {
        checkEpoch(requestEpoch)
        active = conversation
        conversation.start(prompt, callback)
      }
      // Do not abandon/close a live JNI handle on cancellation or a timer.
      // The terminal callback establishes that the native owner has finished.
      var interrupted = false
      while (true) {
        try { done.await(); break }
        catch (_: InterruptedException) { interrupted = true; cancel() }
      }
      if (interrupted) Thread.currentThread().interrupt()
      checkEpoch(requestEpoch)
      failure?.let { throw it }
      val usage = conversation.usage()
      check(usage.input in 1..INPUT_BUDGET && usage.output in 1 until OUTPUT_BUDGET && usage.total < CONTEXT_TOKENS) {
        "Translation reached its token limit. Split this sentence and try again. Your original is retained."
      }
      synchronized(output) { output.toString().trim() }.also {
        check(it.isNotEmpty()) { "No translation produced. Your original is retained." }
      }
    } finally {
      synchronized(state) { if (active === conversation) active = null; conversation.close() }
    }
  }

  companion object {
    const val CONTEXT_TOKENS = 1024
    const val OUTPUT_BUDGET = 256
    const val INPUT_BUDGET = CONTEXT_TOKENS - OUTPUT_BUDGET
  }
}
