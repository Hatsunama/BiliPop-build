package app.bilipop.translation

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import android.os.Build
import java.util.concurrent.atomic.AtomicBoolean

class BiliPopTranslationModule : Module() {
  private val destroyed = AtomicBoolean(false)
  private val setup = Any()
  private var storeInstance: PinnedModelStore? = null
  private val queues = TranslationWorkQueues()
  private val engineRuntime = SerialTranslationRuntime { model ->
    val context = requireNotNull(appContext.reactContext) { "The app is not ready." }
    val cache = File(context.cacheDir, "hy-mt2-runtime").apply { mkdirs() }
    LiteRtTranslationEngine(model, cache)
  }
  private fun emit(value: ModelStatus) {
    queues.record(value)
    if (!destroyed.get()) sendEvent("onModelStatus", value.asMap())
  }
  private fun store(): PinnedModelStore = synchronized(setup) {
    check(!destroyed.get()) { "Translation module is closed." }
    storeInstance ?: PinnedModelStore(File(requireNotNull(appContext.reactContext).filesDir, "hy-mt2-model"), onStatus = {
      // File integrity alone is insufficient readiness: native engine initialization must succeed.
      emit(if (it.state == "ready") it.copy(state = "verifying") else it)
    }).also { storeInstance = it }
  }
  private fun unsupportedReason(): String? = modelUnsupportedReason(Build.VERSION.SDK_INT,
    android.os.Process.is64Bit(), Build.SUPPORTED_ABIS.toList())
  private fun prepare(readStatus: () -> ModelStatus): ModelStatus = queues.record(prepareModel(
    unsupportedReason(), readStatus, { engineRuntime.load(store().requireVerifiedFile()) }, ::emit,
  ))
  override fun definition() = ModuleDefinition {
    Name("BiliPopTranslation")
    Events("onModelStatus")
    Function("epoch") { engineRuntime.epoch() }
    Function("cancel") { engineRuntime.cancel(); Unit }
    Function("downloadEpoch") { store().epoch() }
    Function("cancelModelDownload") { store().cancel(); Unit }
    AsyncFunction("getModelStatus") {
      queues.status { prepare { store().refresh() } }.asMap()
    }.runOnQueue(queues.statusScope)
    AsyncFunction("downloadModel") { requestEpoch: Int ->
      queues.work { prepare { store().download(requestEpoch) }.asMap() }
    }.runOnQueue(queues.workScope)
    AsyncFunction("discardPartialModel") {
      queues.work { prepare { store().discardPartial() }.asMap() }
    }.runOnQueue(queues.workScope)
    AsyncFunction("load") {
      queues.work {
        val status = prepare { store().refresh() }
        check(status.state == "ready") { status.error ?: "Download the translation model first. Your original is unchanged." }
      }
    }.runOnQueue(queues.workScope)
    AsyncFunction("translate") { prompt: String, requestEpoch: Int ->
      queues.work {
        val status = prepare { store().refresh() }
        check(status.state == "ready") { status.error ?: "Download the translation model first. Your original is unchanged." }
        engineRuntime.translate(prompt, requestEpoch)
      }
    }.runOnQueue(queues.workScope)
    AsyncFunction("release") {
      queues.work { queues.unprepared(); engineRuntime.release(); Unit }
    }.runOnQueue(queues.workScope)
    OnDestroy {
      destroyed.set(true)
      queues.close({
        synchronized(setup) { runCatching { storeInstance?.cancel() } }
        engineRuntime.cancel()
      }, { engineRuntime.destroy() })
    }
  }
}
