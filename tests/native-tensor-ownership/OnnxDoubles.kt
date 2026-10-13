package ai.onnxruntime

import java.nio.FloatBuffer
import java.nio.LongBuffer
import java.util.Optional

object Faults {
  var allocation = 0
  var failAllocation = 0
  var allocationError = false
  var failRun = ""
  var badOutput = ""
  var onDecoderRun: (() -> Unit)? = null
  val tensors = mutableListOf<OnnxTensor>()
  val results = mutableListOf<OrtSession.Result>()
  fun reset() {
    allocation = 0; failAllocation = 0; allocationError = false; failRun = ""; badOutput = ""; onDecoderRun = null
    tensors.clear(); results.clear()
  }
  fun allocate(): OnnxTensor {
    allocation++
    if (allocation == failAllocation) {
      if (allocationError) throw OutOfMemoryError("injected allocation $allocation")
      error("injected allocation $allocation")
    }
    return OnnxTensor("allocation $allocation")
  }
  fun assertClosed() {
    val leaks = tensors.filter { it.closes != 1 }.map { "${it.label}: ${it.closes} closes" } +
      results.filter { it.closes != 1 }.map { "result: ${it.closes} closes" }
    check(leaks.isEmpty()) { leaks.joinToString() }
  }
}
class OrtEnvironment {
  companion object { fun getEnvironment() = OrtEnvironment() }
}
class OnnxTensor(val label: String, val floatBuffer: FloatBuffer = FloatBuffer.allocate(0)) : AutoCloseable {
  var closes = 0
  init { Faults.tensors.add(this) }
  override fun close() { closes++ }
  companion object {
    fun createTensor(environment: OrtEnvironment, data: LongBuffer, shape: LongArray) = Faults.allocate()
    fun createTensor(environment: OrtEnvironment, data: FloatBuffer, shape: LongArray) = Faults.allocate()
    fun createTensor(environment: OrtEnvironment, data: BooleanArray) = Faults.allocate()
  }
}
class OrtSession(val kind: String) {
  val inputNames = setOf("past_key_values.0.encoder.key", "past_key_values.0.decoder.key")
  var runs = 0
  fun run(inputs: Map<String, OnnxTensor>): Result {
    check(inputs.values.all { it.closes == 0 }) { "Run used closed tensors" }
    runs++
    if (Faults.failRun == kind) error("injected $kind run")
    if (kind == "encoder") return Result(if (Faults.badOutput == "hidden") emptyMap() else mapOf("last_hidden_state" to OnnxTensor("hidden")))
    Faults.onDecoderRun?.invoke()
    val logits = FloatArray(if (Faults.badOutput == "vocabulary") 2 else 65001) { -100f }
    if (logits.size > 8) {
      for (id in 1..8) logits[id] = (10 - id).toFloat()
      if (runs > 5) logits[0] = 20f
      if (Faults.badOutput == "nonfinite") logits.fill(Float.NEGATIVE_INFINITY)
    }
    val values = linkedMapOf<String, OnnxTensor>()
    if (Faults.badOutput != "logits") values["logits"] = OnnxTensor("logits $runs", FloatBuffer.wrap(logits))
    values["present.0.encoder.key"] = OnnxTensor("encoder KV $runs")
    values["present.0.decoder.key"] = OnnxTensor("decoder KV $runs")
    return Result(values)
  }
  class Result(val values: Map<String, OnnxTensor>) : AutoCloseable, Iterable<Map.Entry<String, OnnxTensor>> {
    var closes = 0
    init { Faults.results.add(this) }
    fun get(name: String): Optional<OnnxTensor> = Optional.ofNullable(values[name])
    override fun iterator() = values.entries.iterator()
    override fun close() { closes++; values.values.forEach { it.close() } }
  }
}
