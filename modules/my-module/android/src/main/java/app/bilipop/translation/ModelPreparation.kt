package app.bilipop.translation

internal fun modelUnsupportedReason(api: Int, is64Bit: Boolean, abis: List<String>): String? = when {
  api < 26 -> "This translation model requires Android 8.0 or newer. Saved text remains available."
  !is64Bit || abis.none { it == "arm64-v8a" || it == "x86_64" } ->
    "This translation model requires a supported 64-bit device. Saved text remains available."
  else -> null
}

/** Lazy storage/inference callbacks guarantee unsupported devices do not download
 * or touch the LiteRT class loader. A verified file alone is never UI readiness. */
internal fun prepareModel(
  unsupportedReason: String?, readStatus: () -> ModelStatus,
  initialize: () -> Unit, emit: (ModelStatus) -> Unit,
): ModelStatus {
  if (unsupportedReason != null) return ModelStatus("unsupported", 0, PinnedHyModel.spec.bytes, unsupportedReason)
  val value = readStatus()
  if (value.state != "ready") return value
  emit(value.copy(state = "verifying"))
  return try {
    initialize()
    value.also(emit)
  } catch (_: Exception) {
    value.copy(state = "error", error = "The model is downloaded, but could not start on this device. Close other apps and retry. Your original is unchanged.").also(emit)
  } catch (_: LinkageError) {
    value.copy(state = "error", error = "The translation runtime could not load on this device. Your original is unchanged.").also(emit)
  } catch (_: OutOfMemoryError) {
    value.copy(state = "error", error = "Not enough memory to start this model. Close other apps and retry. Your original is unchanged.").also(emit)
  }
}
