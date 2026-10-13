import app.bilipop.translation.BiliPopTranslationModule
import ai.onnxruntime.*
import java.lang.reflect.InvocationTargetException
import java.util.concurrent.atomic.AtomicInteger

fun main() {
  var failures = 0
  fun case(name: String, allocation: Int = 0, run: String = "", bad: String = "", cancel: Boolean = false, success: Boolean = false, allocationError: Boolean = false) {
    Faults.reset()
    val module = BiliPopTranslationModule()
    for (kind in listOf("encoder", "decoder")) {
      module.javaClass.getDeclaredField(kind).apply { isAccessible = true }.set(module, OrtSession(kind))
    }
    Faults.allocationError = allocationError; Faults.failAllocation = allocation; Faults.failRun = run; Faults.badOutput = bad
    if (cancel) Faults.onDecoderRun = {
      (module.javaClass.getDeclaredField("epoch").apply { isAccessible = true }.get(module) as AtomicInteger).incrementAndGet()
    }
    var result: Any? = null
    var thrown: Throwable? = null
    try {
      result = module.javaClass.getDeclaredMethod("decode", List::class.java, Int::class.javaPrimitiveType).apply { isAccessible = true }.invoke(module, listOf(5, 10, 0), 0)
    } catch (error: InvocationTargetException) { thrown = error.cause }
    try {
      if (success) check(result == listOf(65000, 1, 1, 0) && thrown == null) { "unexpected successful tokens: $result; $thrown" }
      else check(thrown != null) { "fault did not execute" }
      if (allocation != 0) check(thrown?.message == "injected allocation $allocation") { "wrong failure: $thrown" }
      if (cancel) check(thrown?.message?.startsWith("Translation cancelled") == true)
      Faults.assertClosed()
      println("PASS $name (${Faults.tensors.size} tensors, ${Faults.results.size} results)")
    } catch (error: Throwable) { failures++; println("FAIL $name: ${error.message}") }
  }
  for (allocation in listOf(1, 2, 3, 4, 5, 6, 7)) case("allocation $allocation", allocation = allocation)
  for (allocation in listOf(2, 3, 5)) case("allocation Error $allocation", allocation = allocation, allocationError = true)
  case("encoder failure", run = "encoder")
  case("decoder failure", run = "decoder")
  for (bad in listOf("hidden", "logits", "vocabulary", "nonfinite")) case("invalid $bad", bad = bad)
  case("cancel after decoder result", cancel = true)
  case("success and first-result KV retention", success = true)
  check(failures == 0) { "$failures cases failed" }
}
