package com.google.ai.edge.litertlm

// Explicit test double, not JNI. Mirrors the upstream first-turn rendering contract:
// an empty preface is invalid for a template that reads messages[0].role; rendering
// the first user message renders the complete first turn, including its wrapper.
@RequiresOptIn annotation class ExperimentalApi
object ExperimentalFlags { var enableBenchmark = false }
enum class LogSeverity { ERROR }
sealed class Backend { data class CPU(val threadCount: Int) : Backend() }
data class EngineConfig(val modelPath: String, val backend: Backend, val maxNumTokens: Int, val cacheDir: String)
data class SamplerConfig(val topK: Int, val topP: Double, val temperature: Double, val seed: Int)
data class ConversationConfig(
 val systemInstruction: Any? = null, val initialMessages: List<Message> = emptyList(),
 val tools: List<Any> = emptyList(), val samplerConfig: SamplerConfig,
 val automaticToolCalling: Boolean = false, val channels: List<Any> = emptyList(),
 val maxOutputToken: Int, val enableResponseFormat: Boolean = false,
)
class Message(private val text: String) {
 val toolCalls = emptyList<Any>(); val channels = emptyList<Any>()
 override fun toString() = text
 companion object { fun user(text: String) = Message(text) }
}
interface MessageCallback { fun onMessage(message: Message); fun onDone(); fun onError(throwable: Throwable) }
data class BenchmarkInfo(val lastPrefillTokenCount: Int = 10, val lastDecodeTokenCount: Int = 2)
object Calls {
 var prefaces=0; var renders=0; var sends=0; var closes=0
 var config: ConversationConfig? = null
 fun reset() { prefaces=0; renders=0; sends=0; closes=0; config=null }
 fun fullPrompt(text: String) = "<｜hy_begin▁of▁sentence｜><｜hy_User｜>" + text + "<｜hy_Assistant｜>"
}
class Engine(val config: EngineConfig) {
 private var initialized=false
 fun initialize() { initialized=true }
 fun isInitialized() = initialized
 fun close() { initialized=false }
 fun createConversation(config: ConversationConfig): Conversation {
  Calls.config=config
  check(config.systemInstruction == null && config.initialMessages.isEmpty() && config.tools.isEmpty()) {
   "Regression invariant: BiliPop uses a fresh, empty preface for each translation"
  }
  return Conversation()
 }
 companion object { fun setNativeMinLogSeverity(severity: LogSeverity) {} }
}
class Conversation {
 fun renderPrefaceIntoString(): String { Calls.prefaces++; error("Failed to apply template: undefined value (messages[0].role)") }
 fun renderMessageIntoString(message: Message): String { Calls.renders++; return Calls.fullPrompt(message.toString()) }
 fun sendMessageAsync(prompt: String, callback: MessageCallback) {
  Calls.sends++; callback.onMessage(Message.user("你好")); callback.onDone()
 }
 fun cancelProcess() {}
 fun getBenchmarkInfo() = BenchmarkInfo()
 fun getTokenCount() = 12
 fun close() { Calls.closes++ }
}
