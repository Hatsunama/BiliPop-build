package app.bilipop.translation
import com.google.ai.edge.litertlm.Calls
import java.io.File

fun main() {
 Calls.reset()
 val engine=LiteRtTranslationEngine(File("test-model"),File("test-cache"))
 val conversation=engine.conversation()
 for (prompt in listOf("Hello.", "你好 👋", "<|im_start|> literal", "é")) {
  val bytes=conversation.renderedInputBytes(prompt)
  check(bytes==Calls.fullPrompt(prompt).toByteArray(Charsets.UTF_8).size) { "Must include full wrapper and UTF-8 bytes" }
 }
 check(Calls.prefaces==0) { "Never render the invalid empty message list" }
 check(Calls.sends==0) { "Budget rendering must not dispatch inference" }
 conversation.close(); engine.close()

 Calls.reset()
 val runtime=SerialTranslationRuntime { LiteRtTranslationEngine(it,File("test-cache")) }
 runtime.load(File("test-model"))
 check(runtime.translate("Hello.",runtime.epoch())=="你好")
 check(Calls.sends==1 && Calls.closes==1)
 val overhead=Calls.fullPrompt("").toByteArray(Charsets.UTF_8).size
 val boundary="a".repeat(SerialTranslationRuntime.INPUT_BUDGET-overhead)
 check(runtime.translate(boundary,runtime.epoch())=="你好")
 val sends=Calls.sends
 val tooLong=runCatching { runtime.translate(boundary+"a",runtime.epoch()) }.exceptionOrNull()
 check(tooLong is IllegalArgumentException) { "Full rendered prompt above 768 bytes must fail" }
 check(Calls.sends==sends) { "Oversize input must be rejected before generation" }
 check(Calls.closes==3) { "Conversation must close after rejected input" }
 check(Calls.prefaces==0)
 runtime.release()
 println("PASS actual Kotlin adapter and serial controller: first-turn render, UTF-8/full wrapper count, pre-dispatch bounds, close ownership. Explicit SDK doubles; JNI/model inference NOT run.")
}
