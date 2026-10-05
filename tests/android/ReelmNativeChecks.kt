package expo.modules.video

import android.content.Context
import android.util.AtomicFile
import android.net.Uri
import android.system.Os
import android.system.OsConstants
import android.system.ErrnoException
import androidx.media3.common.C
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import java.io.RandomAccessFile
import java.io.File
import java.security.KeyStore
import javax.crypto.KeyGenerator
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.io.BufferedReader
import java.io.InputStreamReader
import org.json.JSONObject
import org.json.JSONArray
import okhttp3.Call

object ReelmNativeChecks {
  @JvmStatic fun run(context: Context, suite: String): Map<String, Any> {
    if(suite == "migration")return migration(context)
    if(suite == "updates")return updates(context)
    if (suite == "crypto") return crypto(context)
    if (suite == "downloads") try { return downloads(context) } catch (failure: Throwable) { android.util.Log.e("ReelmNativeChecks", "DOWNLOADS_FAILURE", failure); throw failure }
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
  private fun downloads(context: Context): Map<String, Any> {
    val root = File(context.noBackupFilesDir, "reelm-task5-download-check"); check(!root.exists() && root.mkdir()) { "TEST_DIRECTORY_ALREADY_EXISTS" }
    val prefix = context.packageName + ".reelm.e2e.task5."
    val keys = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }; var alias: String? = null
    var assertions = 0; fun verify(value: Boolean) { check(value) { "DOWNLOAD_ASSERT_${assertions + 1}" }; assertions++ }
    fun reject(block: () -> Unit) { var bad = false; try { block() } catch (_: Exception) { bad = true }; verify(bad) }
    val server = ServerSocket(0, 8, java.net.InetAddress.getByName("127.0.0.1"))
    val base = "http://127.0.0.1:${server.localPort}"
    data class Reply(val bytes: ByteArray, val type: String, val status: Int = 200, val headers: Map<String,String> = emptyMap(), val block: Boolean = false, val entered: CountDownLatch? = null, val proceed: CountDownLatch? = null)
    val responses = java.util.concurrent.ConcurrentHashMap<String,Reply>()
    val requests = java.util.Collections.synchronizedList(mutableListOf<Map<String,String>>())
    val pool = Executors.newCachedThreadPool(); val blocked = CountDownLatch(1); val release = CountDownLatch(1)
    val accept = pool.submit {
      while (!server.isClosed) try {
        val socket = server.accept()
        pool.submit { socket.use {
          val input = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.US_ASCII)); val line = input.readLine() ?: return@submit
          val path = line.split(' ')[1]; val headers = linkedMapOf<String,String>()
          while (true) { val h = input.readLine() ?: break; if (h.isEmpty()) break; headers[h.substringBefore(':').lowercase()] = h.substringAfter(':').trim() }
          requests.add(headers + mapOf("path" to path)); val reply = responses[path] ?: Reply(byteArrayOf(1), "text/html", 404)
          val range = headers["range"]?.let { Regex("bytes=([0-9]+)-([0-9]+)").matchEntire(it) }
          val sliced = if (range != null && reply.status == 200 && reply.headers["ignore-range"] == null) {
            val start = range.groupValues[1].toInt(); val end = range.groupValues[2].toInt(); Reply(reply.bytes.copyOfRange(start, end + 1), reply.type, 206, mapOf("Content-Range" to "bytes $start-$end/${reply.bytes.size}"))
          } else reply
          val output = socket.getOutputStream(); output.write(("HTTP/1.1 ${sliced.status} Fixture\r\nContent-Type: ${sliced.type}\r\nContent-Length: ${sliced.bytes.size}\r\nConnection: close\r\n" + sliced.headers.filterKeys { it != "ignore-range" }.entries.joinToString("") { "${it.key}: ${it.value}\r\n" } + "\r\n").toByteArray(Charsets.US_ASCII)); output.flush()
          val prefixSize = if (sliced.block) minOf(sliced.bytes.size, ReelmFileCrypto.CHUNK + 1) else 0
          if (sliced.block) { output.write(sliced.bytes, 0, prefixSize); output.flush(); (sliced.entered ?: blocked).countDown(); (sliced.proceed ?: release).await(15, TimeUnit.SECONDS) }
          try { output.write(sliced.bytes, prefixSize, sliced.bytes.size - prefixSize); output.flush() } catch (_: IOException) {}
        } }
      } catch (_: IOException) { if (!server.isClosed) throw IllegalStateException("FIXTURE_SERVER") }
    }
    val fixturePolicy = object : ReelmDownloadPolicy {
      override fun url(value: String, baseURL: String?): String {
        check(value.length in 1..16384); val uri = if (baseURL == null) URI(value) else URI(baseURL).resolve(value)
        check(uri.scheme == "http" && uri.host == "127.0.0.1" && uri.port == server.localPort && uri.rawUserInfo == null && uri.rawFragment == null) { "DOWNLOAD_URL" }; return uri.toASCIIString()
      }
    }
    var free = Long.MAX_VALUE
    try {
      val crypto = ReelmFileCrypto(root, prefix); alias = crypto.alias; val store = ReelmDownloadStore(crypto)
      var queue = ReelmDownloadQueue(store, fixturePolicy) { free }
      fun detail(total: Int = 3, available: Int = total): JSONObject = JSONObject().put("id", "12").put("slug", "fixture").put("title", "Fixture")
        .put("platform", "DramaBox").put("cover", JSONObject.NULL).put("totalEpisodes", total).put("availableEpisodes", available).put("catalogueLanguage", "en")
        .put("audioEvidence", "unknown").put("languageQualification", "Fixture language unverified").put("isNew", false).put("isPopular", false).put("countWarning", JSONObject.NULL)
        .put("description", "Bounded fixture").put("episodesInDB", available).put("sourceDeclaredLanguage", "en").put("sourceDeclaredMode", JSONObject.NULL)
        .put("subtitleEvidence", "unverified").put("sampledEnglishEpisodes", JSONArray()).put("receipt", JSONObject.NULL).put("cached", false)
        .put("episodes", JSONArray((1..total).map { JSONObject().put("number", it).put("advertisedAvailable", it <= available) }))
      fun resolved(n: Int, body: String? = null, path: String = "/whole.mp4"): JSONObject = JSONObject()
        .put("sourceId", "dramadunyam").put("identity", JSONObject().put("seriesId", "12").put("slug", "fixture").put("platform", "DramaBox").put("episodeNumber", n))
        .put("title", "Fixture").put("episodeNumber", n).put("referenceHosts", JSONArray()).put("referenceCount", 1).put("expiresAt", System.currentTimeMillis() + 300000)
        .put("englishSubtitleCues", JSONArray()).put("subtitleStatus", "unavailable").put("cdnCredentialsAttached", false).put("languageQualification", "Fixture language unverified")
        .put("type", if (body == null) "mp4" else "hls").put("uri", if (body == null) base + path else JSONObject.NULL)
        .put("manifestBody", body ?: JSONObject.NULL).put("manifestSHA256", if (body == null) JSONObject.NULL else ReelmFileCrypto.digest(body.toByteArray(Charsets.UTF_8)))
        .put("transport", if (body == null) "direct-https-mp4" else if (body.contains("#EXT-X-STREAM-INF:")) "app-cache-master-direct-https-playlists-and-segments" else "app-cache-manifest-direct-https-segments")
      fun ticket(): String = requireNotNull(queue.claim())["ticket"] as String
      fun clear() { val ids = queue.list().map { it["id"] as String }; queue.edit(ids, "delete"); verify(queue.list().isEmpty()) }
      fun metadata(id: String): String { val lease = store.acquire(queue.packageId(id)); try { return queue.completedMetadata(lease.leaseId) } finally { store.release(lease.leaseId) } }
      fun failure(r: JSONObject, d: JSONObject = detail()) { queue.enqueue(d, listOf(r.getInt("episodeNumber"))); reject { queue.start(ticket(), d, r) }; verify(queue.list().single()["state"] != "complete"); clear() }
      val whole = ByteArray(600123) { (it % 251).toByte() }; responses["/whole.mp4"] = Reply(whole, "video/mp4")
      queue.enqueue(detail(3, 2), listOf(1, 3)); verify(queue.list().size == 2 && queue.list()[1]["errorCode"] == "EPISODE_NOT_ADVERTISED")
      val first = ticket(); verify(queue.claim() == null); queue.start(first, detail(3, 2), resolved(1))
      val complete = queue.list().first(); val completeId = complete["id"] as String; verify(complete["state"] == "complete" && complete["bytesReceived"] == whole.size.toLong() && complete["bytesStored"] as Long > whole.size)
      val lease = store.acquire(queue.packageId(completeId)); val input = store.open(Uri.parse(lease.rootUri), 0).input; verify(input.use { it.readBytes() }.contentEquals(whole)); store.release(lease.leaseId)
      val metadata = JSONObject(metadata(completeId)); verify(metadata.getString("subtitleStatus") == "unavailable" && metadata.getJSONArray("englishSubtitleCues").length() == 0 && metadata.getJSONObject("detail").isNull("receipt")); verify(!metadata.toString().contains(base)); reject { queue.completedMetadata(lease.leaseId) }
      // Task 6: production bridge maps public row ids; metadata stays on its owned live lease.
      val singleton=ReelmDownloadStore::class.java.getDeclaredField("processStore").apply{isAccessible=true};val previousStore=singleton.get(null);val adapter=ReelmVideoBridge()
      try {
        singleton.set(null,store)
        ReelmVideoBridge::class.java.getDeclaredField("downloadStore").apply{isAccessible=true}.set(adapter,store)
        ReelmVideoBridge::class.java.getDeclaredField("downloadQueue").apply{isAccessible=true}.set(adapter,queue)
        val opened=adapter.acquireOffline(context,completeId);verify(opened.downloadId==completeId)
        val read=ReelmVideoBridge::class.java.getDeclaredMethod("readOfflineMetadata",String::class.java)
        val value=JSONObject(read.invoke(adapter,opened.leaseId) as Map<*,*>);verify(value.getJSONObject("identity").getInt("episodeNumber")==1 && !value.has("rootResourceId"))
        val foreign=store.acquire(queue.packageId(completeId));reject{read.invoke(adapter,foreign.leaseId)};store.release(foreign.leaseId)
        adapter.releaseOffline(opened.leaseId);reject{read.invoke(adapter,opened.leaseId)};reject{store.liveLease(opened.leaseId)}
        val stats=ReelmDownloadStore::class.java.getDeclaredMethod("storageBytes");val counted=stats.invoke(store) as Long
        verify(counted==root.listFiles()!!.sumOf{it.length()} && counted>complete["bytesStored"] as Long)
      } finally {adapter.destroy();singleton.set(null,previousStore)}
      reject { queue.fail(first, "STALE") }; queue.pause(); queue.setActive(false); queue.setActive(true); verify(queue.list().first()["state"] == "complete")
      queue = ReelmDownloadQueue(store, fixturePolicy) { free }; verify(queue.list().first()["state"] == "complete"); clear()
      // Full series boundary and explicit overflow, not the unrelated 300-entry library cap.
      queue.enqueue(detail(5000), (1..5000).map { it }); verify(queue.list().size == 5000); verify(queue.list().last()["episodeNumber"] == 5000)
      reject { queue.enqueue(detail(5000), (1..5001).map { it }) }; clear()
      reject { ReelmReleaseDownloadPolicy.url(base + "/whole.mp4") }; reject { ReelmReleaseDownloadPolicy.url("https://cdn2.dramaflix.net.evil.invalid/x.ts") }
      reject { ReelmReleaseDownloadPolicy.url("https://cdn2.dramaflix.net:443/x.ts") }; reject { ReelmReleaseDownloadPolicy.url("https://x@cdn2.dramaflix.net/x.ts") }
      for (host in ReelmReleaseDownloadPolicy.hosts) verify(ReelmReleaseDownloadPolicy.url("https://$host/x") == "https://$host/x")
      val ts = "#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\n$base/one.ts\n#EXT-X-ENDLIST\n"
      responses["/one.ts"] = Reply(byteArrayOf(1,2,3,4), "video/mp2t"); queue.enqueue(detail(), listOf(1)); queue.start(ticket(), detail(), resolved(1, ts))
      val tsId = queue.list().single()["id"] as String; val tsLease = store.acquire(queue.packageId(tsId)); val tsRoot = store.open(Uri.parse(tsLease.rootUri),0).input.use { it.readBytes().toString(Charsets.UTF_8) }
      verify(!tsRoot.contains(base) && tsRoot.contains("#EXT-X-ENDLIST") && tsRoot.lines().any { it.matches(Regex("[0-9a-f]{32}")) }); store.release(tsLease.leaseId); clear()
      val master = "#EXTM3U\n#EXT-X-INDEPENDENT-SEGMENTS\n#EXT-X-MEDIA:TYPE=AUDIO,URI=\"$base/vr/fr/vt/f/audio.m3u8\",GROUP-ID=\"default-audio-group\",NAME=\"en-US\",DEFAULT=NO,AUTOSELECT=YES,CHANNELS=\"2\"\n#EXT-X-STREAM-INF:BANDWIDTH=1278625,AVERAGE-BANDWIDTH=787943,CODECS=\"avc1.640033,mp4a.40.2\",RESOLUTION=1080x1920,FRAME-RATE=25.000,VIDEO-RANGE=SDR,AUDIO=\"default-audio-group\",CLOSED-CAPTIONS=NONE\n$base/vr/fr/vt/f/video.m3u8\n"
      val child = "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:5,\nfragment.mp4\n#EXT-X-ENDLIST\n"
      for (name in listOf("video", "audio")) responses["/vr/fr/vt/f/$name.m3u8"] = Reply(child.toByteArray(), "audio/x-mpegurl")
      responses["/vr/fr/vt/f/init.mp4"] = Reply(byteArrayOf(4,5,6), "video/mp4"); responses["/vr/fr/vt/f/fragment.mp4"] = Reply(byteArrayOf(7,8,9,10), "video/mp4")
      val before = requests.size; queue.enqueue(detail(), listOf(1)); queue.start(ticket(), detail(), resolved(1, master)); verify(queue.list().single()["state"] == "complete")
      val audioLease = store.acquire(queue.packageId(queue.list().single()["id"] as String))
      val audioMaster = try { store.open(Uri.parse(audioLease.rootUri), 0).input.use { it.readBytes().toString(Charsets.UTF_8) } } finally { store.release(audioLease.leaseId) }
      verify(audioMaster.contains("VIDEO-RANGE=SDR") && audioMaster.contains("CLOSED-CAPTIONS=NONE") && !audioMaster.contains(base))
      verify(requests.drop(before).count { it["path"]?.endsWith("init.mp4") == true } == 2 && requests.drop(before).count { it["path"]?.endsWith("fragment.mp4") == true } == 2); clear()
      for (optional in listOf(master.replace(",VIDEO-RANGE=SDR", ""), master.replace(",CLOSED-CAPTIONS=NONE", ""), master.replace(",VIDEO-RANGE=SDR", "").replace(",CLOSED-CAPTIONS=NONE", ""))) {
        queue.enqueue(detail(), listOf(1)); queue.start(ticket(), detail(), resolved(1, optional)); verify(queue.list().single()["state"] == "complete"); clear()
      }
      for (bad in listOf(master.replace("VIDEO-RANGE=SDR", "VIDEO-RANGE=PQ"), master.replace("VIDEO-RANGE=SDR", "VIDEO-RANGE=HLG"), master.replace("VIDEO-RANGE=SDR", "VIDEO-RANGE=sdr"), master.replace("CLOSED-CAPTIONS=NONE", "CLOSED-CAPTIONS=\"captions\""), master.replace("CLOSED-CAPTIONS=NONE", "CLOSED-CAPTIONS=none"), master.replace("VIDEO-RANGE=SDR", "VIDEO-RANGE=SDR,NEW-FIELD=1"), master.replace("AUDIO=\"default-audio-group\"", "AUDIO=\"other-audio-group\""), master.replace("TYPE=AUDIO,", "TYPE=AUDIO,NEW-FIELD=1,"))) {
        val beforeBad = requests.size; queue.enqueue(detail(), listOf(1)); var code: String? = null
        try { queue.start(ticket(), detail(), resolved(1, bad)) } catch (failure: IllegalStateException) { code = failure.message }
        verify(code == "DOWNLOAD_AUDIO"); verify(requests.size == beforeBad && queue.list().single()["state"] == "failed" && queue.list().single()["bytesReceived"] == 0L && queue.list().single()["bytesStored"] == 0L); clear()
      }
      for (type in listOf("application/vnd.apple.mpegurl", "application/x-mpegurl")) {
        for (name in listOf("video", "audio")) responses["/vr/fr/vt/f/$name.m3u8"] = Reply(child.toByteArray(), type)
        queue.enqueue(detail(), listOf(1)); queue.start(ticket(), detail(), resolved(1, master)); verify(queue.list().single()["state"] == "complete"); clear()
      }
      for (type in listOf("text/plain", "application/octet-stream", "text/html", "audio/mpeg")) {
        responses["/vr/fr/vt/f/video.m3u8"] = Reply(child.toByteArray(), type); val beforeBad = requests.size; queue.enqueue(detail(), listOf(1)); var code: String? = null
        try { queue.start(ticket(), detail(), resolved(1, master)) } catch (failure: IllegalStateException) { code = failure.message }
        verify(code == "DOWNLOAD_CONTENT_TYPE"); verify(requests.drop(beforeBad).map { it["path"] } == listOf("/vr/fr/vt/f/video.m3u8") && queue.list().single()["state"] == "failed" && queue.list().single()["bytesReceived"] == 0L && queue.list().single()["bytesStored"] == 0L); clear()
      }
      val thousand = "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n" + (1..999).joinToString("") { "#EXTINF:1,\nfragment.mp4\n" } + "#EXT-X-ENDLIST\n"
      for (name in listOf("video", "audio")) responses["/vr/fr/vt/f/$name.m3u8"] = Reply(thousand.toByteArray(), "audio/x-mpegurl")
      queue.enqueue(detail(), listOf(1)); queue.start(ticket(), detail(), resolved(1,master).put("referenceCount",2000)); verify(queue.list().single()["state"] == "complete"); clear()
      responses["/vr/fr/vt/f/video.m3u8"] = Reply(thousand.replace("#EXT-X-ENDLIST", "#EXTINF:1,\nfragment.mp4\n#EXT-X-ENDLIST").toByteArray(), "audio/x-mpegurl"); failure(resolved(1,master))
      for (name in listOf("video", "audio")) responses["/vr/fr/vt/f/$name.m3u8"] = Reply(child.toByteArray(), "audio/x-mpegurl")
      responses["/vr/fr/vt/f/audio.m3u8"] = Reply(byteArrayOf(1), "text/html", 404); failure(resolved(1, master)); responses["/vr/fr/vt/f/audio.m3u8"] = Reply(child.toByteArray(), "audio/x-mpegurl")
      responses["/vr/fr/vt/f/init.mp4"] = Reply(byteArrayOf(1), "video/mp4", 500); failure(resolved(1, master)); responses["/vr/fr/vt/f/init.mp4"] = Reply(byteArrayOf(4,5,6), "video/mp4")
      for (bad in listOf("#EXTM3U\n#EXT-X-ENDLIST\n", ts.replace("#EXT-X-ENDLIST\n", ""), ts.replace("#EXTINF:10,", "#EXT-X-KEY:METHOD=AES-128,URI=\"$base/key\"\n#EXTINF:10,"), ts.replace("#EXTINF:10,", "#EXT-X-PART:URI=\"$base/one.ts\"\n#EXTINF:10,"))) failure(resolved(1, bad))
      failure(resolved(1, child.replace("init.mp4", "$base/vr/fr/vt/f/init.mp4").replace("fragment.mp4", "$base/vr/fr/vt/f/fragment.mp4").replace("#EXTINF:5,\n$base/vr/fr/vt/f/fragment.mp4\n", "")))
      failure(resolved(1).put("englishSubtitleCues", JSONArray().put(JSONObject().put("start", 3).put("end", 1).put("text", "invalid"))).put("subtitleStatus", "english-sidecar"))
      queue.enqueue(detail(), listOf(1)); queue.start(ticket(), detail(), resolved(1).put("subtitleStatus", "no-english-sidecar")); verify(JSONObject(metadata(queue.list().single()["id"] as String)).getString("subtitleStatus") == "no-english-sidecar"); clear()
      failure(resolved(1).put("expiresAt", System.currentTimeMillis() - 1)); failure(resolved(1).put("identity", JSONObject().put("seriesId", "99").put("slug", "fixture").put("platform", "DramaBox").put("episodeNumber", 1)))
      failure(resolved(1,path="/whole.mp4?pexp=1000000000")); reject { queue.enqueue(detail().put("isNew","false"),listOf(1)) }; reject { queue.enqueue(detail(),listOf(1.5)) }
      failure(resolved(1).put("englishSubtitleCues", JSONArray().put(JSONObject().put("start", "0").put("end", 1).put("text", "invalid"))).put("subtitleStatus", "english-sidecar"))
      failure(resolved(1,master.replace("1080x1920","2160x3840")))
      responses["/loop.mp4"] = Reply(byteArrayOf(1), "video/mp4", 302, mapOf("Location" to "/loop.mp4")); failure(resolved(1, path = "/loop.mp4"))
      responses["/unsafe.mp4"] = Reply(byteArrayOf(1), "video/mp4", 302, mapOf("Location" to "https://evil.invalid/whole.mp4")); failure(resolved(1, path = "/unsafe.mp4"))
      for(i in 0..3)responses["/hop$i.mp4"]=Reply(byteArrayOf(1),"video/mp4",302,mapOf("Location" to "/hop${i+1}.mp4")); failure(resolved(1,path="/hop0.mp4"))
      responses["/full206.mp4"] = Reply(byteArrayOf(1,2,3),"video/mp4",206,mapOf("Content-Range" to "bytes 0-2/3")); queue.enqueue(detail(),listOf(1)); queue.start(ticket(),detail(),resolved(1,path="/full206.mp4")); verify(queue.list().single()["state"] == "complete"); clear()
      responses["/part206.mp4"] = Reply(byteArrayOf(1,2,3),"video/mp4",206,mapOf("Content-Range" to "bytes 1-3/4")); failure(resolved(1,path="/part206.mp4"))
      val ranges = "#EXTM3U\n#EXTINF:1,\n#EXT-X-BYTERANGE:2@0\n$base/one.ts\n#EXTINF:1,\n#EXT-X-BYTERANGE:2\n$base/one.ts\n#EXT-X-ENDLIST\n"
      queue.enqueue(detail(), listOf(1)); queue.start(ticket(), detail(), resolved(1, ranges)); verify(queue.list().single()["bytesReceived"] == 4L); clear()
      verify(requests.any { it["range"] == "bytes=0-1" } && requests.any { it["range"] == "bytes=2-3" })
      failure(resolved(1, ranges.replace("2@0", "2"))); responses["/one.ts"] = Reply(byteArrayOf(1,2,3,4), "video/mp2t", headers = mapOf("ignore-range" to "1")); failure(resolved(1, ranges))
      responses["/one.ts"] = Reply(byteArrayOf(1,2), "video/mp2t", 206, mapOf("Content-Range" to "bytes 1-2/4")); failure(resolved(1, ranges))
      queue.enqueue(detail(), listOf(1)); val lowTicket = ticket(); free = ReelmFileCrypto.RESERVE; reject { queue.start(lowTicket, detail(), resolved(1)) }; free = Long.MAX_VALUE; clear()
      responses["/blocked.mp4"] = Reply(ByteArray(600000), "video/mp4", block = true); queue.enqueue(detail(), listOf(1)); val blockedTicket = ticket()
      val job = pool.submit { reject { queue.start(blockedTicket, detail(), resolved(1, path = "/blocked.mp4")) } }
      check(blocked.await(15,TimeUnit.SECONDS)); val partDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
      while (root.listFiles()!!.none { it.name.endsWith(".bin.part") && it.length() >= ReelmFileCrypto.CHUNK } && System.nanoTime() < partDeadline) Thread.sleep(10)
      verify(root.listFiles()!!.any { it.name.endsWith(".bin.part") && it.length() >= ReelmFileCrypto.CHUNK })
      val call = ReelmDownloadQueue::class.java.getDeclaredField("activeCall").let { it.isAccessible = true; it.get(queue) as Call }
      queue.setActive(false); verify(call.isCanceled()); job.get(10,TimeUnit.SECONDS); verify(queue.list().single()["state"] == "paused"); reject { queue.fail(blockedTicket, "LATE") }
      queue.setActive(true); val fresh = ticket(); verify(fresh != blockedTicket); queue.start(fresh, detail(), resolved(1)); verify(queue.list().single()["state"] == "complete"); clear()
      queue.enqueue(detail(), listOf(1)); val deleted = ticket(); queue.edit(queue.list().map { it["id"] as String }, "delete"); reject { queue.start(deleted, detail(), resolved(1)) }; reject { queue.fail(deleted, "LATE") }
      queue.enqueue(detail(), listOf(1)); val restarted = ticket()
      // Simulate the exact persisted in-flight package pointer before process re-open.
      val field = ReelmDownloadQueue::class.java.getDeclaredField("rows").apply { isAccessible = true }; val row = (field.get(queue) as List<*>).single() as JSONObject
      val partial = store.begin(); store.writeResource(partial, ByteArrayInputStream(byteArrayOf(1,2,3))); row.put("package", partial).put("state", "downloading")
      val save = ReelmDownloadQueue::class.java.getDeclaredMethod("save",String::class.java).apply { isAccessible = true }; save.invoke(queue,"save")
      queue = ReelmDownloadQueue(store, fixturePolicy) { free }; verify(queue.list().single()["state"] == "queued" && queue.list().single()["bytesStored"] == 0L); reject { queue.start(restarted, detail(), resolved(1)) }; verify(root.list()!!.none { it.startsWith("$partial.") }); clear()
      queue.enqueue(detail(), listOf(1)); queue.pause(); queue.setActive(false); queue.setActive(true); verify(queue.claim() == null); queue = ReelmDownloadQueue(store, fixturePolicy) { free }; verify(queue.claim() == null); queue.resume(); verify(queue.claim() != null); clear()
      val reviewFailures = mutableListOf<String>()
      fun reviewCase(name: String, body: () -> Unit) {
        try { body() } catch (failure: Exception) { reviewFailures.add(name + "_" + (failure.message ?: failure.javaClass.simpleName)) }
        finally { free = Long.MAX_VALUE; queue = ReelmDownloadQueue(store, fixturePolicy) { free }; clear() }
      }
      fun worker(): Boolean = ReelmDownloadQueue::class.java.getDeclaredField("worker").let { it.isAccessible = true; it.getBoolean(queue) }
      for (sibling in listOf("vr", "fr", "vt")) reviewCase("T5_I1_$sibling") {
        responses["/$sibling/init.mp4"] = Reply(byteArrayOf(1,2),"video/mp4"); responses["/$sibling/fragment.mp4"] = Reply(byteArrayOf(3,4),"video/mp4")
        val invalid = child.replace("init.mp4", "$base/$sibling/init.mp4").replace("fragment.mp4", "$base/$sibling/fragment.mp4")
        val count = requests.size; failure(resolved(1,invalid)); verify(requests.size == count)
      }
      reviewCase("T5_I2_RESOLVING") {
        queue.enqueue(detail(),listOf(1,2)); val t = ticket(); val activeId = queue.list()[0]["id"] as String
        queue.edit(listOf(activeId),"retry"); verify(queue.list()[0]["state"] == "resolving" && queue.claim() == null)
        queue.start(t,detail(),resolved(1)); queue.start(ticket(),detail(),resolved(2)); verify(queue.list().all { it["state"] == "complete" })
      }
      reviewCase("T5_I2_BLOCKED_MIXED") {
        val ready=CountDownLatch(1); val go=CountDownLatch(1); responses["/retry-block.mp4"]=Reply(ByteArray(600000),"video/mp4",block=true,entered=ready,proceed=go)
        queue.enqueue(detail(),listOf(1,2)); val failedTicket=ticket(); queue.fail(failedTicket,"SYNTHETIC_FAILURE"); val activeTicket=ticket()
        val failure=java.util.concurrent.atomic.AtomicReference<Throwable?>(); val job=pool.submit { try { queue.start(activeTicket,detail(),resolved(2,path="/retry-block.mp4")) } catch(e:Throwable){failure.set(e)} }
        try {
          check(ready.await(15,TimeUnit.SECONDS)); val call=ReelmDownloadQueue::class.java.getDeclaredField("activeCall").let{it.isAccessible=true;it.get(queue) as Call}
          queue.edit(queue.list().map{it["id"] as String},"retry"); verify(!call.isCanceled() && worker() && queue.claim()==null)
          go.countDown(); job.get(10,TimeUnit.SECONDS); verify(failure.get()==null); queue.start(ticket(),detail(),resolved(1)); verify(queue.list().all{it["state"]=="complete"})
        } finally { go.countDown(); job.get(15,TimeUnit.SECONDS) }
      }
      var fault: String? = null
      val inject: (String)->Unit = { stage -> if (fault == stage) { fault=null; throw IOException("INJECTED_"+stage.uppercase()) } }
      reviewCase("T5_I3_CLAIM") {
        queue=ReelmDownloadQueue(store,fixturePolicy,inject){free};queue.enqueue(detail(),listOf(1,2));fault="claim";reject{queue.claim()}
        verify(!worker() && queue.list()[0]["state"]=="queued");queue.start(ticket(),detail(),resolved(1));queue.start(ticket(),detail(),resolved(2));verify(queue.list().all{it["state"]=="complete"})
      }
      reviewCase("T5_I3_ADMISSION") {
        queue=ReelmDownloadQueue(store,fixturePolicy,inject){free};queue.enqueue(detail(),listOf(1,2));val t=ticket();fault="admission";reject{queue.start(t,detail(),resolved(1))}
        verify(!worker() && queue.list()[0]["state"]=="failed" && queue.list()[0]["bytesStored"]==0L);queue.start(ticket(),detail(),resolved(2));queue.edit(listOf(queue.list()[0]["id"] as String),"retry");queue.start(ticket(),detail(),resolved(1));verify(queue.list().all{it["state"]=="complete"})
      }
      reviewCase("T5_I3_CLEANUP") {
        queue=ReelmDownloadQueue(store,fixturePolicy,inject){free};queue.enqueue(detail(),listOf(1,2));val t=ticket();fault="cleanup";var original:Throwable?=null
        try{queue.start(t,detail(),resolved(1,path="/missing.mp4"))}catch(e:Throwable){original=e}
        verify(original?.message=="DOWNLOAD_HTTP_404" && original!!.suppressed.any{it.message=="INJECTED_CLEANUP"});verify(!worker() && queue.list()[0]["bytesStored"] as Long>0 && queue.list()[0]["state"]=="failed")
        queue.start(ticket(),detail(),resolved(2));queue.edit(listOf(queue.list()[0]["id"] as String),"retry");queue.start(ticket(),detail(),resolved(1));verify(queue.list().all{it["state"]=="complete"})
      }
      reviewCase("T5_I3_DELETING_CLEANUP") {
        queue=ReelmDownloadQueue(store,fixturePolicy,inject){free};val ready=CountDownLatch(1);val go=CountDownLatch(1);responses["/delete-block.mp4"]=Reply(ByteArray(600000),"video/mp4",block=true,entered=ready,proceed=go)
        queue.enqueue(detail(),listOf(1,2));val t=ticket();val id=queue.list()[0]["id"] as String;val job=pool.submit{reject{queue.start(t,detail(),resolved(1,path="/delete-block.mp4"))}}
        try{check(ready.await(15,TimeUnit.SECONDS));fault="cleanup";queue.edit(listOf(id),"delete");job.get(10,TimeUnit.SECONDS)
          verify(!worker()&&queue.list().first{it["id"]==id}["state"]=="deleting");queue.edit(listOf(id),"delete");verify(queue.list().none{it["id"]==id});queue.start(ticket(),detail(),resolved(2));verify(queue.list().single()["state"]=="complete")
        }finally{go.countDown();job.get(15,TimeUnit.SECONDS)}
      }
      reviewCase("T5_I3_COMPLETE_PERSISTENCE") {
        val completeFault:(String)->Unit={stage->if(stage=="save" && fault=="completion" && queue.list().any{it["state"]=="complete"}){fault=null;throw IOException("INJECTED_COMPLETION")}}
        queue=ReelmDownloadQueue(store,fixturePolicy,completeFault){free};queue.enqueue(detail(),listOf(1,2));val t=ticket();fault="completion";reject{queue.start(t,detail(),resolved(1))}
        verify(!worker() && queue.list()[0]["state"]=="failed" && queue.list()[0]["bytesStored"]==0L)
        queue=ReelmDownloadQueue(store,fixturePolicy){free};verify(queue.list()[0]["state"]=="failed");queue.start(ticket(),detail(),resolved(2))
        queue.edit(listOf(queue.list()[0]["id"] as String),"retry");queue.start(ticket(),detail(),resolved(1));verify(queue.list().all{it["state"]=="complete"})
      }
      reviewCase("T5_I3_RETRY_CLEANUP_FAILURE") {
        queue=ReelmDownloadQueue(store,fixturePolicy,inject){free};queue.enqueue(detail(),listOf(1,2));val t=ticket();fault="cleanup";reject{queue.start(t,detail(),resolved(1,path="/missing.mp4"))}
        val id=queue.list()[0]["id"] as String;val row=(ReelmDownloadQueue::class.java.getDeclaredField("rows").let{it.isAccessible=true;it.get(queue)} as List<*>)[0] as JSONObject
        val inventory=crypto.child(row.getString("package")+".inventory");val original=inventory.readBytes();val corrupt=original.copyOf();corrupt[corrupt.lastIndex]=(corrupt.last().toInt() xor 1).toByte();inventory.writeBytes(corrupt)
        try{reject{queue.edit(listOf(id),"retry")};verify(!worker() && queue.list()[0]["state"]=="failed" && queue.list()[0]["bytesStored"] as Long>0);queue.start(ticket(),detail(),resolved(2))}finally{inventory.writeBytes(original)}
        queue.edit(listOf(id),"retry");queue.start(ticket(),detail(),resolved(1));verify(queue.list().all{it["state"]=="complete"})
      }
      reviewCase("T5_I3_RETRY_WORKING_PAUSED") {
        val ready=CountDownLatch(1);val go=CountDownLatch(1);responses["/paused-retry.mp4"]=Reply(ByteArray(600000),"video/mp4",block=true,entered=ready,proceed=go)
        queue.enqueue(detail(),listOf(1,2));val t=ticket();val id=queue.list()[0]["id"] as String;val job=pool.submit{reject{queue.start(t,detail(),resolved(1,path="/paused-retry.mp4"))}}
        try{check(ready.await(15,TimeUnit.SECONDS));synchronized(store){queue.pause();queue.edit(listOf(id),"retry");verify(worker() && queue.list()[0]["state"]=="paused")}
          job.get(10,TimeUnit.SECONDS);queue.edit(listOf(id),"retry");queue.start(ticket(),detail(),resolved(1));verify(queue.list()[0]["state"]=="complete")
        }finally{go.countDown();job.get(15,TimeUnit.SECONDS)}
      }
      reviewCase("T5_I3_DESTROY_PERSISTENCE") {
        queue=ReelmDownloadQueue(store,fixturePolicy,inject){free};queue.enqueue(detail(),listOf(1));queue.start(ticket(),detail(),resolved(1));val lease=store.acquire(queue.packageId(queue.list()[0]["id"] as String));val bridge=ReelmVideoBridge()
        ReelmVideoBridge::class.java.getDeclaredField("downloadQueue").apply{isAccessible=true}.set(bridge,queue)
        ReelmVideoBridge::class.java.getDeclaredField("downloadStore").apply{isAccessible=true}.set(bridge,store)
        @Suppress("UNCHECKED_CAST") val owned=ReelmVideoBridge::class.java.getDeclaredField("ownedLeases").let{it.isAccessible=true;it.get(bridge) as MutableSet<String>};owned.add(lease.leaseId)
        try{fault="save";reject{bridge.destroy()};verify(ReelmVideoBridge::class.java.getDeclaredField("destroyed").let{it.isAccessible=true;it.getBoolean(bridge)} && bridge.io.coroutineContext[kotlinx.coroutines.Job]!!.isCancelled && owned.isEmpty());reject{store.liveLease(lease.leaseId)}}finally{bridge.destroy()}
      }
      reviewCase("T5_I4_NATIVE_VETO") {
        val bridge=ReelmVideoBridge();ReelmVideoBridge::class.java.getDeclaredField("downloadQueue").apply{isAccessible=true}.set(bridge,queue)
        // RED's previous Module hooks used setDownloadsActive; GREEN uses the independent native veto.
        val foreground=try{ReelmVideoBridge::class.java.getDeclaredMethod("setNativeDownloadsForeground",Boolean::class.javaPrimitiveType)}catch(_:NoSuchMethodException){ReelmVideoBridge::class.java.getDeclaredMethod("setDownloadsActive",Boolean::class.javaPrimitiveType)}
        try {
          val ready=CountDownLatch(1);val go=CountDownLatch(1);responses["/veto-block.mp4"]=Reply(ByteArray(600000),"video/mp4",block=true,entered=ready,proceed=go)
          queue.enqueue(detail(),listOf(1,2));bridge.setDownloadsActive(true);val t=ticket();val job=pool.submit{reject{queue.start(t,detail(),resolved(1,path="/veto-block.mp4"))}}
          try{check(ready.await(15,TimeUnit.SECONDS));val call=ReelmDownloadQueue::class.java.getDeclaredField("activeCall").let{it.isAccessible=true;it.get(queue) as Call}
            foreground.invoke(bridge,false);bridge.setDownloadsActive(true);verify(call.isCanceled()&&queue.claim()==null);job.get(10,TimeUnit.SECONDS);verify(queue.claim()==null)
          }finally{go.countDown();job.get(15,TimeUnit.SECONDS)}
          foreground.invoke(bridge,true);val user=queue.list()[0]["id"] as String;queue.edit(listOf(user),"cancel");bridge.setDownloadsActive(false);foreground.invoke(bridge,true);verify(queue.claim()==null);bridge.setDownloadsActive(true)
          val eligible=ticket();queue.start(eligible,detail(),resolved(2));verify(queue.list()[0]["state"]=="paused"&&queue.list()[1]["state"]=="complete")
        }finally{bridge.destroy()}
      }
      fun fixtureBridge(): ReelmVideoBridge = ReelmVideoBridge().also { bridge ->
        ReelmVideoBridge::class.java.getDeclaredField("downloadStore").apply{isAccessible=true}.set(bridge,store)
        ReelmVideoBridge::class.java.getDeclaredField("downloadQueue").apply{isAccessible=true}.set(bridge,queue)
      }
      fun mainGate(bridge: ReelmVideoBridge, value: Boolean): Pair<Boolean,java.util.concurrent.atomic.AtomicReference<Throwable?>> {
        val done=CountDownLatch(1);val error=java.util.concurrent.atomic.AtomicReference<Throwable?>()
        check(android.os.Handler(android.os.Looper.getMainLooper()).post{try{bridge.setNativeDownloadsForeground(value)}catch(failure:Throwable){error.set(failure)}finally{done.countDown()}})
        return done.await(3,TimeUnit.SECONDS) to error
      }
      fun settle(bridge: ReelmVideoBridge) { kotlinx.coroutines.runBlocking { kotlinx.coroutines.withTimeout(15000) { bridge.io.coroutineContext[kotlinx.coroutines.Job]!!.children.toList().forEach{it.join()} } } }
      reviewCase("T5_I5_STORE_MONITOR_MAIN_CANCEL") {
        val mainIO=java.util.concurrent.atomic.AtomicBoolean(false);queue=ReelmDownloadQueue(store,fixturePolicy,{if(android.os.Looper.myLooper()==android.os.Looper.getMainLooper())mainIO.set(true)}){free}
        queue.enqueue(detail(),listOf(1,2));val bridge=fixtureBridge();bridge.setDownloadsActive(true)
        val ready=CountDownLatch(1);val go=CountDownLatch(1);responses["/main-cancel.mp4"]=Reply(ByteArray(600000),"video/mp4",block=true,entered=ready,proceed=go)
        val t=ticket();val transfer=pool.submit{reject{queue.start(t,detail(),resolved(1,path="/main-cancel.mp4"))}};val held=CountDownLatch(1);val releaseMonitor=CountDownLatch(1)
        var holder:java.util.concurrent.Future<*>?=null;var prompt=false;var cancelled=false;var hookError:Throwable?=null
        try{check(ready.await(15,TimeUnit.SECONDS));val call=ReelmDownloadQueue::class.java.getDeclaredField("activeCall").let{it.isAccessible=true;it.get(queue) as Call}
          holder=pool.submit{synchronized(store){held.countDown();check(releaseMonitor.await(10,TimeUnit.SECONDS))}};check(held.await(5,TimeUnit.SECONDS))
          val result=mainGate(bridge,false);prompt=result.first;cancelled=call.isCanceled();hookError=result.second.get()
        }finally{releaseMonitor.countDown();holder?.get(15,TimeUnit.SECONDS);go.countDown();transfer.get(15,TimeUnit.SECONDS)}
        try{settle(bridge);verify(prompt && cancelled && hookError==null && !mainIO.get());bridge.setDownloadsActive(true);verify(queue.claim()==null)
          verify(mainGate(bridge,true).first);settle(bridge);val fresh=ticket();verify(fresh!=t);queue.start(fresh,detail(),resolved(1));queue.start(ticket(),detail(),resolved(2));verify(queue.list().all{it["state"]=="complete"})
        }finally{bridge.destroy()}
      }
      reviewCase("T5_I5_BRIDGE_INIT_MONITOR") {
        queue.enqueue(detail(),listOf(1));val bridge=fixtureBridge();val held=CountDownLatch(1);val releaseInit=CountDownLatch(1)
        val init=pool.submit{synchronized(bridge){held.countDown();check(releaseInit.await(10,TimeUnit.SECONDS));bridge.downloads(context,true)}}
        var prompt=false;var hookError:Throwable?=null
        try{check(held.await(5,TimeUnit.SECONDS));val result=mainGate(bridge,false);prompt=result.first;hookError=result.second.get()}finally{releaseInit.countDown();init.get(15,TimeUnit.SECONDS)}
        try{settle(bridge);verify(prompt && hookError==null);bridge.setDownloadsActive(true);verify(queue.claim()==null);verify(mainGate(bridge,true).first);settle(bridge);queue.start(ticket(),detail(),resolved(1));verify(queue.list().single()["state"]=="complete")}finally{bridge.destroy()}
      }
      reviewCase("T5_I5_COMMIT_VETO") {
        var once=true;var prompt=false;var hookError:Throwable?=null;lateinit var bridge:ReelmVideoBridge
        queue=ReelmDownloadQueue(store,fixturePolicy,{stage->if(once && stage=="save" && queue.list().any{it["state"]=="complete"}){once=false;val result=mainGate(bridge,false);prompt=result.first;hookError=result.second.get()}}){free}
        queue.enqueue(detail(),listOf(1));bridge=fixtureBridge();bridge.setDownloadsActive(true);var rejected=false;val old=ticket()
        try{try{queue.start(old,detail(),resolved(1))}catch(_:Exception){rejected=true};settle(bridge);verify(prompt && hookError==null && rejected && queue.list().single()["state"]!="complete")
          verify(mainGate(bridge,true).first);settle(bridge);val fresh=ticket();verify(fresh!=old);queue.start(fresh,detail(),resolved(1));verify(queue.list().single()["state"]=="complete")
        }finally{bridge.destroy()}
      }
      reviewCase("T5_I5_LATEST_STATE_FAILURE") {
        queue=ReelmDownloadQueue(store,fixturePolicy,inject){free};queue.enqueue(detail(4),listOf(1,2));val bridge=fixtureBridge();bridge.setDownloadsActive(true);queue.start(ticket(),detail(4),resolved(1));queue.pause();queue.enqueue(detail(4),listOf(3,4))
        val cancelled=queue.list().first{it["episodeNumber"]==3}["id"] as String;queue.edit(listOf(cancelled),"cancel");fault="save"
        try{val result=mainGate(bridge,false);settle(bridge);verify(result.first && result.second.get()==null)
          reject{bridge.downloads(context,true)};verify(mainGate(bridge,true).first && mainGate(bridge,false).first && mainGate(bridge,true).first);settle(bridge)
          verify(queue.list().first{it["episodeNumber"]==1}["state"]=="complete" && queue.list().first{it["episodeNumber"]==2}["state"]=="paused" && queue.list().first{it["episodeNumber"]==3}["state"]=="paused")
          queue.start(ticket(),detail(4),resolved(4));verify(queue.list().first{it["episodeNumber"]==4}["state"]=="complete" && !worker())
        }finally{bridge.destroy()}
      }
      for (rapid in listOf(false,true)) reviewCase(if(rapid) "T5_I6_RAPID_AUTO_RESUME" else "T5_I6_BACKGROUND_AUTO_RESUME") {
        queue.enqueue(detail(),listOf(1,2));val bridge=fixtureBridge();bridge.setDownloadsActive(true)
        val ready=CountDownLatch(1);val go=CountDownLatch(1);val path=if(rapid) "/epoch-rapid.mp4" else "/epoch-background.mp4";responses[path]=Reply(ByteArray(600000),"video/mp4",block=true,entered=ready,proceed=go)
        val old=ticket();val transfer=pool.submit{reject{queue.start(old,detail(),resolved(1,path=path))}};val held=CountDownLatch(1);val releaseBridge=CountDownLatch(1);var holder:java.util.concurrent.Future<*>?=null
        try{check(ready.await(15,TimeUnit.SECONDS));val call=ReelmDownloadQueue::class.java.getDeclaredField("activeCall").let{it.isAccessible=true;it.get(queue) as Call}
          holder=pool.submit{synchronized(bridge){held.countDown();check(releaseBridge.await(15,TimeUnit.SECONDS))}};check(held.await(5,TimeUnit.SECONDS))
          val background=mainGate(bridge,false);verify(background.first && background.second.get()==null && call.isCanceled())
          if(rapid){val foreground=mainGate(bridge,true);verify(foreground.first && foreground.second.get()==null)}
          transfer.get(10,TimeUnit.SECONDS);verify(!worker() && queue.list()[0]["state"]=="paused" && queue.list()[0]["errorCode"]==null && queue.list()[0]["bytesStored"]==0L)
          releaseBridge.countDown();holder.get(15,TimeUnit.SECONDS);settle(bridge)
          if(!rapid){verify(queue.claim()==null);verify(mainGate(bridge,true).first);settle(bridge)}
          val claim=requireNotNull(queue.claim());val fresh=claim["ticket"] as String;verify(claim["episodeNumber"]==1 && fresh!=old);queue.start(fresh,detail(),resolved(1));queue.start(ticket(),detail(),resolved(2));verify(queue.list().all{it["state"]=="complete"} && !worker())
        }finally{releaseBridge.countDown();holder?.get(15,TimeUnit.SECONDS);go.countDown();transfer.get(15,TimeUnit.SECONDS);bridge.destroy()}
      }
      check(reviewFailures.isEmpty()){ "DOWNLOAD_REVIEW_FAIL_"+reviewFailures.joinToString("_") }
      verify(requests.none { it.containsKey("cookie") || it.containsKey("authorization") })
      val installed = ReelmVideoBridge().let { bridge -> try { bridge.installed(context) } finally { bridge.destroy() } }
      return mapOf("nativeChecks" to "downloads PASS", "assertions" to assertions, "installed" to installed,
        "nativeHTTP" to mapOf("requests" to requests.size, "rangeRequests" to requests.count { it.containsKey("range") }, "cookieRequests" to 0, "actualCallCancelled" to true), "fullSeriesEntries" to 5000, "fixtureCleanup" to true)
    } finally {
      release.countDown(); server.close(); accept.cancel(true); pool.shutdownNow(); pool.awaitTermination(15,TimeUnit.SECONDS)
      alias?.let { check(it.startsWith(prefix)); keys.deleteEntry(it) }
      root.listFiles()?.forEach { file -> check(file.canonicalFile.parentFile == root.canonicalFile && file.isFile && (file.name.matches(Regex("(key-id|queue\\.sealed)(\\.(bak|new))?")) || file.name.matches(Regex("[0-9a-f]{32}\\.(inventory(\\.(bak|new))?|[0-9a-f]{32}\\.(bin(\\.part)?|meta(\\.(bak|new))?))")))); check(file.delete()) }
      check(root.delete())
    }
  }
  private fun crypto(context: Context): Map<String, Any> {
    val root = File(context.noBackupFilesDir, "reelm-task4-crypto-check")
    check(!root.exists()) { "TEST_DIRECTORY_ALREADY_EXISTS" }; check(root.mkdir())
    val prefix = context.packageName + ".reelm.e2e.task4."
    val keys = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val aliases = mutableSetOf<String>()
    var assertions = 0
    fun verify(condition: Boolean) { check(condition) { "CRYPTO_ASSERT_${assertions + 1}" }; assertions++ }
    fun reject(block: () -> Unit) {
      var rejected = false
      try { block() } catch (_: Exception) { rejected = true }
      verify(rejected)
    }
    val fixture = ByteArray(ReelmFileCrypto.CHUNK * 2 + 37) { ((it * 31) xor (it ushr 8)).toByte() }
    fun read(input: InputStream, count: Int): ByteArray = input.use {
      val bytes = ByteArray(count); var offset = 0
      while (offset < count) { val n = it.read(bytes, offset, count - offset); check(n > 0); offset += n }
      bytes
    }
    try {
      val crypto = ReelmFileCrypto(root, prefix).also { aliases.add(it.alias) }
      verify(crypto.key().encoded == null)
      verify(ReelmFileCrypto.digest(byteArrayOf()) == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
      verify(ReelmFileCrypto.digest("abc".toByteArray(Charsets.UTF_8)) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
      val allByteValues = ByteArray(256) { it.toByte() }
      val referenceHex = java.security.MessageDigest.getInstance("SHA-256").digest(allByteValues)
        .joinToString("") { "%02x".format(it.toInt() and 255) }
      verify(ReelmFileCrypto.digest(allByteValues) == referenceHex)

      val downloadId = ReelmFileCrypto.id(); val resourceId = ReelmFileCrypto.id()
      val payload = crypto.payload(downloadId, resourceId); val meta = crypto.metadata(downloadId, resourceId)
      val resource = crypto.write(ByteArrayInputStream(fixture), payload, downloadId, resourceId, fixture.size.toLong())
      val readBench = listOf(1024, ReelmFileCrypto.CHUNK).map { callerBytes ->
        val buffer = ByteArray(callerBytes); var total = 0L; var calls = 0
        val startedAt = System.nanoTime()
        try { crypto.open(resource, 0).use { input ->
          while (true) { val count = input.read(buffer); calls++; if (count < 0) break; total += count }
        } } finally { buffer.fill(0) }
        val elapsedMs = (System.nanoTime() - startedAt) / 1000000.0
        verify(total == fixture.size.toLong())
        mapOf("callerBytes" to callerBytes, "bytes" to total, "readCalls" to calls, "elapsedMs" to elapsedMs)
      }
      val stageBench = mutableListOf<Map<String, Any>>()
      fun stage(name: String, bytes: Int = 0, block: () -> Unit) {
        val startedAt = System.nanoTime(); repeat(64) { block() }
        stageBench.add(mapOf("stage" to name, "calls" to 64, "bytes" to bytes,
          "elapsedMs" to (System.nanoTime() - startedAt) / 1000000.0))
      }
      val sealedMetadata = meta.readBytes()
      stage("key") { crypto.key() }
      stage("child") { crypto.child(meta.name) }
      stage("requireId", downloadId.length) { ReelmFileCrypto.requireId(downloadId) }
      stage("digest", sealedMetadata.size) { ReelmFileCrypto.digest(sealedMetadata) }
      stage("unseal", sealedMetadata.size) { crypto.unseal(meta, downloadId, resourceId, 65536).fill(0) }
      stage("load", sealedMetadata.size) { crypto.load(downloadId, resourceId) }
      stage("ciphertextParse", sealedMetadata.size) {
        android.util.AtomicFile(meta).openRead().use { stream ->
          val envelope = java.io.DataInputStream(stream)
          check(envelope.readInt() == 0x52524d31 && envelope.readInt() == ReelmFileCrypto.VERSION)
          val nonce = ByteArray(12); envelope.readFully(nonce)
          val count = envelope.readInt(); check(count in 16..65552)
          val ciphertext = ByteArray(count); envelope.readFully(ciphertext); check(envelope.read() == -1)
          nonce.fill(0); ciphertext.fill(0)
        }
      }
      val envelope = java.io.DataInputStream(java.io.ByteArrayInputStream(sealedMetadata))
      envelope.readInt(); envelope.readInt()
      val metadataNonce = ByteArray(12); envelope.readFully(metadataNonce)
      val metadataCiphertext = ByteArray(envelope.readInt()); envelope.readFully(metadataCiphertext)
      val aadMethod = crypto.javaClass.declaredMethods.single { it.name == "aad" && it.parameterCount == 5 }.also { it.isAccessible = true }
      val metadataAAD = aadMethod.invoke(crypto, 0x52524d31, downloadId, resourceId, null, null) as ByteArray
      stage("currentKeyGCM", metadataCiphertext.size) {
        val cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(javax.crypto.Cipher.DECRYPT_MODE, crypto.key(), javax.crypto.spec.GCMParameterSpec(128, metadataNonce))
        cipher.updateAAD(metadataAAD); cipher.doFinal(metadataCiphertext).fill(0)
      }
      metadataNonce.fill(0); metadataCiphertext.fill(0); metadataAAD.fill(0)

      android.util.Log.i("ReelmReadBench", org.json.JSONObject(mapOf("readBench" to readBench, "stages" to stageBench)).toString())
      verify(resource.chunks.size == 3 && resource.plaintextLength == fixture.size.toLong())
      verify(resource.physicalSize == payload.length() + meta.length() && resource.physicalSize > fixture.size)
      verify(root.canonicalFile.parentFile == context.noBackupFilesDir.canonicalFile)
      verify(!payload.readBytes().contentEquals(fixture))
      for (offset in listOf(0, 262143, 262144, 262145, fixture.size - 2)) {
        val size = minOf(113, fixture.size - offset)
        verify(read(crypto.open(resource, offset.toLong()), size).contentEquals(fixture.copyOfRange(offset, offset + size)))
      }
      crypto.open(resource, fixture.size.toLong()).use { verify(it.read() == -1 && it.read(ByteArray(1), 0, 0) == 0) }
      reject { crypto.open(resource, fixture.size + 1L) }; reject { crypto.open(resource, -1) }
      val original = payload.readBytes(); val originalMeta = meta.readBytes()
      fun damage(at: Int) {
        val changed = original.clone(); changed[at] = (changed[at].toInt() xor 1).toByte(); payload.writeBytes(changed)
        val destination = ByteArray(17) { 99 }
        reject { crypto.open(resource, (at / (ReelmFileCrypto.CHUNK + 16)).toLong() * ReelmFileCrypto.CHUNK).use { it.read(destination) } }
        verify(destination.all { it == 99.toByte() }); payload.writeBytes(original)
      }
      damage(3); damage(ReelmFileCrypto.CHUNK + 4); damage(ReelmFileCrypto.CHUNK + 16 + 7)
      val swapped = original.clone(); val span = ReelmFileCrypto.CHUNK + 16
      original.copyInto(swapped, span, 0, span); original.copyInto(swapped, 0, span, span * 2)
      payload.writeBytes(swapped); reject { crypto.open(resource, 0).use { it.read() } }; payload.writeBytes(original)
      val otherId = ReelmFileCrypto.id()
      val other = crypto.write(ByteArrayInputStream(fixture), crypto.payload(downloadId, otherId), downloadId, otherId, fixture.size.toLong())
      val otherBytes = crypto.payload(downloadId, otherId).readBytes()
      crypto.payload(downloadId, otherId).writeBytes(original)
      reject { crypto.open(other, 0).use { it.read() } }; crypto.payload(downloadId, otherId).writeBytes(otherBytes)
      val corruptMeta = originalMeta.clone(); corruptMeta[corruptMeta.lastIndex] = (corruptMeta.last().toInt() xor 1).toByte()
      meta.writeBytes(corruptMeta); reject { crypto.open(resource, 0) }; meta.writeBytes(originalMeta)
      meta.writeBytes(crypto.metadata(downloadId, otherId).readBytes()); reject { crypto.open(resource, 0) }; meta.writeBytes(originalMeta)
      RandomAccessFile(payload, "rw").use { it.setLength(original.size - 1L) }; reject { crypto.open(resource, 0) }; payload.writeBytes(original)
      RandomAccessFile(payload, "rw").use { it.setLength(span * 2L) }; reject { crypto.open(resource, 0) }; payload.writeBytes(original)
      payload.appendBytes(byteArrayOf(0)); reject { crypto.open(resource, 0) }; payload.writeBytes(original)
      val failedId = ReelmFileCrypto.id()
      reject { crypto.write(object : InputStream() {
        var sent = false
        override fun read(): Int = throw IOException("fixture interruption")
        override fun read(b: ByteArray, off: Int, len: Int): Int { if (sent) throw IOException("fixture interruption"); sent = true; b[off] = 1; return 1 }
      }, crypto.payload(downloadId, failedId), downloadId, failedId, 200) }
      verify(!crypto.payload(downloadId, failedId).exists() && !crypto.metadata(downloadId, failedId).exists())
      reject { crypto.write(ByteArrayInputStream(fixture), crypto.payload(downloadId, failedId), downloadId, failedId, 1) }
      verify(!crypto.payload(downloadId, failedId).exists())
      val store = ReelmDownloadStore(crypto); val packageId = store.begin()
      reject { store.acquire(packageId) }
      val packageResource = store.writeResource(packageId, ByteArrayInputStream(fixture))
      val child = store.writeResource(packageId, ByteArrayInputStream(byteArrayOf(5, 6, 7)))
      store.complete(packageId, packageResource.resourceId, "video/mp4")
      val lease = store.acquire(packageId)
      reject { store.acquire("../outside") }
      for (uri in listOf("https://example.invalid/media", "reelm-offline://${lease.leaseId}/../key-id",
        "reelm-offline://${lease.leaseId}/%2e%2e", lease.rootUri + "?x=1", lease.rootUri + "#x", "reelm-offline://invalid/${resource.resourceId}")) {
        reject { store.open(Uri.parse(uri), 0) }
      }
      val events = mutableListOf<String>(); var facade: DataSource? = null
      val observer = object : TransferListener {
        fun validate(source: DataSource, spec: DataSpec, network: Boolean) {
          verify(!network && source.uri.toString() == "reelm-offline://redacted/resource" && spec.uri == source.uri)
          if (facade == null) facade = source else verify(facade === source)
        }
        override fun onTransferInitializing(s: DataSource, d: DataSpec, n: Boolean) { validate(s,d,n); events.add("initializing") }
        override fun onTransferStart(s: DataSource, d: DataSpec, n: Boolean) { validate(s,d,n); events.add("start") }
        override fun onBytesTransferred(s: DataSource, d: DataSpec, n: Boolean, b: Int) { validate(s,d,n); events.add("bytes") }
        override fun onTransferEnd(s: DataSource, d: DataSpec, n: Boolean) { validate(s,d,n); events.add("end") }
      }
      val source = ReelmEncryptedDataSource.Factory(store, observer).createDataSource()
      verify(source.open(DataSpec.Builder().setUri(lease.rootUri).setPosition(262143).setLength(3).build()) == 3L)
      val crossing = ByteArray(3); var got = 0
      while (got < 3) { got += source.read(crossing, got, 3 - got) }
      verify(crossing.contentEquals(fixture.copyOfRange(262143,262146)) && source.read(crossing,0,3) == C.RESULT_END_OF_INPUT)
      verify(source.uri.toString() == lease.rootUri); source.close(); source.close()
      verify(events.first() == "initializing" && events[1] == "start" && events.last() == "end" && events.count { it == "end" } == 1)
      val childSource = ReelmEncryptedDataSource.Factory(store).createDataSource()
      val childUri = Uri.parse(lease.rootUri).buildUpon().path("/${child.resourceId}").build()
      verify(childSource.open(DataSpec(childUri)) == 3L && childSource.read(ByteArray(3),0,3) == 3); childSource.close()
      // Real Media3 ProgressiveMediaPeriod supplies flags6 and the singleton ICY request header.
      val progressive = ReelmEncryptedDataSource.Factory(store).createDataSource()
      val media3Spec = DataSpec.Builder().setUri(lease.rootUri).setPosition(262143).setLength(3)
        .setFlags(6).setHttpRequestHeaders(mapOf("Icy-MetaData" to "1")).build()
      verify(progressive.open(media3Spec) == 3L)
      val progressiveBytes = ByteArray(3); var progressiveGot = 0
      while (progressiveGot < 3) progressiveGot += progressive.read(progressiveBytes, progressiveGot, 3 - progressiveGot)
      verify(progressiveBytes.contentEquals(fixture.copyOfRange(262143,262146)))
      verify(progressive.read(progressiveBytes, 0, 3) == C.RESULT_END_OF_INPUT); progressive.close()
      for (headers in listOf(mapOf("Authorization" to "fixture"), mapOf("Cookie" to "fixture"),
        mapOf("arbitrary" to "1"), mapOf("Icy-MetaData" to "2"), mapOf("icy-metadata" to "1"),
        mapOf("Icy-MetaData" to "1", "extra" to "1"))) {
        val invalid = ReelmEncryptedDataSource.Factory(store).createDataSource()
        reject { invalid.open(media3Spec.buildUpon().setHttpRequestHeaders(headers).build()) }; invalid.close()
      }
      for (invalidSpec in listOf(media3Spec.buildUpon().setHttpMethod(DataSpec.HTTP_METHOD_POST).build(),
        media3Spec.buildUpon().setHttpBody(byteArrayOf(1)).build())) {
        val invalid = ReelmEncryptedDataSource.Factory(store).createDataSource()
        reject { invalid.open(invalidSpec) }; invalid.close()
      }
      val released = store.open(Uri.parse(lease.rootUri),0).input
      store.release(lease.leaseId); store.release(lease.leaseId); reject { released.read() }; reject { store.open(Uri.parse(lease.rootUri),0) }
      val deleteLease = store.acquire(packageId); val deleting = store.open(Uri.parse(deleteLease.rootUri),0).input
      val pool = Executors.newFixedThreadPool(2)
      try {
        val gate = CountDownLatch(1)
        val reader = pool.submit { gate.await(); try { repeat(100) { deleting.read(ByteArray(100)) } } catch (_: IllegalStateException) {} }
        val deletion = pool.submit { gate.await(); store.delete(listOf(packageId)) }
        gate.countDown(); deletion.get(20,TimeUnit.SECONDS); reader.get(20,TimeUnit.SECONDS)
        reject { deleting.read() }; reject { store.acquire(packageId) }
        verify(!crypto.payload(packageId,packageResource.resourceId).exists() && !crypto.metadata(packageId,child.resourceId).exists())
      } finally { pool.shutdownNow() }
      val partial = store.begin(); val writing = Executors.newSingleThreadExecutor()
      val entered = CountDownLatch(1); val proceed = CountDownLatch(1)
      try {
        val job = writing.submit { reject { store.writeResource(partial, object : ByteArrayInputStream(fixture) {
          override fun read(b: ByteArray, off: Int, len: Int): Int { entered.countDown(); check(proceed.await(15,TimeUnit.SECONDS)); return super.read(b,off,len) }
        }) } }
        check(entered.await(15,TimeUnit.SECONDS)); store.delete(listOf(partial)); proceed.countDown(); job.get(20,TimeUnit.SECONDS)
        verify(root.list()!!.none { it.startsWith("$partial.") })
      } finally { proceed.countDown(); writing.shutdownNow() }
      // Independent terminal-failure regressions; finally is test cleanup, never product proof.
      val terminalFailures = mutableListOf<String>()
      fun terminalCase(label: String, block: () -> Unit) {
        try { block() } catch (_: Exception) { terminalFailures.add(label) }
      }
      fun closed(input: InputStream): Boolean = input.javaClass.getDeclaredField("closed").let { it.isAccessible = true; it.getBoolean(input) }
      fun unregistered(store: ReelmDownloadStore, leaseId: String): Boolean {
        val field = ReelmDownloadStore::class.java.getDeclaredField("readers").apply { isAccessible = true }
        val map = field.get(store) as Map<*, *>
        return (map[leaseId] as? Set<*>)?.isEmpty() != false
      }
      val auxiliaryRoot = File(context.noBackupFilesDir, "reelm-task4-aux-check")
      check(!auxiliaryRoot.exists() && auxiliaryRoot.mkdir())
      val outside = File(auxiliaryRoot, "outside.bin")
      val auxiliaryId = store.begin()
      val auxiliaryResource = store.writeResource(auxiliaryId, ByteArrayInputStream(byteArrayOf(1, 2, 3)))
      store.complete(auxiliaryId, auxiliaryResource.resourceId, "video/mp4")
      fun removeOwned(file: File) {
        try { Os.lstat(file.path); check(file.delete()) } catch (missing: ErrnoException) { if (missing.errno != OsConstants.ENOENT) throw missing }
      }
      fun auxiliaryCase(label: String, target: File, suffix: String, operation: () -> Unit) {
        val originalBytes = target.readBytes(); val link = File(target.path + suffix)
        check(!link.exists()); outside.writeBytes(originalBytes); Os.symlink(outside.path, link.path)
        try { terminalCase(label) {
          var rejected = false; try { operation() } catch (_: Exception) { rejected = true }
          verify(rejected)
          verify(outside.readBytes().contentEquals(originalBytes))
          verify(OsConstants.S_ISLNK(Os.lstat(link.path).st_mode) && target.readBytes().contentEquals(originalBytes))
        } } finally {
          removeOwned(link); removeOwned(File(target.path + ".new")); removeOwned(File(target.path + ".bak"))
          removeOwned(target); target.writeBytes(originalBytes); removeOwned(outside)
        }
      }
      try {
        val keyIdentity = File(root, "key-id")
        val inventory = crypto.child("$auxiliaryId.inventory")
        // Prepare authenticated replacements before planting any link: write cases exercise atomic directly.
        val rewrittenMeta = crypto.seal(crypto.unseal(meta, downloadId, resourceId, 65536), downloadId, resourceId)
        val rewrittenInventory = crypto.seal(crypto.unseal(inventory, auxiliaryId, cap = 1048576), auxiliaryId)
        for ((suffix, label) in listOf(".bak" to "BAK", ".new" to "NEW")) {
          auxiliaryCase("AUX_KEY_${label}_READ", keyIdentity, suffix) { ReelmFileCrypto(root, prefix) }
          auxiliaryCase("AUX_META_${label}_READ", meta, suffix) { crypto.open(resource, 0).close() }
          auxiliaryCase("AUX_INVENTORY_${label}_READ", inventory, suffix) { val got = store.acquire(auxiliaryId); store.release(got.leaseId) }
          auxiliaryCase("AUX_KEY_${label}_WRITE", keyIdentity, suffix) { crypto.atomic(keyIdentity, keyIdentity.readBytes()) }
          auxiliaryCase("AUX_META_${label}_WRITE", meta, suffix) { crypto.atomic(meta, rewrittenMeta) }
          auxiliaryCase("AUX_INVENTORY_${label}_WRITE", inventory, suffix) { crypto.atomic(inventory, rewrittenInventory) }
        }
      } finally { if (outside.exists()) removeOwned(outside); check(auxiliaryRoot.delete()) }
      val terminalId = store.begin()
      val terminalResource = store.writeResource(terminalId, ByteArrayInputStream(fixture))
      store.complete(terminalId, terminalResource.resourceId, "video/mp4")
      val terminalLease = store.acquire(terminalId)
      val terminalPayload = crypto.payload(terminalId, terminalResource.resourceId)
      val terminalOriginal = terminalPayload.readBytes()
      fun badTag(file: File, bytes: ByteArray) { val changed = bytes.clone(); changed[3] = (changed[3].toInt() xor 1).toByte(); file.writeBytes(changed) }
      terminalCase("CRYPTO_AUTH") {
        val input = crypto.open(resource, 0)
        try {
          badTag(payload, original); val sentinel = ByteArray(17) { 99 }
          reject { input.read(sentinel) }; verify(sentinel.all { it == 99.toByte() })
          payload.writeBytes(original); reject { input.read() }; verify(closed(input))
          val bytes = input.javaClass.getDeclaredField("bytes").let { it.isAccessible = true; it.get(input) as ByteArray }
          verify(bytes.all { it == 0.toByte() }); input.close(); input.close()
        } finally { payload.writeBytes(original); input.close() }
      }
      terminalCase("STORE_AUTH") {
        val input = store.open(Uri.parse(terminalLease.rootUri), 0).input
        try {
          badTag(terminalPayload, terminalOriginal); val sentinel = ByteArray(17) { 99 }
          reject { input.read(sentinel) }; verify(sentinel.all { it == 99.toByte() })
          verify(closed(input) && unregistered(store, terminalLease.leaseId))
          terminalPayload.writeBytes(terminalOriginal); reject { input.read() }; input.close(); input.close()
        } finally { terminalPayload.writeBytes(terminalOriginal); input.close() }
      }
      var transferEnds = 0
      fun terminalSource(): DataSource = ReelmEncryptedDataSource.Factory(store, object : TransferListener {
        override fun onTransferInitializing(s: DataSource, d: DataSpec, n: Boolean) {}
        override fun onTransferStart(s: DataSource, d: DataSpec, n: Boolean) {}
        override fun onBytesTransferred(s: DataSource, d: DataSpec, n: Boolean, b: Int) {}
        override fun onTransferEnd(s: DataSource, d: DataSpec, n: Boolean) { transferEnds++ }
      }).createDataSource()
      terminalCase("SOURCE_AUTH") {
        val input = terminalSource(); val before = transferEnds
        try {
          input.open(DataSpec(Uri.parse(terminalLease.rootUri))); badTag(terminalPayload, terminalOriginal)
          val sentinel = ByteArray(17) { 99 }; reject { input.read(sentinel, 0, sentinel.size) }
          verify(sentinel.all { it == 99.toByte() } && input.uri == null && transferEnds == before + 1 && unregistered(store, terminalLease.leaseId))
          terminalPayload.writeBytes(terminalOriginal); reject { input.read(sentinel, 0, 1) }; input.close(); input.close()
          verify(transferEnds == before + 1)
        } finally { terminalPayload.writeBytes(terminalOriginal); input.close() }
      }
      // Buffered plaintext never bypasses current sealed/path/physical binding guards.
      for (damage in listOf("META_HASH", "META_HASH_ZERO", "META_LENGTH", "PAYLOAD_LENGTH", "PAYLOAD_BAK", "META_NEW", "META_BAK")) terminalCase("BUFFER_$damage") {
        val input = crypto.open(resource, 0)
        val outside = File(root.parentFile, "reelm-task4-buffer-outside.bin")
        val link = when (damage) { "PAYLOAD_BAK" -> File(payload.path + ".bak"); "META_BAK" -> File(meta.path + ".bak"); else -> File(meta.path + ".new") }
        try {
          verify(input.read() == (fixture[0].toInt() and 255))
          when (damage) {
            "META_HASH", "META_HASH_ZERO" -> meta.writeBytes(corruptMeta)
            "META_BAK" -> link.writeBytes(corruptMeta)
            "META_LENGTH" -> meta.appendBytes(byteArrayOf(0))
            "PAYLOAD_LENGTH" -> RandomAccessFile(payload, "rw").use { it.setLength(original.size - 1L) }
            else -> { check(!outside.exists()); outside.writeBytes(byteArrayOf(1)); Os.symlink(outside.path, link.path) }
          }
          val sentinel = ByteArray(17) { 99 }; reject { if (damage == "META_HASH_ZERO") input.read(sentinel, 0, 0) else input.read(sentinel) }
          verify(sentinel.all { it == 99.toByte() } && closed(input))
          val bytes = input.javaClass.getDeclaredField("bytes").let { it.isAccessible = true; it.get(input) as ByteArray }
          verify(bytes.all { it == 0.toByte() }); reject { input.read() }
        } finally {
          if (damage in listOf("PAYLOAD_BAK", "META_NEW", "META_BAK")) { removeOwned(link); removeOwned(outside) }
          payload.writeBytes(original); meta.writeBytes(originalMeta); input.close()
        }
      }
      terminalCase("NEXT_CHUNK_TAG") {
        val input = crypto.open(resource, ReelmFileCrypto.CHUNK - 1L)
        try {
          verify(input.read() == (fixture[ReelmFileCrypto.CHUNK - 1].toInt() and 255))
          val changed = original.clone(); changed[span + 3] = (changed[span + 3].toInt() xor 1).toByte(); payload.writeBytes(changed)
          val sentinel = ByteArray(17) { 99 }; reject { input.read(sentinel) }
          verify(sentinel.all { it == 99.toByte() } && closed(input)); reject { input.read() }
          val bytes = input.javaClass.getDeclaredField("bytes").let { it.isAccessible = true; it.get(input) as ByteArray }
          verify(bytes.all { it == 0.toByte() })
        } finally { payload.writeBytes(original); input.close() }
      }
      fun remainingChunk(read: (ByteArray, Int, Int) -> Int) {
        val small = ByteArray(17); val rest = ByteArray(ReelmFileCrypto.CHUNK - 18)
        try {
          verify(read(small, 0, small.size) == small.size && small.contentEquals(fixture.copyOfRange(1, 18)))
          verify(read(rest, 0, rest.size) == rest.size && rest.contentEquals(fixture.copyOfRange(18, ReelmFileCrypto.CHUNK)))
        } finally { small.fill(0); rest.fill(0) }
      }
      val activeCrypto = crypto.open(resource, 0)
      val activeStore = store.open(Uri.parse(terminalLease.rootUri), 0).input
      val activeSource = terminalSource()
      // Prime separate readers before key deletion, then exercise replacement at the next chunk.
      val replacedCrypto = crypto.open(resource, 0)
      val replacedLease = store.acquire(terminalId)
      val replacedStore = store.open(Uri.parse(replacedLease.rootUri), 0).input
      val replacedSource = terminalSource()
      try {
        activeSource.open(DataSpec(Uri.parse(terminalLease.rootUri)))
        replacedSource.open(DataSpec(Uri.parse(replacedLease.rootUri)))
        verify(activeCrypto.read() == (fixture[0].toInt() and 255))
        verify(activeStore.read() == (fixture[0].toInt() and 255))
        verify(activeSource.read(ByteArray(1), 0, 1) == 1)
        verify(replacedCrypto.read() == (fixture[0].toInt() and 255))
        verify(replacedStore.read() == (fixture[0].toInt() and 255))
        verify(replacedSource.read(ByteArray(1), 0, 1) == 1)
        keys.deleteEntry(crypto.alias)
        terminalCase("ACTIVE_CRYPTO_KEY") {
          remainingChunk { b, off, len -> activeCrypto.read(b, off, len) }
          val sentinel = ByteArray(17) { 99 }; reject { activeCrypto.read(sentinel) }
          verify(sentinel.all { it == 99.toByte() } && closed(activeCrypto)); reject { activeCrypto.read() }
          val bytes = activeCrypto.javaClass.getDeclaredField("bytes").let { it.isAccessible = true; it.get(activeCrypto) as ByteArray }
          verify(bytes.all { it == 0.toByte() })
        }
        terminalCase("ACTIVE_STORE_KEY") {
          remainingChunk { b, off, len -> activeStore.read(b, off, len) }
          val sentinel = ByteArray(17) { 99 }; reject { activeStore.read(sentinel) }
          verify(sentinel.all { it == 99.toByte() } && closed(activeStore)); reject { activeStore.read() }
        }
        terminalCase("ACTIVE_SOURCE_KEY") {
          remainingChunk { b, off, len -> activeSource.read(b, off, len) }
          val sentinel = ByteArray(17) { 99 }; val before = transferEnds
          reject { activeSource.read(sentinel, 0, sentinel.size) }
          verify(sentinel.all { it == 99.toByte() } && activeSource.uri == null && transferEnds == before + 1)
          reject { activeSource.read(sentinel, 0, 1) }; verify(unregistered(store, terminalLease.leaseId))
        }
        reject { crypto.open(resource,0) }; reject { ReelmFileCrypto(root,prefix) }
        verify(!keys.containsAlias(crypto.alias))
        // Same identity with a different generated key authenticates neither next metadata nor chunks.
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(crypto.alias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
          .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        generator.generateKey(); reject { crypto.open(resource,0) }
        terminalCase("REPLACED_CRYPTO_KEY") {
          remainingChunk { b, off, len -> replacedCrypto.read(b, off, len) }
          val sentinel = ByteArray(17) { 99 }; reject { replacedCrypto.read(sentinel) }
          verify(sentinel.all { it == 99.toByte() } && closed(replacedCrypto)); reject { replacedCrypto.read() }
          val bytes = replacedCrypto.javaClass.getDeclaredField("bytes").let { it.isAccessible = true; it.get(replacedCrypto) as ByteArray }
          verify(bytes.all { it == 0.toByte() })
        }
        terminalCase("REPLACED_STORE_KEY") {
          remainingChunk { b, off, len -> replacedStore.read(b, off, len) }
          val sentinel = ByteArray(17) { 99 }; reject { replacedStore.read(sentinel) }
          verify(sentinel.all { it == 99.toByte() } && closed(replacedStore)); reject { replacedStore.read() }
        }
        terminalCase("REPLACED_SOURCE_KEY") {
          remainingChunk { b, off, len -> replacedSource.read(b, off, len) }
          val sentinel = ByteArray(17) { 99 }; val before = transferEnds
          reject { replacedSource.read(sentinel, 0, sentinel.size) }
          verify(sentinel.all { it == 99.toByte() } && replacedSource.uri == null && transferEnds == before + 1)
          reject { replacedSource.read(sentinel, 0, 1) }; verify(unregistered(store, replacedLease.leaseId))
        }
      } finally {
        activeCrypto.close(); activeStore.close(); activeSource.close()
        replacedCrypto.close(); replacedStore.close(); replacedSource.close()
        store.release(terminalLease.leaseId); store.release(replacedLease.leaseId)
      }
      check(terminalFailures.isEmpty()) { "CRYPTO_TERMINAL_FAIL_" + terminalFailures.joinToString("_") }
      // Minimum256KiB/s sample-sized private-reader throughput on the bound acceptance phone.
      verify((readBench.first()["elapsedMs"] as Double) < fixture.size / 262144.0 * 1000.0)
      val installed = ReelmVideoBridge().let { bridge -> try { bridge.installed(context) } finally { bridge.destroy() } }
      return mapOf("nativeChecks" to "crypto PASS", "assertions" to assertions, "installed" to installed,
        "storage" to "private noBackup fixture; ciphertext/metadata only; no export", "chunkSize" to ReelmFileCrypto.CHUNK,
        "seekOffsets" to listOf(262143,262144,262145,fixture.size), "readBench" to readBench, "fixtureCleanup" to true)
    } finally {
      fixture.fill(0)
      aliases.forEach { check(it.startsWith(prefix)); keys.deleteEntry(it) }
      root.listFiles()?.forEach { file ->
        check(file.canonicalFile.parentFile == root.canonicalFile && file.isFile &&
          (file.name.matches(Regex("key-id(\\.(bak|new))?")) || file.name.matches(Regex("[0-9a-f]{32}\\.(inventory(\\.(bak|new))?|[0-9a-f]{32}\\.(bin(\\.part)?|meta(\\.(bak|new))?))"))))
        check(file.delete())
      }
      check(root.delete())
    }
  }
}
