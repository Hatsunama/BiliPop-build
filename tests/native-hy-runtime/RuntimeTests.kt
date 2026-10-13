package app.bilipop.translation

import java.io.ByteArrayInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.nio.file.Files
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

private fun assertThat(value: Boolean, message: String) { check(value) { message } }
private fun expectFailure(message: String, block: () -> Unit) {
  val result = runCatching(block)
  check(result.isFailure) { "Expected failure: $message" }
}
private class FakeConversation(private val log: MutableList<String>) : TranslationConversation {
  val started = CountDownLatch(1)
  var callback: TranslationCallback? = null
  var bytes = 700
  var cancelThrows = false
  var tokens = TokenUsage(170, 12, 182)
  override fun renderedInputBytes(prompt: String) = bytes
  override fun start(prompt: String, callback: TranslationCallback) {
    log.add("start"); this.callback = callback; started.countDown()
  }
  override fun cancel() { log.add("cancel"); if (cancelThrows) throw IllegalStateException("native cancel failed") }
  override fun usage() = tokens
  override fun close() { log.add("conversation-close") }
  fun complete(text: String = "Bonjour") { callback!!.onText(text); callback!!.onDone() }
}
private fun testRuntime() {
  val log = java.util.Collections.synchronizedList(mutableListOf<String>())
  val sessions = java.util.Collections.synchronizedList(mutableListOf<FakeConversation>())
  val runtime = SerialTranslationRuntime { log.add("load"); object : TranslationEngine {
    override fun conversation() = FakeConversation(log).also { sessions.add(it) }
    override fun close() { log.add("engine-close") }
  } }
  val pool = Executors.newFixedThreadPool(3)
  try {
    runtime.load(File("model")); runtime.load(File("model"))
    check(log.count { it == "load" } == 1)
    val first = pool.submit<String> { runtime.translate("prompt", runtime.epoch()) }
    while (sessions.isEmpty()) Thread.sleep(1)
    sessions[0].started.await(2, TimeUnit.SECONDS)
    sessions[0].cancelThrows = true
    check(runCatching { runtime.cancel() }.isSuccess) { "Native cancellation error must not abandon a live handle" }
    val release = pool.submit { runtime.release() }
    Thread.sleep(20)
    assertThat(!first.isDone && !release.isDone, "Cancellation must retain live native ownership")
    assertThat("conversation-close" !in log && "engine-close" !in log, "No premature native close")
    sessions[0].complete("stale")
    expectFailure("stale cancelled output") { first.get(2, TimeUnit.SECONDS) }
    release.get(2, TimeUnit.SECONDS)
    assertThat(log.indexOf("conversation-close") < log.indexOf("engine-close"), "Conversation closes before engine")
    runtime.load(File("model"))
    val second = pool.submit<String> { runtime.translate("prompt", runtime.epoch()) }
    while (sessions.size < 2) Thread.sleep(1)
    sessions[1].started.await(2, TimeUnit.SECONDS); sessions[1].complete()
    check(second.get(2, TimeUnit.SECONDS) == "Bonjour")
    val priorEpoch = runtime.epoch(); runtime.cancel()
    expectFailure("queued epoch cancelled before native start") { runtime.translate("prompt", priorEpoch) }
    val third = pool.submit<String> { runtime.translate("prompt", runtime.epoch()) }
    while (sessions.size < 3) Thread.sleep(1)
    sessions[2].started.await(2, TimeUnit.SECONDS); sessions[2].tokens = TokenUsage(170, 256, 426); sessions[2].complete()
    expectFailure("output cap must not publish truncated text") { third.get(2, TimeUnit.SECONDS) }
    runtime.release()
    println("PASS native cancellation, terminal ownership, serial release, recovery, stale epoch, output cap")
  } finally { pool.shutdownNow() }
  var closed = 0
  val bounded = SerialTranslationRuntime { object : TranslationEngine {
    override fun close() {}
    override fun conversation() = object : TranslationConversation {
      override fun renderedInputBytes(prompt: String) = 769
      override fun start(prompt: String, callback: TranslationCallback) { error("must not start") }
      override fun cancel() {}
      override fun usage() = TokenUsage(0,0,0)
      override fun close() { closed++ }
    }
  } }
  bounded.load(File("model")); expectFailure("input budget") { bounded.translate("prompt", bounded.epoch()) }
  check(closed == 1); bounded.destroy(); expectFailure("destroyed load") { bounded.load(File("model")) }
  println("PASS rendered-input preflight closes unused session and destroyed runtime rejects load")
}
private class Response(url: URL, private val code: Int, private val data: ByteArray, private val headers: Map<String,String> = emptyMap(), private val firstRead: (() -> Unit)? = null) : HttpURLConnection(url) {
  var disconnected = false
  override fun connect() {}
  override fun disconnect() { disconnected = true }
  override fun usingProxy() = false
  override fun getResponseCode() = code
  override fun getHeaderField(name: String) = headers[name]
  override fun getHeaderFieldLong(name: String, default: Long) = headers[name]?.toLongOrNull() ?: default
  override fun getInputStream() = object : ByteArrayInputStream(data) {
    var readOnce = false
    override fun read(b: ByteArray, off: Int, len: Int): Int {
      if (!readOnce) { readOnce = true; firstRead?.invoke() }
      return super.read(b, off, len)
    }
  }
}
private fun testStore() {
  val data = "trained candidate bytes".toByteArray()
  val hash = MessageDigest.getInstance("SHA-256").digest(data).joinToString("") { "%02x".format(it.toInt() and 255) }
  val spec = ModelSpec(PinnedHyModel.spec.url, data.size.toLong(), hash)
  fun root() = Files.createTempDirectory("bilipop-model-test-").toFile()
  val roots = mutableListOf<File>()
  fun nextRoot() = root().also { roots.add(it) }
  try {
    val dir = nextRoot(); val statuses = mutableListOf<String>()
    val store = PinnedModelStore(dir, spec, { Long.MAX_VALUE }, { Response(it, 200, data) }, { statuses.add(it.state) })
    check(store.refresh().state == "missing")
    check(store.download(store.epoch()).state == "ready")
    check(store.requireVerifiedFile().readBytes().contentEquals(data))
    check(statuses.indexOf("verifying") < statuses.lastIndexOf("ready"))
    assertThat(dir.listFiles()!!.none { it.name.endsWith(".part") }, "Activation must rename, not duplicate")
    println("PASS pinned bytes, SHA256, atomic activation, readiness")

    val resumedDir = nextRoot(); File(resumedDir, "$hash.part").writeBytes(data.take(4).toByteArray())
    var requestRange: String? = null
    val resumed = PinnedModelStore(resumedDir, spec, { Long.MAX_VALUE }, { url -> object : HttpURLConnection(url) {
      override fun connect() {}; override fun disconnect() {}; override fun usingProxy() = false
      override fun getResponseCode(): Int { requestRange = getRequestProperty("Range"); return 206 }
      override fun getHeaderField(name:String) = if(name=="Content-Range") "bytes 4-${data.size-1}/${data.size}" else null
      override fun getInputStream() = ByteArrayInputStream(data.drop(4).toByteArray())
    } })
    check(resumed.download(resumed.epoch()).state == "ready"); check(requestRange == "bytes=4-")
    println("PASS exact Range resume")

    val ignoreDir = nextRoot(); File(ignoreDir, "$hash.part").writeBytes(data.take(4).toByteArray())
    val ignoredRange = PinnedModelStore(ignoreDir,spec,{Long.MAX_VALUE},{Response(it,200,data)})
    check(ignoredRange.download(ignoredRange.epoch()).state == "ready")
    check(ignoredRange.requireVerifiedFile().readBytes().contentEquals(data))
    println("PASS ignored Range restarts instead of appending")

    val bad = PinnedModelStore(nextRoot(),spec,{Long.MAX_VALUE},{Response(it,200,ByteArray(data.size){1})})
    val badStatus=bad.download(bad.epoch());check(badStatus.state=="error" && badStatus.downloadedBytes==0L)
    expectFailure("corrupt file activation") { bad.requireVerifiedFile() }
    val wrongRange = PinnedModelStore(nextRoot(),spec,{Long.MAX_VALUE},{Response(it,206,data,mapOf("Content-Range" to "bytes 1-${data.size}/${data.size+1}"))})
    check(wrongRange.download(wrongRange.epoch()).state=="error")
    println("PASS corrupt hash and mismatched resume range fail closed")

    var opened = false
    val low = PinnedModelStore(nextRoot(),spec,{0},{opened=true;Response(it,200,data)})
    check(low.download(low.epoch()).state=="error" && !opened)
    val redirected = PinnedModelStore(nextRoot(),spec,{Long.MAX_VALUE},{Response(it,302,byteArrayOf(), mapOf("Location" to "http://127.0.0.1/model"))})
    check(redirected.download(redirected.epoch()).state=="error")
    println("PASS storage preflight and HTTPS HF redirect allowlist")

    lateinit var paused: PinnedModelStore
    val pauseDir=nextRoot()
    paused=PinnedModelStore(pauseDir,spec,{Long.MAX_VALUE},{Response(it,200,data,firstRead={paused.cancel()})})
    check(paused.download(paused.epoch()).state=="paused")
    check(!File(pauseDir,"$hash.litertlm").exists())
    check(paused.discardPartial().state=="missing")
    val epoch=paused.epoch();paused.cancel();check(paused.download(epoch).state=="paused")
    println("PASS pause retains partial, explicit discard is bounded, pre-start cancel prevents request")

    val interruptedDir=nextRoot()
    val interrupted=PinnedModelStore(interruptedDir,spec,{Long.MAX_VALUE},{Response(it,200,data.take(3).toByteArray())})
    check(interrupted.download(interrupted.epoch()).state=="error")
    check(File(interruptedDir,"$hash.part").length()==3L)
    println("PASS interrupted streams retain resumable partial")

    val realParent=nextRoot();val aliasParent=File(nextRoot(),"app-files-alias")
    Files.createSymbolicLink(aliasParent.toPath(),realParent.toPath())
    val aliasStore=PinnedModelStore(File(aliasParent,"models"),spec,{Long.MAX_VALUE},{Response(it,200,data)})
    check(aliasStore.download(aliasStore.epoch()).state=="ready") { "Platform-owned ancestor aliases must be accepted" }
    check(aliasStore.requireVerifiedFile().canonicalFile.parentFile==File(realParent,"models"))
    val escapeRoot=nextRoot();val outside=File(nextRoot(),"outside.bin").apply { writeBytes(data) }
    Files.createSymbolicLink(File(escapeRoot,"$hash.part").toPath(),outside.toPath())
    val escapeStore=PinnedModelStore(escapeRoot,spec,{Long.MAX_VALUE},{error("must not connect for escaping child")})
    check(escapeStore.refresh().state=="error") { "Invalid storage must be a visible error, not a throw/stuck verifying state" }
    check(escapeStore.download(escapeStore.epoch()).state=="error")
    check(outside.readBytes().contentEquals(data))
    val escapingDirectory = File(nextRoot(), "models")
    Files.createSymbolicLink(escapingDirectory.toPath(), nextRoot().toPath())
    val escapedRootStore= PinnedModelStore(escapingDirectory,spec,{Long.MAX_VALUE},{error("must not connect for escaping model root")})
    check(escapedRootStore.refresh().state=="error")
    check(escapedRootStore.download(escapedRootStore.epoch()).state=="error")
    println("PASS legitimate storage ancestor aliases, escaped root/child rejection and visible storage errors")

  } finally { roots.forEach { it.deleteRecursively() } }
}
private fun testPreparation() {
  for(api in listOf(24,25)) {
    val reason=modelUnsupportedReason(api,true,listOf("arm64-v8a"))
    check(reason != null)
    val result=prepareModel(reason,{error("must not read/download")},{error("must not load native class")},{error("must not emit ready")})
    check(result.state=="unsupported")
  }
  check(modelUnsupportedReason(26,true,listOf("arm64-v8a"))==null)
  check(modelUnsupportedReason(35,true,listOf("x86_64"))==null)
  check(modelUnsupportedReason(35,false,listOf("arm64-v8a","armeabi-v7a"))!=null)
  val events=mutableListOf<String>()
  val ready=ModelStatus("ready",10,10)
  val result=prepareModel(null,{ready},{check(events==listOf("verifying"));events.add("initialized")},{events.add(it.state)})
  check(result.state=="ready" && events==listOf("verifying","initialized","ready"))
  val failed=prepareModel(null,{ready},{throw OutOfMemoryError()},{})
  check(failed.state=="error" && failed.error!!.contains("memory"))
  println("PASS API24/25/32-bit gate precedes storage/native loading; ready waits for successful engine initialization")
}
fun main(args: Array<String>) { testRuntime(); testStore(); testPreparation(); testBridgeQueues(File(args.single())) }
