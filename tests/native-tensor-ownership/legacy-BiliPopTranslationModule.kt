package app.bilipop.translation

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.nio.FloatBuffer
import java.nio.LongBuffer
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.exp
import kotlin.math.ln

class BiliPopTranslationModule : Module() {
  private val gate = Any()
  private val epoch = AtomicInteger(0)
  private val environment = OrtEnvironment.getEnvironment()
  private var encoder: OrtSession? = null
  private var decoder: OrtSession? = null

  override fun definition() = ModuleDefinition {
    Name("BiliPopTranslation")
    Function("epoch") { epoch.get() }
    Function("cancel") { epoch.incrementAndGet(); Unit }
    AsyncFunction("load") { encoderPath: String, decoderPath: String ->
      synchronized(gate) {
        if (encoder == null || decoder == null) {
          val context = requireNotNull(appContext.reactContext)
          val roots = listOf(context.cacheDir.canonicalPath, context.filesDir.canonicalPath)
          for (path in listOf(encoderPath, decoderPath)) {
            val file = File(path).canonicalFile
            require(file.isFile && roots.any { file.path.startsWith(it + File.separator) }) {
              "Model must be an embedded file in this app's private storage."
            }
          }
          OrtSession.SessionOptions().use { options ->
            options.setIntraOpNumThreads(2)
            options.setInterOpNumThreads(1)
            val enc = environment.createSession(encoderPath, options)
            try {
              decoder = environment.createSession(decoderPath, options)
              encoder = enc
            } catch (error: Exception) {
              enc.close()
              throw error
            }
          }
        }
      }
    }
    AsyncFunction("translate") { ids: List<Int>, requestEpoch: Int ->
      synchronized(gate) { decode(ids, requestEpoch) }
    }
    OnDestroy {
      epoch.incrementAndGet()
      synchronized(gate) {
        decoder?.close(); encoder?.close()
        decoder = null; encoder = null
      }
    }
  }

  private data class Beam(
    val tokens: List<Int>, val score: Double,
    val past: Map<String, OnnxTensor>, val owner: OrtSession.Result?
  )
  private data class Candidate(val id: Int, val value: Double)
  private data class Finished(val tokens: List<Int>, val score: Double)

  private fun checkEpoch(value: Int) {
    check(epoch.get() == value) { "Translation cancelled. Your original is unchanged." }
  }

  private fun decode(ids: List<Int>, requestEpoch: Int): List<Int> {
    require(ids.size in 2..256 && ids.first() == 5 && ids.all { it in 0..65000 }) {
      "Invalid or over-limit translation input."
    }
    checkEpoch(requestEpoch)
    val enc = checkNotNull(encoder) { "Translation model is not loaded." }
    val dec = checkNotNull(decoder) { "Translation model is not loaded." }
    val owned = mutableSetOf<OrtSession.Result>()
    OnnxTensor.createTensor(environment, LongBuffer.wrap(ids.map { it.toLong() }.toLongArray()), longArrayOf(1, ids.size.toLong())).use { input ->
      OnnxTensor.createTensor(environment, LongBuffer.wrap(LongArray(ids.size) { 1L }), longArrayOf(1, ids.size.toLong())).use { mask ->
        OnnxTensor.createTensor(environment, FloatBuffer.allocate(0), longArrayOf(1, 8, 0, 64)).use { empty ->
          try {
            enc.run(mapOf("input_ids" to input, "attention_mask" to mask)).use { encoded ->
              val hidden = encoded.get("last_hidden_state").orElseThrow { IllegalStateException("Missing encoder output") } as OnnxTensor
              val initial = dec.inputNames.filter { it.startsWith("past_key_values.") }.associateWith { empty }
              var beams = listOf(Beam(listOf(65000), 0.0, initial, null))
              val finished = mutableListOf<Finished>()
              var firstResult: OrtSession.Result? = null
              val width = 4
              for (step in 0 until 192) {
                checkEpoch(requestEpoch)
                val candidates = mutableListOf<Beam>()
                for (beam in beams) {
                  checkEpoch(requestEpoch)
                  val output = OnnxTensor.createTensor(environment, LongBuffer.wrap(longArrayOf(beam.tokens.last().toLong())), longArrayOf(1, 1)).use { decoderInput ->
                    OnnxTensor.createTensor(environment, booleanArrayOf(step > 0)).use { cache ->
                      dec.run(beam.past + mapOf(
                        "input_ids" to decoderInput, "encoder_attention_mask" to mask,
                        "encoder_hidden_states" to hidden, "use_cache_branch" to cache
                      ))
                    }
                  }
                  owned.add(output)
                  if (step == 0) firstResult = output
                  val scoreTensor = output.get("logits").orElseThrow { IllegalStateException("Missing decoder scores") } as OnnxTensor
                  val logits = scoreTensor.floatBuffer
                  check(logits.remaining() == 65001) { "Unexpected decoder vocabulary" }
                  val top = mutableListOf<Candidate>()
                  var max = Double.NEGATIVE_INFINITY
                  for (id in 0 until 65000) {
                    val value = logits.get(id).toDouble()
                    if (value > max) max = value
                    if (top.size < width * 2 || value > top.last().value) {
                      top.add(Candidate(id, value)); top.sortByDescending { it.value }
                      if (top.size > width * 2) top.removeAt(top.lastIndex)
                    }
                  }
                  check(max.isFinite()) { "Invalid decoder scores" }
                  var sum = 0.0
                  for (id in 0 until 65000) sum += exp(logits.get(id).toDouble() - max)
                  val logSum = max + ln(sum)
                  val past = beam.past.toMutableMap()
                  for ((name, tensor) in output) {
                    if (name.startsWith("present.") && !(step > 0 && name.contains(".encoder."))) {
                      past[name.replace("present.", "past_key_values.")] = tensor as OnnxTensor
                    }
                  }
                  for (candidate in top) {
                    candidates.add(Beam(beam.tokens + candidate.id, beam.score + candidate.value - logSum, past, output))
                  }
                }
                candidates.sortByDescending { it.score }
                val active = mutableListOf<Beam>()
                for ((rank, candidate) in candidates.withIndex()) {
                  if (candidate.tokens.last() == 0) {
                    if (rank < width && candidate.tokens.size > 2) {
                      finished.add(Finished(candidate.tokens, candidate.score / (candidate.tokens.size - 1)))
                    }
                  } else active.add(candidate)
                  if (active.size == width) break
                }
                finished.sortByDescending { it.score }
                while (finished.size > width) finished.removeAt(finished.lastIndex)
                beams = active
                val keep = active.mapNotNull { it.owner }.toSet() + listOfNotNull(firstResult)
                val stale = owned.filter { it !in keep }
                for (result in stale) { result.close(); owned.remove(result) }
                if (finished.size == width || beams.isEmpty()) break
              }
              checkEpoch(requestEpoch)
              check(finished.isNotEmpty()) { "Translation reached its limit. Split this sentence and try again." }
              return finished.first().tokens
            }
          } finally {
            owned.forEach { it.close() }
          }
        }
      }
    }
  }
}
