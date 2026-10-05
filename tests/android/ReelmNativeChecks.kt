package expo.modules.video

import android.content.Context
import android.util.AtomicFile
import java.io.ByteArrayInputStream
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.json.JSONObject

object ReelmNativeChecks {
  @JvmStatic fun run(context: Context, suite: String): Map<String, Any> {
    if(suite == "migration")return migration(context)
    if(suite == "updates")return updates(context)
    require(suite == "library") { "UNKNOWN_NATIVE_SUITE" }
    val directory = File(context.filesDir, "reelm-task2-library-check")
    require(!directory.exists()) { "TEST_DIRECTORY_ALREADY_EXISTS" }
    check(directory.mkdir())
    val file = File(directory, "library.json")
    val store = ReelmLibraryStore(file)
    try {
      check(store.read() == null)
      val old = "{\"old\":\"é\"}"
      val next = "{\"new\":\"完整\"}"
      store.write(old)
      var rejected = false
      try { store.write("é".repeat(ReelmLibraryStore.CAP / 2 + 1)) } catch (_: IllegalArgumentException) { rejected = true }
      check(rejected && store.read() == old)
      val atomic = AtomicFile(file)
      var stream = atomic.startWrite(); stream.write("partial".toByteArray()); atomic.failWrite(stream)
      check(store.read() == old)
      stream = atomic.startWrite(); stream.write("interrupted".toByteArray()); stream.fd.sync(); stream.close()
      check(ReelmLibraryStore(file).read() == old)
      val pool = Executors.newFixedThreadPool(4)
      try {
        val jobs = (0 until 40).map { i -> pool.submit {
          ReelmLibraryStore(file).write(if (i % 2 == 0) old else next)
          check(ReelmLibraryStore(file).read() in listOf(old, next))
        } }
        jobs.forEach { it.get(15, TimeUnit.SECONDS) }
      } finally { pool.shutdownNow() }
      check(store.read() in listOf(old, next))
      val installed = ReelmVideoBridge().let { bridge -> try { bridge.installed(context) } finally { bridge.destroy() } }
      return mapOf("nativeChecks" to "library PASS", "assertions" to 7, "installed" to installed)
    } finally {
      listOf(file, File(file.path + ".bak"), File(file.path + ".new")).forEach { if (it.exists()) check(it.delete()) }
      check(directory.delete())
    }
  }
  private fun migration(context:Context):Map<String,Any> {
    var assertions=0;fun verify(value:Boolean){check(value);assertions++}
    fun reject(block:()->Unit){var failed=false;try{block()}catch(_:Exception){failed=true};verify(failed)}
    val body="é完整\uD83D\uDE00";verify(ReelmLibraryStore.decode(ByteArrayInputStream(ReelmLibraryStore.encode(body)))==body)
    val limit="x".repeat(ReelmLibraryStore.CAP);verify(ReelmLibraryStore.decode(ByteArrayInputStream(ReelmLibraryStore.encode(limit)))==limit)
    reject {ReelmLibraryStore.encode(limit+"x")};reject {ReelmLibraryStore.encode("\uD800")}
    reject {ReelmLibraryStore.decode(ByteArrayInputStream(byteArrayOf(0xc0.toByte(),0xaf.toByte())))}
    reject {ReelmLibraryStore.decode(ByteArrayInputStream(ByteArray(ReelmLibraryStore.CAP+1)))}
    return mapOf("nativeChecks" to "migration PASS","assertions" to assertions,"installed" to ReelmVideoBridge().let {b->try{b.installed(context)}finally{b.destroy()}})
  }
  private fun updates(context:Context):Map<String,Any> {
    var assertions=0;fun verify(value:Boolean){check(value);assertions++}
    fun reject(code:String,block:()->Unit){var caught:String?=null;try{block()}catch(e:Exception){caught=e.message};check(caught==code){"EXPECTED_${code}_GOT_$caught"};assertions++}
    val updater=ReelmApkUpdater.get(context)
    val installed=File(context.applicationInfo.sourceDir)
    fun meta(file:File)=JSONObject().put("releaseTag","v0.2.1").put("assetName","ReelmDrama-arm64-v8a.apk").put("url","https://github.com/azeez-d3v/reelmdrama/releases/download/v0.2.1/ReelmDrama-arm64-v8a.apk").put("bytes",file.length()).put("sha256",ReelmApkUpdater.digest(file))
    verify(ReelmApkUpdater.safeURL(meta(installed).getString("url"),true).startsWith("https://github.com/"))
    for(url in listOf("http://github.com/a","https://github.com.evil.invalid/a","https://user:secret@github.com/a","https://github.com:444/a","https://github.com/a#b"))reject("UPDATE_URL"){ReelmApkUpdater.safeURL(url)}
    reject("UPDATE_URL"){ReelmApkUpdater.safeURL("https://github.com/other/repo/releases/download/v1/ReelmDrama-arm64-v8a.apk",true)}
    if(!updater.trusted()) {reject("UPDATE_SIGNER"){updater.verify(installed,meta(installed))};return mapOf("nativeChecks" to "updates legacy fails closed PASS","assertions" to assertions)}
    reject("UPDATE_DOWNGRADE"){updater.verify(installed,meta(installed))}
    reject("UPDATE_SIZE"){updater.verify(installed,meta(installed).put("bytes",installed.length()+1))}
    reject("UPDATE_DIGEST"){updater.verify(installed,meta(installed).put("sha256","0".repeat(64)))}
    val candidate=File("/data/local/tmp/reelm-drama-upgrade.apk")
    if(candidate.isFile) {
      verify(updater.verify(candidate,meta(candidate))>(ReelmVideoBridge().let {b->try{(b.installed(context)["versionCode"] as Number).toLong()}finally{b.destroy()}}))
      val own=File(context.noBackupFilesDir,"reelm-update-fixture.apk");check(!own.exists());candidate.copyTo(own)
      try {updater.acceptVerifiedFile(own,meta(candidate));verify(updater.status()["state"]=="verified");updater.cancel();verify(updater.status()["state"]=="idle")}
      finally {if(own.exists())check(own.delete())}
    }
    val wrong=File("/data/local/tmp/reelm-drama-wrong.apk")
    if(wrong.isFile)reject("UPDATE_PACKAGE"){updater.verify(wrong,meta(wrong))}
    val legacy=File("/data/local/tmp/reelm-drama-legacy.apk")
    if(legacy.isFile)reject("UPDATE_SIGNER"){updater.verify(legacy,meta(legacy))}
    return mapOf("nativeChecks" to "updates PASS","assertions" to assertions,"actualHigherCodeCandidate" to candidate.isFile(),"wrongPackageCandidate" to wrong.isFile(),"legacyCandidate" to legacy.isFile(),"installed" to ReelmVideoBridge().let {b->try{b.installed(context)}finally{b.destroy()}})
  }
}
