package app.bilipop.translation

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.locks.ReentrantLock

internal data class ModelSpec(val url: String, val bytes: Long, val sha256: String)
internal object PinnedHyModel {
  const val REVISION = "4d8552d273b5b4e064358e1a6ff37b396d0726e5"
  val spec = ModelSpec(
    "https://huggingface.co/Hatsunama/caption-studio-hy-mt2-1.8b-q8/resolve/$REVISION/model.litertlm",
    1815668080L, "ed7747292c58435ab6e4b58bd7837c566737aae3eec5da6e3c328998529dcf97",
  )
}
internal data class ModelStatus(val state: String, val downloadedBytes: Long, val totalBytes: Long, val error: String? = null) {
  fun asMap(): Map<String, Any> = buildMap {
    put("state", state); put("downloadedBytes", downloadedBytes.toDouble()); put("totalBytes", totalBytes.toDouble())
    error?.let { put("error", it) }
  }
}

/** Only the pinned public model is fetched. Text is never an input to this class.
 * .part files survive cancellation/process death; only hash-verified bytes are activated. */
internal class PinnedModelStore(
  private val root: File,
  private val spec: ModelSpec = PinnedHyModel.spec,
  private val availableBytes: () -> Long = { root.usableSpace },
  private val openConnection: (URL) -> HttpURLConnection = { it.openConnection() as HttpURLConnection },
  private val onStatus: (ModelStatus) -> Unit = {},
) {
  private val operation = ReentrantLock()
  private val stateLock = Any()
  private val generation = AtomicInteger(0)
  private val target = File(root, "${spec.sha256}.litertlm")
  private val partial = File(root, "${spec.sha256}.part")
  private var connection: HttpURLConnection? = null
  private var verifiedStamp: Pair<Long, Long>? = null
  @Volatile private var current = ModelStatus(if (target.isFile) "verifying" else if (partial.length() > 0) "paused" else "missing", partial.length(), spec.bytes)

  fun epoch(): Int = generation.get()
  fun status(): ModelStatus = current
  private fun publish(state: String, bytes: Long, error: String? = null): ModelStatus {
    val value = ModelStatus(state, bytes, spec.bytes, error)
    current = value
    // A detached UI must not turn a successful download into a model failure.
    runCatching { onStatus(value) }
    return value
  }
  fun cancel() {
    generation.incrementAndGet()
    synchronized(stateLock) { connection?.disconnect() }
  }
  private fun checkEpoch(expected: Int) {
    if (generation.get() != expected) throw DownloadPaused()
  }
  fun refresh(): ModelStatus {
    if (!operation.tryLock()) return current
    try {
      ensureRoot()
      if (verifyActive()) return publish("ready", spec.bytes)
      return publish(if (partial.length() > 0) "paused" else "missing", partial.length())
    } catch (_: Exception) {
      return publish("error", partial.length(), "Could not read model storage. Your text is unchanged.")
    } finally { operation.unlock() }
  }
  fun requireVerifiedFile(): File {
    operation.lock()
    try {
      ensureRoot()
      check(verifyActive()) { "Download the translation model first. Your original is unchanged." }
      publish("ready", spec.bytes)
      return target
    } finally { operation.unlock() }
  }
  fun discardPartial(): ModelStatus {
    check(operation.tryLock()) { "Wait for model download cancellation to finish." }
    try {
      ensureRoot()
      if (partial.exists()) check(partial.delete()) { "Could not remove the incomplete model download." }
      return if (verifyActive()) publish("ready", spec.bytes) else publish("missing", 0)
    } finally { operation.unlock() }
  }
  private fun ensureRoot() {
    check(root.isDirectory || root.mkdirs()) { "Could not open private model storage." }
    // Android may supply Context.filesDir through a platform-owned ancestor alias
    // (/data/user/0 vs /data/data). Canonicalize the parent, then bind our own
    // directory and children to it. Our model-directory or child links may not escape.
    val expectedRoot = File(requireNotNull(root.absoluteFile.parentFile).canonicalFile, root.name)
    require(root.canonicalFile == expectedRoot) { "Model storage must stay in this app's private directory." }
    for (file in listOf(target, partial)) require(file.canonicalFile == File(expectedRoot, file.name)) {
      "Model files must stay in private storage."
    }
  }
  private fun verifyActive(): Boolean {
    if (!target.isFile) { verifiedStamp = null; return false }
    val stamp = target.length() to target.lastModified()
    if (stamp == verifiedStamp) return true
    publish("verifying", target.length())
    if (stamp.first == spec.bytes && hash(target) == spec.sha256) {
      verifiedStamp = stamp; return true
    }
    // This class owns only these content-addressed model files, never drafts or other models.
    check(target.delete()) { "The model is damaged and could not be removed. Free storage and retry." }
    verifiedStamp = null
    return false
  }
  fun download(requestEpoch: Int): ModelStatus {
    check(operation.tryLock()) { "A model operation is already running." }
    try {
      checkEpoch(requestEpoch)
      ensureRoot()
      if (verifyActive()) return publish("ready", spec.bytes)
      if (partial.length() > spec.bytes) check(partial.delete()) { "Could not remove an invalid partial model." }
      var offset = partial.length()
      requireSpace(spec.bytes - offset)
      publish("downloading", offset)
      if (offset < spec.bytes) {
        val response = request(offset, requestEpoch)
        try {
          val code = response.responseCode
          if (code == HttpURLConnection.HTTP_OK) {
            // A server ignoring Range is safe only if the partial is replaced, never appended.
            offset = 0
            requireSpace(spec.bytes - partial.length())
          } else if (code == HttpURLConnection.HTTP_PARTIAL) {
            val expected = "bytes $offset-${spec.bytes - 1}/${spec.bytes}"
            if (response.getHeaderField("Content-Range") != expected) throw InvalidDownload("Model resume range did not match the pinned file. Retry the download.")
          } else throw IOException("Model server returned HTTP $code.")
          val length = response.getHeaderFieldLong("Content-Length", -1)
          if (length >= 0 && length != spec.bytes - offset) throw InvalidDownload("Model download size did not match the pinned file.")
          checkEpoch(requestEpoch)
          response.inputStream.use { input ->
            FileOutputStream(partial, offset > 0).use { output ->
              val buffer = ByteArray(64 * 1024)
              var lastEvent = 0L
              while (true) {
                checkEpoch(requestEpoch)
                val count = input.read(buffer)
                if (count < 0) break
                if (offset + count > spec.bytes) throw InvalidDownload("Model download exceeded the pinned file size.")
                output.write(buffer, 0, count); offset += count
                val now = System.nanoTime()
                if (now - lastEvent > 200_000_000L) { publish("downloading", offset); lastEvent = now }
              }
              output.fd.sync()
            }
          }
          if (offset != spec.bytes) throw IOException("Model download was interrupted. Resume to continue.")
        } finally {
          synchronized(stateLock) { if (connection === response) connection = null }
          response.disconnect()
        }
      }
      checkEpoch(requestEpoch)
      publish("verifying", spec.bytes)
      if (hash(partial) { checkEpoch(requestEpoch) } != spec.sha256) throw InvalidDownload("Model integrity check failed. The damaged download was removed; retry.")
      checkEpoch(requestEpoch)
      check(partial.renameTo(target)) { "Could not activate the verified model. Free storage and retry." }
      verifiedStamp = target.length() to target.lastModified()
      return publish("ready", spec.bytes)
    } catch (_: DownloadPaused) {
      return publish("paused", partial.length())
    } catch (error: Exception) {
      if (generation.get() != requestEpoch) return publish("paused", partial.length())
      if (error is InvalidDownload) partial.delete()
      return publish("error", partial.length(), if (error is InvalidDownload || error is IllegalArgumentException || error is IllegalStateException) error.message else "Model download was interrupted. Check your connection and resume.")
    } finally { operation.unlock() }
  }
  private fun requireSpace(remaining: Long) {
    require(availableBytes() >= remaining + STORAGE_RESERVE_BYTES) {
      "Not enough storage. Keep at least ${remaining + STORAGE_RESERVE_BYTES} bytes free to download and verify this model."
    }
  }
  private fun request(offset: Long, expectedEpoch: Int): HttpURLConnection {
    var url = URL(spec.url)
    repeat(6) {
      checkEpoch(expectedEpoch)
      val host = url.host.lowercase()
      require(url.protocol == "https" && (host == "huggingface.co" || host.endsWith(".huggingface.co") || host == "hf.co" || host.endsWith(".hf.co"))) {
        "Model redirect was not an approved Hugging Face HTTPS download."
      }
      val next = openConnection(url)
      next.instanceFollowRedirects = false
      next.connectTimeout = 20_000; next.readTimeout = 30_000
      next.setRequestProperty("Accept-Encoding", "identity")
      if (offset > 0) next.setRequestProperty("Range", "bytes=$offset-")
      synchronized(stateLock) { checkEpoch(expectedEpoch); connection = next }
      try {
        val code = next.responseCode
        if (code !in listOf(301, 302, 303, 307, 308)) return next
        val location = next.getHeaderField("Location") ?: throw IOException("Missing model redirect.")
        url = URL(url, location)
      } catch (error: Exception) {
        synchronized(stateLock) { if (connection === next) connection = null }
        next.disconnect(); throw error
      }
      synchronized(stateLock) { if (connection === next) connection = null }
      next.disconnect()
    }
    throw IOException("Too many model download redirects.")
  }
  private fun hash(file: File, check: () -> Unit = {}): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buffer = ByteArray(64 * 1024)
      while (true) { check(); val size = input.read(buffer); if (size < 0) break; digest.update(buffer, 0, size) }
    }
    return digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
  }
  private class DownloadPaused : IOException()
  private class InvalidDownload(message: String) : IOException(message)
  companion object { const val STORAGE_RESERVE_BYTES = 256L * 1024 * 1024 }
}
