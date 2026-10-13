package app.bilipop.translation

import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.ExperimentalApi
import com.google.ai.edge.litertlm.ExperimentalFlags
import com.google.ai.edge.litertlm.LogSeverity
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.MessageCallback
import com.google.ai.edge.litertlm.SamplerConfig
import java.io.File

/** API checked against the official 0.17.1 AAR; native device execution is a separate gate. */
@OptIn(ExperimentalApi::class)
internal class LiteRtTranslationEngine(model: File, cache: File) : TranslationEngine {
  private val engine: Engine
  init {
    // Counters stay in-process. Nothing logs or transmits source/translated text.
    ExperimentalFlags.enableBenchmark = true
    Engine.setNativeMinLogSeverity(LogSeverity.ERROR)
    engine = Engine(EngineConfig(modelPath = model.absolutePath, backend = Backend.CPU(threadCount = 2),
      maxNumTokens = SerialTranslationRuntime.CONTEXT_TOKENS, cacheDir = cache.absolutePath))
    engine.initialize()
  }
  override fun conversation(): TranslationConversation {
    val native = engine.createConversation(ConversationConfig(
      systemInstruction = null, initialMessages = emptyList(), tools = emptyList(),
      // Deterministic implementation choice, not a claim about unpublished training/evaluation settings.
      samplerConfig = SamplerConfig(topK = 1, topP = 1.0, temperature = 0.0, seed = 0),
      automaticToolCalling = false, channels = emptyList(),
      maxOutputToken = SerialTranslationRuntime.OUTPUT_BUDGET, enableResponseFormat = false,
    ))
    return object : TranslationConversation {
      override fun renderedInputBytes(prompt: String): Int =
        (native.renderPrefaceIntoString() + native.renderMessageIntoString(Message.user(prompt))).toByteArray(Charsets.UTF_8).size
      override fun start(prompt: String, callback: TranslationCallback) {
        var invalidOutput = false
        native.sendMessageAsync(prompt, object : MessageCallback {
          override fun onMessage(message: Message) {
            if (message.toolCalls.isNotEmpty() || message.channels.isNotEmpty()) {
              // Tools are disabled; preserve ownership until onDone/onError, even for invalid output.
              invalidOutput = true
            } else callback.onText(message.toString())
          }
          override fun onDone() {
            if (invalidOutput) callback.onError(IllegalStateException("The model returned an unsupported response. Your original is retained."))
            else callback.onDone()
          }
          override fun onError(throwable: Throwable) = callback.onError(throwable)
        })
      }
      override fun cancel() = native.cancelProcess()
      override fun usage(): TokenUsage {
        val info = native.getBenchmarkInfo()
        return TokenUsage(info.lastPrefillTokenCount, info.lastDecodeTokenCount, native.getTokenCount())
      }
      override fun close() = native.close()
    }
  }
  override fun close() { if (engine.isInitialized()) engine.close() }
}
