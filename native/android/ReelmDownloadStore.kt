package expo.modules.video

import android.content.Context
import android.net.Uri
import android.util.AtomicFile
import java.io.*
import java.net.URI
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import android.os.StatFs
import android.system.Os
import android.system.OsConstants
import android.system.ErrnoException
import okhttp3.Call
import okhttp3.CookieJar
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject

data class OfflineLease(val leaseId: String, val downloadId: String, val rootUri: String, val contentType: String)
internal data class ReelmInventory(val state: Int, val rootId: String, val contentType: String, val resources: List<ResourceRecord>)

/** Single process owner: lease checks, authenticated reads and deletion share the same monitor. */
class ReelmDownloadStore internal constructor(internal val crypto: ReelmFileCrypto) {
  companion object {
    const val EPISODE_MAX = 536870912L
    internal const val PARTIAL = 0
    internal const val COMPLETE = 1
    internal const val DELETING = 2
    private var processStore: ReelmDownloadStore? = null
    internal fun storageBytes(root: File): Long {
      val stat = try { Os.lstat(root.path) } catch (missing: ErrnoException) { if (missing.errno == OsConstants.ENOENT) return 0 else throw missing }
      check(OsConstants.S_ISDIR(stat.st_mode) && !OsConstants.S_ISLNK(stat.st_mode)) { "OFFLINE_ROOT" }
      return requireNotNull(root.listFiles()) { "OFFLINE_STORAGE" }.fold(0L) { total, file ->
        check(file.canonicalFile.parentFile == root.canonicalFile && OsConstants.S_ISREG(Os.lstat(file.path).st_mode)) { "OFFLINE_PATH" }
        Math.addExact(total, file.length()).also { check(it <= 9007199254740991L) { "OFFLINE_STORAGE" } }
      }
    }
    @Synchronized fun get(context: Context): ReelmDownloadStore {
      return processStore ?: ReelmDownloadStore(ReelmFileCrypto(File(context.applicationContext.noBackupFilesDir, "reelmDownloads"),
        context.packageName + ".reelm.downloads.")).also { processStore = it }
    }
  }
  private val leases = mutableMapOf<String, OfflineLease>()
  private val readers = mutableMapOf<String, MutableSet<InputStream>>()
  private val writers = mutableSetOf<String>()
  internal val downloads by lazy { ReelmDownloadQueue(this) }
  @Synchronized fun storageBytes(): Long = storageBytes(crypto.root)
  @Synchronized internal fun physicalBytes(id: String): Long {
    ReelmFileCrypto.requireId(id)
    return crypto.root.listFiles()?.filter { it.name.startsWith("$id.") }?.sumOf { crypto.child(it.name).length() } ?: 0
  }
  @Synchronized internal fun discardPartial(id: String) {
    delete(listOf(id))
    // Only the queue-owned opaque package's interrupted writer siblings, never another package/key.
    crypto.root.listFiles()?.filter { it.name.matches(Regex("$id\\.[0-9a-f]{32}\\.(bin(\\.part)?|meta(\\.(bak|new))?)")) }?.forEach {
      check(crypto.child(it.name).delete()) { "OFFLINE_DELETE" }
    }
  }
  @Synchronized internal fun liveLease(leaseId: String): OfflineLease {
    ReelmFileCrypto.requireId(leaseId); return leases[leaseId] ?: error("OFFLINE_LEASE_REVOKED")
  }
  @Synchronized internal fun readLeaseMetadata(leaseId: String, metadataResourceId: String): ByteArray {
    ReelmFileCrypto.requireId(metadataResourceId)
    val opened = open(Uri.parse("reelm-offline://$leaseId/$metadataResourceId"), 0)
    return opened.input.use { check(opened.available <= 524288) { "DOWNLOAD_METADATA_LIMIT" }; it.readBytes() }
  }
  private fun inventoryFile(id: String): File { ReelmFileCrypto.requireId(id); return crypto.child("$id.inventory") }
  private fun writeInventory(id: String, inventory: ReelmInventory) {
    check(inventory.resources.size <= 4096) { "OFFLINE_RESOURCE_COUNT" }
    val bytes = ByteArrayOutputStream().also { stream -> DataOutputStream(stream).use { out ->
      out.writeInt(inventory.state); out.writeUTF(inventory.rootId); out.writeUTF(inventory.contentType)
      out.writeInt(inventory.resources.size)
      inventory.resources.forEach { out.writeUTF(it.resourceId); out.writeLong(it.plaintextLength); out.writeLong(it.physicalSize); out.writeUTF(it.metadataHash) }
    } }.toByteArray()
    check(bytes.size <= 1048576) { "OFFLINE_INVENTORY_LIMIT" }
    crypto.atomic(inventoryFile(id), crypto.seal(bytes, id))
  }
  private fun loadInventory(id: String, verifyResources: Boolean = true): ReelmInventory {
    val body = crypto.unseal(inventoryFile(id), id, cap = 1048576)
    val input = DataInputStream(ByteArrayInputStream(body))
    val state = input.readInt(); check(state in PARTIAL..DELETING) { "OFFLINE_INVENTORY_STATE" }
    val root = input.readUTF(); val contentType = input.readUTF(); check(contentType.length <= 128) { "OFFLINE_CONTENT_TYPE" }
    if (root.isNotEmpty()) ReelmFileCrypto.requireId(root)
    val count = input.readInt(); check(count in 0..4096) { "OFFLINE_RESOURCE_COUNT" }
    val ids = mutableSetOf<String>()
    val records = (0 until count).map {
      val resourceId = input.readUTF(); check(ids.add(resourceId)) { "OFFLINE_DUPLICATE_RESOURCE" }
      val length = input.readLong(); val size = input.readLong(); val hash = input.readUTF()
      ReelmFileCrypto.requireId(resourceId)
      check(length in 0..ReelmFileCrypto.RESOURCE_MAX && size >= length && hash.matches(Regex("[0-9a-f]{64}"))) { "OFFLINE_RESOURCE_BINDING" }
      if (verifyResources) crypto.load(id, resourceId).also { record ->
        check(record.plaintextLength == length && record.physicalSize == size && record.metadataHash == hash) { "OFFLINE_RESOURCE_BINDING" }
      } else ResourceRecord(ReelmFileCrypto.VERSION, id, resourceId, length, size, emptyList(), hash)
    }
    check(input.read() == -1 && (state != COMPLETE || records.any { it.resourceId == root })) { "OFFLINE_INVENTORY" }
    check(records.sumOf { it.physicalSize } + inventoryFile(id).length() <= EPISODE_MAX) { "OFFLINE_EPISODE_LIMIT" }
    return ReelmInventory(state, root, contentType, records)
  }
  @Synchronized fun begin(): String {
    val id = ReelmFileCrypto.id(); check(!inventoryFile(id).exists())
    writeInventory(id, ReelmInventory(PARTIAL, "", "", emptyList())); return id
  }
  fun writeResource(downloadId: String, input: InputStream, maxBytes: Long = ReelmFileCrypto.RESOURCE_MAX): ResourceRecord {
    val resourceId = synchronized(this) {
      check(loadInventory(downloadId).state == PARTIAL && writers.add(downloadId)) { "OFFLINE_WRITE_STATE" }
      ReelmFileCrypto.id()
    }
    try {
      // Network input never holds the process read/delete monitor.
      return crypto.writeGuarded(input, crypto.payload(downloadId, resourceId), downloadId, resourceId, maxBytes) { publish ->
        synchronized(this) {
          val inventory = loadInventory(downloadId)
          check(inventory.state == PARTIAL && downloadId in writers) { "OFFLINE_WRITE_REVOKED" }
          val record = publish()
          check(inventory.resources.sumOf { it.physicalSize } + record.physicalSize + 1048600 <= EPISODE_MAX) { "OFFLINE_EPISODE_LIMIT" }
          writeInventory(downloadId, inventory.copy(resources = inventory.resources + record)); record
        }
      }
    } catch (failure: Throwable) {
      synchronized(this) { removeResource(downloadId, resourceId) }
      throw failure
    } finally { synchronized(this) { writers.remove(downloadId) } }
  }
  @Synchronized fun complete(downloadId: String, rootResourceId: String, contentType: String) {
    check(contentType.length <= 128 && downloadId !in writers) { "OFFLINE_COMPLETE_ARGUMENT" }
    val inventory = loadInventory(downloadId)
    check(inventory.state == PARTIAL && inventory.resources.any { it.resourceId == rootResourceId }) { "OFFLINE_COMPLETE_STATE" }
    inventory.resources.forEach { record -> crypto.open(record, 0).use { input ->
      val buffer = ByteArray(ReelmFileCrypto.CHUNK)
      try { while (input.read(buffer) >= 0) {} } finally { buffer.fill(0) }
    } }
    writeInventory(downloadId, inventory.copy(state = COMPLETE, rootId = rootResourceId, contentType = contentType))
  }
  @Synchronized fun acquire(downloadId: String): OfflineLease {
    val inventory = loadInventory(downloadId); check(inventory.state == COMPLETE) { "OFFLINE_NOT_COMPLETE" }
    val id = ReelmFileCrypto.id()
    return OfflineLease(id, downloadId, "reelm-offline://$id/${inventory.rootId}", inventory.contentType).also { leases[id] = it }
  }
  @Synchronized fun release(leaseId: String) {
    ReelmFileCrypto.requireId(leaseId); leases.remove(leaseId)
    readers.remove(leaseId)?.toList()?.forEach { it.close() }
  }
  internal data class Opened(val input: InputStream, val available: Long)
  @Synchronized internal fun open(uri: Uri, offset: Long): Opened {
    require(uri.scheme == "reelm-offline" && uri.query == null && uri.fragment == null && uri.port == -1 && uri.userInfo == null) { "OFFLINE_URI" }
    val leaseId = requireNotNull(uri.host); ReelmFileCrypto.requireId(leaseId)
    val path = requireNotNull(uri.encodedPath); require(path.matches(Regex("/[0-9a-f]{32}"))) { "OFFLINE_URI" }
    val resourceId = path.substring(1)
    val lease = leases[leaseId] ?: error("OFFLINE_LEASE_REVOKED")
    val inventory = loadInventory(lease.downloadId); check(inventory.state == COMPLETE) { "OFFLINE_NOT_COMPLETE" }
    val record = inventory.resources.singleOrNull { it.resourceId == resourceId } ?: error("OFFLINE_RESOURCE_MISSING")
    val delegate = crypto.open(record, offset)
    val reader = object : InputStream() {
      var closed = false
      private fun <T> guardedRead(block: () -> T): T = synchronized(this@ReelmDownloadStore) {
        try { check(!closed && leases[leaseId] === lease) { "OFFLINE_LEASE_REVOKED" }; block() }
        catch (failure: Throwable) {
          try { close() } catch (cleanup: Throwable) { if (cleanup !== failure) failure.addSuppressed(cleanup) }
          throw failure
        }
      }
      override fun read(): Int = guardedRead { delegate.read() }
      override fun read(bytes: ByteArray, off: Int, len: Int): Int = guardedRead { delegate.read(bytes, off, len) }
      override fun close() = synchronized(this@ReelmDownloadStore) {
        if (!closed) {
          closed = true
          try { delegate.close() } finally { readers[leaseId]?.remove(this) }
        }; Unit
      }
    }
    readers.getOrPut(leaseId) { mutableSetOf() }.add(reader)
    return Opened(reader, record.plaintextLength - offset)
  }
  private fun removeResource(downloadId: String, resourceId: String) {
    val payload = crypto.payload(downloadId, resourceId)
    if (payload.exists()) check(payload.delete()) { "OFFLINE_DELETE" }
    val part = crypto.child(payload.name + ".part"); if (part.exists()) check(part.delete()) { "OFFLINE_DELETE" }
    AtomicFile(crypto.metadata(downloadId, resourceId)).delete()
  }
  @Synchronized fun delete(downloadIds: List<String>) {
    downloadIds.forEach { ReelmFileCrypto.requireId(it) }
    downloadIds.distinct().forEach { id ->
      // Revoke before authenticating/removing files, including damaged packages.
      writers.remove(id); leases.values.filter { it.downloadId == id }.map { it.leaseId }.forEach { release(it) }
      val file = inventoryFile(id)
      if (file.exists() || File(file.path + ".bak").exists()) {
        val inventory = loadInventory(id, verifyResources = false)
        writeInventory(id, inventory.copy(state = DELETING))
        inventory.resources.forEach { removeResource(id, it.resourceId) }
        AtomicFile(file).delete()
      }
    }
  }
}

/** Fixed release policy; fixture implementations live only in the separately compiled native checks. */
internal interface ReelmDownloadPolicy { fun url(value: String, base: String? = null): String }
internal object ReelmReleaseDownloadPolicy : ReelmDownloadPolicy {
  val hosts = setOf("cdn2.dramaflix.net", "cdn.dramaflix.net", "dramadunyam.com", "v-mps.crazymaplestudios.com",
    "ns-aws-cdn.netshort.com", "hwztakavideoto.dramaboxdb.com", "v45e-eu.tiktokcdn.com", "v77e.tiktokcdn.com", "v19e.tiktokcdn.com", "v16me.tiktokcdn.com")
  override fun url(value: String, base: String?): String {
    check(value.length in 1..16384) { "DOWNLOAD_URL" }
    val uri = if (base == null) URI(value) else URI(base).resolve(value)
    check(uri.scheme == "https" && uri.host in hosts && uri.rawUserInfo == null && uri.port == -1 && uri.rawFragment == null) { "DOWNLOAD_URL" }
    return uri.toASCIIString().also { check(it.length <= 16384) { "DOWNLOAD_URL" } }
  }
}

internal data class ReelmRemote(val url: String, val offset: Long? = null, val length: Long? = null, val kind: String)
internal data class ReelmPlaylist(val lines: List<String>, val references: Map<Int, ReelmRemote>)

internal class ReelmDownloadQueue(private val store: ReelmDownloadStore,
  private val policy: ReelmDownloadPolicy = ReelmReleaseDownloadPolicy,
  private val beforeIO: (String) -> Unit = {},
  private val freeBytes: () -> Long = { StatFs(store.crypto.root.path).availableBytes }) {
  companion object {
    const val QUEUE_MAX = 8388608
    const val ROW_MAX = 20000
    const val PLAYLIST_MAX = 131072
    const val CUES_MAX = 262144
    private const val QUEUE_ID = "00000000000000000000000000000001"
    private const val UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36"
  }
  private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).cookieJar(CookieJar.NO_COOKIES)
    .callTimeout(60, java.util.concurrent.TimeUnit.SECONDS).build()
  private val rows = mutableListOf<JSONObject>()
  private val cards = linkedMapOf<String, JSONObject>()
  private var active = true
  private var ticket: String? = null
  private var ticketRow: JSONObject? = null
  private var ticketForeground = 0L
  @Volatile private var foregroundEpoch: () -> Long = { 0L }
  private var worker = false
  private var workingRow: JSONObject? = null
  @Volatile private var activeCall: Call? = null
  internal fun bindForeground(epoch: () -> Long) { foregroundEpoch = epoch }
  internal fun cancelForegroundCall() { activeCall?.cancel() }
  internal fun reconcileActive(enabled: () -> Boolean) = synchronized(store) { setActive(enabled()) }
  private val queueFile get() = store.crypto.child("queue.sealed")
  init { synchronized(store) {
    if (queueFile.exists() || File(queueFile.path + ".bak").exists()) {
      val body = JSONObject(decode(store.crypto.unseal(queueFile, QUEUE_ID, cap = QUEUE_MAX)))
      check(body.getInt("version") == 1) { "DOWNLOAD_QUEUE_VERSION" }
      val inputCards = body.getJSONObject("cards")
      inputCards.keys().forEach { key -> val c = card(inputCards.getJSONObject(key)); check(key == cardKey(c)); cards[key] = c }
      val inputRows = body.getJSONArray("rows"); check(inputRows.length() <= ROW_MAX) { "DOWNLOAD_QUEUE_LIMIT" }
      val seen = mutableSetOf<String>()
      for (i in 0 until inputRows.length()) {
        val row = inputRows.getJSONObject(i); ReelmFileCrypto.requireId(row.getString("id")); check(seen.add(row.getString("id")))
        check(cards.containsKey(row.getString("card"))); ordinal(row.get("episodeNumber"))
        check(row.getString("state") in setOf("queued", "resolving", "downloading", "paused", "complete", "failed", "unreadable", "deleting"))
        check(row.getString("intent") in setOf("eligible", "user", "cancelled"))
        if (row.getString("state") !in setOf("complete", "unreadable")) {
          if (!row.isNull("package")) store.discardPartial(row.getString("package"))
          row.put("package", JSONObject.NULL).put("metadata", JSONObject.NULL).put("bytesStored", 0).put("bytesTotal", JSONObject.NULL)
          if (row.getString("state") in setOf("resolving", "downloading") || row.getString("state") == "paused" && row.getString("intent") == "eligible") row.put("state", "queued")
          if (row.getString("state") == "deleting") continue
        }
        rows.add(row)
      }
      save()
    }
  } }
  private fun decode(bytes: ByteArray): String = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
  private fun integer(value: Any, max: Long, min: Long = 0): Long {
    check(value is Number && value.toDouble().isFinite() && value.toDouble() == value.toLong().toDouble() && value.toLong() in min..max) { "DOWNLOAD_NUMBER" }
    return value.toLong()
  }
  private fun ordinal(value: Any) = integer(value, 5000, 1).toInt()
  private fun boolean(input: JSONObject, key: String): Boolean {
    val value = input.get(key); check(value is Boolean) { "DOWNLOAD_BOOLEAN" }; return value
  }
  private fun text(value: Any?, max: Int, empty: Boolean = false): String {
    check(value is String && value.length <= max && (empty || value.isNotBlank()) && value.none { it < ' ' || it == '\u007f' }) { "DOWNLOAD_TEXT" }
    return value
  }
  private fun cover(value: Any?): Any {
    if (value == null || value == JSONObject.NULL) return JSONObject.NULL
    val s = text(value, 1024); val u = URI(s)
    check(u.scheme == "https" && u.rawUserInfo == null && u.port == -1 && u.rawFragment == null && u.rawQuery == null &&
      (u.host == "dramadunyam.com" && u.path.matches(Regex("/(covers|logos)/[A-Za-z0-9_.-]+\\.(webp|jpg|jpeg|png|svg)", RegexOption.IGNORE_CASE)) ||
      u.host == "dramaflix.net" && u.path.matches(Regex("/dfl-media/(img/covers/[a-f0-9]{16}/480\\.webp|logos/[A-Za-z0-9_.-]+\\.(webp|png|svg))")))) { "DOWNLOAD_COVER" }
    return s
  }
  private fun card(input: JSONObject): JSONObject {
    val id = text(input.get("id"), 10); check(id.matches(Regex("[0-9]{1,10}")) && id.toLong() > 0) { "DOWNLOAD_IDENTITY" }
    val slug = text(input.get("slug"), 240); check(slug.matches(Regex("[A-Za-z0-9][A-Za-z0-9_-]*"))) { "DOWNLOAD_IDENTITY" }
    val platform = text(input.get("platform"), 80); check(platform.none { it in "/?#\\" }) { "DOWNLOAD_IDENTITY" }
    check(input.getString("catalogueLanguage") == "en") { "DOWNLOAD_LANGUAGE" }
    val audio = input.getString("audioEvidence"); check(audio in setOf("sampled-english", "dubbed-label-unverified", "unknown", "sampled-non-english"))
    return JSONObject().put("id", id).put("slug", slug).put("title", text(input.get("title"), 240)).put("platform", platform)
      .put("cover", cover(input.opt("cover"))).put("totalEpisodes", integer(input.get("totalEpisodes"), 5000))
      .put("availableEpisodes", integer(input.get("availableEpisodes"), 5000)).put("catalogueLanguage", "en").put("audioEvidence", audio)
      .put("languageQualification", text(input.get("languageQualification"), 2000)).put("isNew", boolean(input,"isNew"))
      .put("isPopular", boolean(input,"isPopular")).put("countWarning", if (input.isNull("countWarning")) JSONObject.NULL else text(input.get("countWarning"), 2000))
      .also { check(it.toString().toByteArray(Charsets.UTF_8).size <= 8192) { "DOWNLOAD_CARD_LIMIT" } }
  }
  private fun detail(input: JSONObject): JSONObject {
    val result = card(input); val total = result.getInt("totalEpisodes"); val available = result.getInt("availableEpisodes")
    val db = integer(input.get("episodesInDB"), 5000).toInt(); check(available <= total && db <= total) { "DOWNLOAD_DETAIL" }
    check(input.getString("sourceDeclaredLanguage") == "en") { "DOWNLOAD_LANGUAGE" }
    val description = input.getString("description"); check(description.length <= 12000 && description.none { it == '\u0000' }) { "DOWNLOAD_DETAIL" }
    val episodes = input.getJSONArray("episodes"); check(episodes.length() == total) { "DOWNLOAD_DETAIL" }
    for (i in 0 until total) { val e = episodes.getJSONObject(i); check(ordinal(e.get("number")) == i + 1 && boolean(e,"advertisedAvailable") == (i + 1 <= minOf(available, db))) { "DOWNLOAD_DETAIL" } }
    check(input.getString("subtitleEvidence") in setOf("prior-sampled-english-captions", "unverified")) { "DOWNLOAD_DETAIL" }
    val sampled = input.getJSONArray("sampledEnglishEpisodes"); check(sampled.length() <= 5000); for (i in 0 until sampled.length()) ordinal(sampled.get(i))
    return result.put("description", description).put("episodesInDB", db).put("sourceDeclaredLanguage", "en")
      .put("sourceDeclaredMode", if (input.isNull("sourceDeclaredMode")) JSONObject.NULL else text(input.get("sourceDeclaredMode"), 160, true))
      .put("subtitleEvidence", text(input.get("subtitleEvidence"), 40)).put("sampledEnglishEpisodes", JSONArray(input.getJSONArray("sampledEnglishEpisodes").toString()))
      .put("receipt", JSONObject.NULL).put("cached", true)
  }
  private fun cardKey(card: JSONObject) = card.getString("id") + ":" + card.getString("slug") + ":" + card.getString("platform")
  private fun serialized() = JSONObject().put("version", 1).put("cards", JSONObject(cards as Map<*, *>)).put("rows", JSONArray(rows)).toString().toByteArray(Charsets.UTF_8)
  private fun save(stage: String = "save") {
    beforeIO(stage)
    val used = rows.map { it.getString("card") }.toSet(); cards.keys.retainAll(used)
    val bytes = serialized(); check(rows.size <= ROW_MAX && bytes.size <= QUEUE_MAX) { "DOWNLOAD_QUEUE_LIMIT" }
    check(freeBytes() >= ReelmFileCrypto.RESERVE + bytes.size + 40) { "OFFLINE_SPACE" }
    store.crypto.atomic(queueFile, store.crypto.seal(bytes, QUEUE_ID))
  }
  fun enqueue(input: JSONObject, ordinals: List<Any>) = synchronized(store) {
    check(ordinals.size <= 5000) { "DOWNLOAD_QUEUE_LIMIT" }; val d = detail(input); val c = card(d); val key = cardKey(c)
    val selected = ordinals.map { ordinal(it) }.distinct(); check(selected.all { it <= c.getInt("totalEpisodes") }) { "DOWNLOAD_EPISODE" }
    val upper = minOf(c.getInt("availableEpisodes"), d.getInt("episodesInDB"))
    val additions = selected.filter { n -> rows.none { it.getString("card") == key && it.getInt("episodeNumber") == n } }.map { n ->
      JSONObject().put("id", ReelmFileCrypto.id()).put("card", key).put("episodeNumber", n).put("state", if (n <= upper) "queued" else "failed")
        .put("intent", "eligible").put("bytesReceived", 0).put("bytesStored", 0).put("bytesTotal", JSONObject.NULL)
        .put("errorCode", if (n <= upper) JSONObject.NULL else "EPISODE_NOT_ADVERTISED").put("package", JSONObject.NULL).put("metadata", JSONObject.NULL)
    }
    check(rows.size + additions.size <= ROW_MAX) { "DOWNLOAD_QUEUE_LIMIT" }
    val old = cards[key]; cards[key] = c; rows.addAll(additions)
    try { save() } catch (failure: Throwable) { rows.removeAll(additions.toSet()); if (old == null) cards.remove(key) else cards[key] = old; throw failure }; Unit
  }
  fun list(): List<Map<String, Any?>> = synchronized(store) {
    rows.map { row ->
      if (!row.isNull("package")) row.put("bytesStored", store.physicalBytes(row.getString("package")))
      if (row.getString("state") == "complete") try { val lease = store.acquire(row.getString("package")); store.release(lease.leaseId) }
      catch (_: Exception) { row.put("state", "unreadable").put("errorCode", "OFFLINE_UNREADABLE") }
      mapOf("id" to row.getString("id"), "card" to jsonMap(cards.getValue(row.getString("card"))), "episodeNumber" to row.getInt("episodeNumber"),
        "state" to row.getString("state"), "bytesReceived" to row.getLong("bytesReceived"), "bytesStored" to row.getLong("bytesStored"),
        "bytesTotal" to if (row.isNull("bytesTotal")) null else row.getLong("bytesTotal"), "errorCode" to if (row.isNull("errorCode")) null else row.getString("errorCode"))
    }
  }
  fun claim(): Map<String, Any?>? = synchronized(store) {
    val epoch = foregroundEpoch()
    if (!active || epoch < 0 || ticket != null || worker) return@synchronized null
    val row = rows.firstOrNull { it.getString("state") == "queued" && it.getString("intent") == "eligible" } ?: return@synchronized null
    check(row.isNull("package")) { "DOWNLOAD_PARTIAL" }
    row.put("state", "resolving")
    try { save("claim"); check(foregroundEpoch() == epoch) { "DOWNLOAD_TICKET_REVOKED" } } catch (failure: Throwable) { row.put("state", "queued"); throw failure }
    ticketForeground = epoch
    ticket = ReelmFileCrypto.id(); ticketRow = row
    mapOf("ticket" to ticket, "card" to jsonMap(cards.getValue(row.getString("card"))), "episodeNumber" to row.getInt("episodeNumber"))
  }
  private fun current(t: String): JSONObject {
    val epoch = foregroundEpoch()
    check(active && epoch >= 0 && epoch == ticketForeground && ticket == t && ticketRow in rows) { "DOWNLOAD_TICKET_REVOKED" }; return requireNotNull(ticketRow)
  }
  private fun revoke() { ticket = null; ticketRow = null; activeCall?.cancel() }
  fun setActive(value: Boolean) = synchronized(store) {
    val epoch = foregroundEpoch(); active = value && epoch >= 0
    if (ticket != null && epoch != ticketForeground) {
      revoke(); rows.filter { it.getString("state") in setOf("resolving", "downloading") }.forEach { it.put("state", "paused") }
    }
    if (!active) {
      revoke(); rows.filter { it.getString("state") in setOf("queued", "resolving", "downloading") }.forEach { it.put("state", "paused") }
    } else rows.filter { it.getString("state") == "paused" && it.getString("intent") == "eligible" }.forEach {
      if (!worker && !it.isNull("package")) { store.discardPartial(it.getString("package")); it.put("package", JSONObject.NULL).put("metadata", JSONObject.NULL).put("bytesStored", 0) }
      it.put("state", "queued")
    }
    if (rows.isNotEmpty()) save(); Unit
  }
  fun pause() = synchronized(store) {
    revoke(); rows.filter { it.getString("state") in setOf("queued", "resolving", "downloading", "paused") }.forEach { it.put("state", "paused").put("intent", "user") }
    if (rows.isNotEmpty()) save(); Unit
  }
  fun resume() = synchronized(store) {
    rows.filter { it.getString("state") == "paused" && it.getString("intent") == "user" }.forEach { it.put("intent", "eligible") }
    setActive(active); Unit
  }
  fun fail(t: String, code: String) = synchronized(store) {
    ReelmFileCrypto.requireId(t); check(code.matches(Regex("[A-Z][A-Z0-9_]{0,79}"))) { "DOWNLOAD_ERROR_CODE" }
    val row = current(t); row.put("state", "failed").put("errorCode", code); revoke(); save(); Unit
  }
  fun edit(ids: List<String>, action: String) = synchronized(store) {
    check(ids.size <= ROW_MAX) { "DOWNLOAD_QUEUE_LIMIT" }; ids.forEach { ReelmFileCrypto.requireId(it) }
    val selected = rows.filter { it.getString("id") in ids && (action != "retry" || it !== workingRow && it.getString("state") in setOf("failed", "paused")) }
    if (selected.isEmpty()) return@synchronized Unit
    if (ticketRow in selected) revoke()
    selected.forEach { row ->
      if (action == "delete") row.put("state", "deleting")
      else if (action == "cancel" && row.getString("state") !in setOf("complete", "unreadable")) row.put("state", "paused").put("intent", "cancelled")
    }
    save()
    selected.filter { action == "delete" || it.getString("state") !in setOf("complete", "unreadable") }.forEach { row ->
      if (!row.isNull("package")) { store.delete(listOf(row.getString("package"))); if (row !== workingRow) store.discardPartial(row.getString("package")) }
      if (row !== workingRow) row.put("package", JSONObject.NULL).put("metadata", JSONObject.NULL).put("bytesStored", 0).put("bytesTotal", JSONObject.NULL)
    }
    if (action == "retry") selected.forEach { it.put("state", if (active) "queued" else "paused").put("intent", "eligible").put("errorCode", JSONObject.NULL) }
    if (action == "delete") rows.removeAll(selected.filter { it !== workingRow }.toSet())
    save(); Unit
  }
  internal fun completedMetadata(leaseId: String): String = synchronized(store) {
    val lease = store.liveLease(leaseId); val packageId = lease.downloadId
    val row = rows.single { !it.isNull("package") && it.getString("package") == packageId }; check(row.getString("state") == "complete") { "OFFLINE_NOT_COMPLETE" }
    val body = decode(store.readLeaseMetadata(leaseId, row.getString("metadata"))); val metadata = JSONObject(body)
    val identity = metadata.getJSONObject("identity"); val c = cards.getValue(row.getString("card"))
    check(metadata.getInt("version") == 1 && metadata.getInt("episodeNumber") == row.getInt("episodeNumber") && identity.getString("seriesId") == c.getString("id") &&
      identity.getString("slug") == c.getString("slug") && identity.getString("platform") == c.getString("platform") && identity.getInt("episodeNumber") == row.getInt("episodeNumber") &&
      metadata.getString("rootResourceId") == Uri.parse(lease.rootUri).lastPathSegment &&
      (metadata.getString("type") == "mp4" && lease.contentType == "video/mp4" || metadata.getString("type") == "hls" && lease.contentType == "application/vnd.apple.mpegurl")) { "DOWNLOAD_METADATA_IDENTITY" }
    body
  }
  internal fun packageId(id: String): String = synchronized(store) {
    ReelmFileCrypto.requireId(id); rows.single { it.getString("id") == id && it.getString("state") == "complete" }.getString("package")
  }
  internal fun jsonMap(obj: JSONObject): Map<String, Any?> = obj.keys().asSequence().associateWith { key ->
    when (val v = obj.get(key)) { JSONObject.NULL -> null; is JSONObject -> jsonMap(v); is JSONArray -> (0 until v.length()).map { i -> val e = v.get(i); if (e is JSONObject) jsonMap(e) else if (e == JSONObject.NULL) null else e }; else -> v }
  }
  private fun checkTransfer(t: String, expires: Long) = synchronized(store) {
    current(t); check(System.currentTimeMillis() < expires) { "DOWNLOAD_EXPIRED" }
    check(freeBytes() >= ReelmFileCrypto.RESERVE + ReelmFileCrypto.CHUNK + 1048600) { "OFFLINE_SPACE" }
  }
  private fun <T> remote(t: String, expires: Long, input: ReelmRemote, cap: Long, consume: (InputStream, String, Long) -> T): T {
    var url = policy.url(input.url); val visited = mutableSetOf<String>()
    for (hops in 0..3) {
      checkTransfer(t, expires); check(visited.add(url)) { "DOWNLOAD_REDIRECT" }
      val pexp = URI(url).rawQuery?.split('&')?.firstOrNull { java.net.URLDecoder.decode(it.substringBefore('='), "UTF-8") == "pexp" }?.substringAfter('=', "")?.let { java.net.URLDecoder.decode(it, "UTF-8") }
      if (pexp != null && pexp.matches(Regex("[0-9]{10}"))) check(pexp.toLong() * 1000 > System.currentTimeMillis()) { "DOWNLOAD_EXPIRED" }
      val request = Request.Builder().url(url).header("User-Agent", UA).header("Cache-Control", "no-cache").header("Accept", "*/*")
      if (input.offset != null) request.header("Range", "bytes=${input.offset}-${Math.addExact(input.offset, requireNotNull(input.length)) - 1}")
      val call = client.newCall(request.build()); synchronized(store) {
        current(t); check(activeCall == null); activeCall = call
        try { current(t) } catch (failure: Throwable) { activeCall = null; call.cancel(); throw failure }
      }
      try {
        call.execute().use { response ->
          check(response.request.url.toString() == request.build().url.toString()) { "DOWNLOAD_RESPONSE_URL" }
          val finalUrl = policy.url(response.request.url.toString())
          if (response.code in setOf(301, 302, 303, 307, 308)) {
            check(hops < 3) { "DOWNLOAD_REDIRECT" }; url = policy.url(requireNotNull(response.header("Location")) { "DOWNLOAD_REDIRECT" }, finalUrl)
          } else {
            check(response.code == 200 || response.code == 206) { "DOWNLOAD_HTTP_${response.code}" }
            val body = requireNotNull(response.body) { "DOWNLOAD_BODY" }; val declared = body.contentLength()
            check(declared in -1..cap) { "DOWNLOAD_RESOURCE_LIMIT" }
            val type = response.header("Content-Type")?.substringBefore(';')?.trim()?.lowercase()
            val accepted = when (input.kind) { "playlist" -> setOf("application/vnd.apple.mpegurl", "application/x-mpegurl", "audio/x-mpegurl"); "ts" -> setOf("video/mp2t"); "audio" -> setOf("audio/mp4", "video/mp4"); else -> setOf("video/mp4") }
            check(type in accepted) { "DOWNLOAD_CONTENT_TYPE" }
            var expected = declared
            if (input.offset != null || response.code == 206) {
              check(response.code == 206) { "DOWNLOAD_RANGE" }
              val match = Regex("bytes ([0-9]+)-([0-9]+)/([0-9]+)").matchEntire(response.header("Content-Range") ?: "") ?: error("DOWNLOAD_RANGE")
              val start = match.groupValues[1].toLong(); val end = match.groupValues[2].toLong(); val total = match.groupValues[3].toLong()
              check(start >= 0 && end >= start && total > end) { "DOWNLOAD_RANGE" }
              val length = Math.addExact(Math.subtractExact(end, start), 1)
              check(length <= cap && (declared == -1L || declared == length)) { "DOWNLOAD_RANGE" }
              if (input.offset != null) check(start == input.offset && length == input.length) { "DOWNLOAD_RANGE" }
              else check(start == 0L && length == total) { "DOWNLOAD_RANGE" }
              expected = length
            } else check(response.header("Content-Range") == null) { "DOWNLOAD_RANGE" }
            if (input.kind == "mp4") synchronized(store) { current(t).put("bytesTotal", if (expected >= 0) expected else JSONObject.NULL) }
            var received = 0L
            val counted = object : FilterInputStream(body.byteStream()) {
              override fun read(): Int { val b = ByteArray(1); return if (read(b, 0, 1) < 0) -1 else b[0].toInt() and 255 }
              override fun read(b: ByteArray, off: Int, len: Int): Int {
                checkTransfer(t, expires); val n = super.read(b, off, len)
                if (n > 0) synchronized(store) {
                  val row = current(t); received = Math.addExact(received, n.toLong())
                  check(received <= cap && (expected < 0 || received <= expected)) { "DOWNLOAD_RESOURCE_LIMIT" }
                  val aggregate = Math.addExact(row.getLong("bytesReceived"), n.toLong()); check(aggregate <= ReelmDownloadStore.EPISODE_MAX) { "DOWNLOAD_EPISODE_LIMIT" }
                  row.put("bytesReceived", aggregate)
                  val packageId = row.optString("package"); if (packageId.isNotEmpty()) check(store.physicalBytes(packageId) + n + 1048600 <= ReelmDownloadStore.EPISODE_MAX) { "DOWNLOAD_EPISODE_LIMIT" }
                }
                return n
              }
            }
            val result = consume(counted, finalUrl, expected)
            check(received > 0 && (expected < 0 || received == expected)) { "DOWNLOAD_LENGTH" }
            checkTransfer(t, expires); return result
          }
        }
      } finally { synchronized(store) { if (activeCall === call) activeCall = null } }
    }
    error("DOWNLOAD_REDIRECT")
  }
  private fun attributes(line: String): Map<String, String> {
    val body = line.substringAfter(':'); val match = Regex("([A-Z0-9-]+)=(\"[^\"]*\"|[^,]+)(,|$)")
    val result = linkedMapOf<String, String>(); var end = 0
    for (m in match.findAll(body)) { check(m.range.first == end && !result.containsKey(m.groupValues[1])) { "DOWNLOAD_PLAYLIST" }; result[m.groupValues[1]] = m.groupValues[2].removeSurrounding("\""); end = m.range.last + 1 }
    check(end == body.length) { "DOWNLOAD_PLAYLIST" }; return result
  }
  private fun range(value: String, uri: String, previous: ReelmRemote?): Pair<Long, Long> {
    val m = Regex("([0-9]+)(?:@([0-9]+))?").matchEntire(value) ?: error("DOWNLOAD_RANGE")
    val length = m.groupValues[1].toLong(); check(length in 1..ReelmFileCrypto.RESOURCE_MAX) { "DOWNLOAD_RANGE" }
    val offset = if (m.groupValues[2].isNotEmpty()) m.groupValues[2].toLong() else {
      check(previous?.url == uri && previous.offset != null && previous.length != null) { "DOWNLOAD_RANGE" }; Math.addExact(previous.offset, previous.length)
    }
    check(offset >= 0); Math.addExact(offset, length); return offset to length
  }
  private fun mediaReference(value: String, base: String?, kind: String, byteRange: String?, previous: ReelmRemote?): ReelmRemote {
    val url = policy.url(value, base); val uri = URI(url)
    if (kind == "ts") check(uri.path.endsWith(".ts")) { "DOWNLOAD_FORMAT" }
    else check(uri.path.startsWith("/vr/fr/vt/") && uri.path.endsWith(".mp4") && (policy !== ReelmReleaseDownloadPolicy || uri.host == "dramadunyam.com")) { "DOWNLOAD_FORMAT" }
    val bounds = byteRange?.let { range(it, url, previous) }
    return ReelmRemote(url, bounds?.first, bounds?.second, kind)
  }
  private fun lines(body: String): List<String> {
    check(body.toByteArray(Charsets.UTF_8).size <= PLAYLIST_MAX && body.none { it == '\u0000' }) { "DOWNLOAD_PLAYLIST_LIMIT" }
    val lines = body.split(Regex("\r?\n")).map { it.trim() }.filter { it.isNotEmpty() }
    check(lines.firstOrNull() == "#EXTM3U") { "DOWNLOAD_PLAYLIST" }; return lines
  }
  private fun playlist(body: String, base: String?, audio: Boolean = false): ReelmPlaylist {
    val source = lines(body); val output = mutableListOf<String>(); val refs = linkedMapOf<Int, ReelmRemote>()
    var ended = false; var duration = false; var pendingRange: String? = null; var map = false; var segments = 0; var previous: ReelmRemote? = null
    for (line in source) {
      check(!ended) { "DOWNLOAD_PLAYLIST" }
      when {
        line == "#EXTM3U" -> { check(output.isEmpty()); output.add(line) }
        line == "#EXT-X-ENDLIST" -> { check(!duration && pendingRange == null); ended = true; output.add(line) }
        line.startsWith("#EXTINF:") -> {
          check(!duration); val value = line.substringAfter(':').substringBefore(',').toDouble(); check(value.isFinite() && value > 0 && value <= 86400) { "DOWNLOAD_DURATION" }
          duration = true; output.add("#EXTINF:$value,")
        }
        line.startsWith("#EXT-X-BYTERANGE:") -> { check(duration && pendingRange == null); pendingRange = line.substringAfter(':') }
        line.startsWith("#EXT-X-MAP:") -> {
          check(!duration); val a = attributes(line); check(a.keys.all { it in setOf("URI", "BYTERANGE") } && a.containsKey("URI")) { "DOWNLOAD_PLAYLIST" }
          val r = mediaReference(a.getValue("URI"), base, if (audio) "audio" else "fmp4", a["BYTERANGE"], previous)
          refs[output.size] = r; output.add("#EXT-X-MAP:URI=\"@RESOURCE@\""); previous = r; map = true
        }
        !line.startsWith('#') -> {
          check(duration); val uri = URI(policy.url(line, base)); val fmp4 = uri.path.endsWith(".mp4")
          check(!fmp4 || map) { "DOWNLOAD_INIT_REQUIRED" }; check(!map || fmp4) { "DOWNLOAD_FORMAT" }
          val r = mediaReference(line, base, if (fmp4) { if (audio) "audio" else "fmp4" } else "ts", pendingRange, previous)
          refs[output.size] = r; output.add("@RESOURCE@"); previous = r; duration = false; pendingRange = null; segments++
        }
        line.startsWith("#EXT-X-VERSION:") || line.startsWith("#EXT-X-TARGETDURATION:") || line.startsWith("#EXT-X-MEDIA-SEQUENCE:") || line.startsWith("#EXT-X-DISCONTINUITY-SEQUENCE:") -> {
          check(line.substringAfter(':').matches(Regex("[0-9]{1,10}"))); val n = line.substringAfter(':').toLong(); check(n <= 2147483647); output.add(line)
        }
        line in setOf("#EXT-X-INDEPENDENT-SEGMENTS", "#EXT-X-DISCONTINUITY", "#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-ALLOW-CACHE:YES", "#EXT-X-ALLOW-CACHE:NO") -> output.add(line)
        else -> error("DOWNLOAD_UNSUPPORTED_PLAYLIST")
      }
      check(refs.size <= 1000) { "DOWNLOAD_REFERENCE_LIMIT" }
    }
    check(ended && segments > 0 && !duration && pendingRange == null) { "DOWNLOAD_FINITE_PLAYLIST" }
    return ReelmPlaylist(output, refs)
  }
  private fun cues(resolved: JSONObject): JSONArray {
    val status = resolved.getString("subtitleStatus"); check(status in setOf("english-sidecar", "no-english-sidecar", "unavailable")) { "DOWNLOAD_SUBTITLE" }
    val input = resolved.getJSONArray("englishSubtitleCues"); check(input.length() <= 1000 && (status == "english-sidecar" || input.length() == 0)) { "DOWNLOAD_SUBTITLE" }
    val result = JSONArray()
    for (i in 0 until input.length()) { val c = input.getJSONObject(i); check(c.get("start") is Number && c.get("end") is Number) { "DOWNLOAD_SUBTITLE" }; val start = c.getDouble("start"); val end = c.getDouble("end")
      check(start.isFinite() && end.isFinite() && start >= 0 && start < end && end <= 86400) { "DOWNLOAD_SUBTITLE" }
      val text = c.getString("text"); check(text.isNotEmpty() && text.length <= 1000 && !text.contains(Regex("[\\u0000-\\u0008\\u000b-\\u001f\\u007f]"))) { "DOWNLOAD_SUBTITLE" }
      result.put(JSONObject().put("start", start).put("end", end).put("text", text))
    }
    check(result.toString().toByteArray(Charsets.UTF_8).size <= CUES_MAX) { "DOWNLOAD_SUBTITLE_LIMIT" }; return result
  }
  fun start(t: String, input: JSONObject, resolved: JSONObject) {
    try { transfer(t, input, resolved) }
    catch (failure: Throwable) { synchronized(store) {
      if (settleFailure(t, failure)) try { save() } catch (persistence: Throwable) { failure.addSuppressed(persistence) }
    }; throw failure }
  }
  private fun settleFailure(t: String, failure: Throwable): Boolean {
    if (ticket != t) return false
    val epoch = foregroundEpoch(); val interrupted = epoch < 0 || epoch != ticketForeground
    requireNotNull(ticketRow).put("state", if (interrupted) "paused" else "failed")
      .put("errorCode", if (interrupted) JSONObject.NULL else errorCode(failure))
    revoke(); return true
  }
  private fun transfer(t: String, input: JSONObject, resolved: JSONObject) {
    val d = detail(input); val c = card(d); val identity = resolved.getJSONObject("identity"); val num = ordinal(resolved.get("episodeNumber"))
    check(resolved.getString("sourceId") == "dramadunyam" && !boolean(resolved,"cdnCredentialsAttached") && ordinal(identity.get("episodeNumber")) == num &&
      identity.getString("seriesId") == c.getString("id") && identity.getString("slug") == c.getString("slug") && identity.getString("platform") == c.getString("platform")) { "DOWNLOAD_IDENTITY" }
    check(resolved.getString("title") == c.getString("title")); text(resolved.get("languageQualification"), 2000)
    check(num <= minOf(c.getInt("totalEpisodes"), c.getInt("availableEpisodes"), d.getInt("episodesInDB"))) { "EPISODE_NOT_ADVERTISED" }
    val expires = integer(resolved.get("expiresAt"), 9007199254740991L, 1); check(expires > System.currentTimeMillis()) { "DOWNLOAD_EXPIRED" }
    integer(resolved.get("referenceCount"), 4096); val suppliedHosts = resolved.getJSONArray("referenceHosts"); check(suppliedHosts.length() <= 10)
    for (i in 0 until suppliedHosts.length()) check(suppliedHosts.getString(i) in ReelmReleaseDownloadPolicy.hosts) { "DOWNLOAD_URL" }
    val captions = cues(resolved)
    val row = synchronized(store) { current(t).also { check(!worker && it.getString("state") == "resolving" && it.getString("card") == cardKey(c) && it.getInt("episodeNumber") == num) { "DOWNLOAD_TICKET" } } }
    var packageId = ""; var admitted = false; var primary: Throwable? = null
    try {
      synchronized(store) {
        current(t); check(!worker); checkTransfer(t, expires); packageId = store.begin(); admitted = true; worker = true; workingRow = row
        row.put("package", packageId).put("bytesReceived", 0).put("bytesStored", 0).put("bytesTotal", JSONObject.NULL).put("state", "downloading"); save("admission")
      }
      val resources = linkedMapOf<ReelmRemote, ResourceRecord>()
      fun local(bytes: ByteArray): ResourceRecord { checkTransfer(t, expires); return store.writeResource(packageId, ByteArrayInputStream(bytes), bytes.size.toLong()).also { synchronized(store) { current(t); row.put("bytesStored", store.physicalBytes(packageId)); save() } } }
      fun download(ref: ReelmRemote): ResourceRecord = resources.getOrPut(ref) {
        remote(t, expires, ref, ref.length ?: ReelmFileCrypto.RESOURCE_MAX) { stream, _, _ -> store.writeResource(packageId, stream, ref.length ?: ReelmFileCrypto.RESOURCE_MAX) }
      }
      fun child(body: String, base: String?, audio: Boolean = false): ResourceRecord {
        val parsed = playlist(body, base, audio); check(resources.size + parsed.references.size + 4 <= 4096) { "DOWNLOAD_REFERENCE_LIMIT" }
        val output = parsed.lines.mapIndexed { index, line -> parsed.references[index]?.let { ref -> line.replace("@RESOURCE@", download(ref).resourceId) } ?: line }.joinToString("\n", postfix = "\n")
        check(!output.contains(Regex("https?://"))) { "DOWNLOAD_REMOTE_REFERENCE" }; return local(output.toByteArray(Charsets.UTF_8))
      }
      val type = resolved.getString("type"); val root: ResourceRecord; val contentType: String
      if (type == "mp4") {
        check(resolved.getString("transport") == "direct-https-mp4" && resolved.isNull("manifestBody") && resolved.isNull("manifestSHA256")) { "DOWNLOAD_FORMAT" }
        root = download(ReelmRemote(policy.url(resolved.getString("uri")), kind = "mp4")); contentType = "video/mp4"
      } else {
        check(type == "hls"); val body = resolved.getString("manifestBody"); check(ReelmFileCrypto.digest(body.toByteArray(Charsets.UTF_8)) == resolved.getString("manifestSHA256")) { "DOWNLOAD_MANIFEST_HASH" }
        val source = lines(body)
        if (source.any { it.startsWith("#EXT-X-STREAM-INF:") }) {
          check(resolved.getString("transport") == "app-cache-master-direct-https-playlists-and-segments") { "DOWNLOAD_FORMAT" }
          val audioTag = source.single { it.startsWith("#EXT-X-MEDIA:") }; val audio = attributes(audioTag)
          check(audio["TYPE"] == "AUDIO" && audio.keys.all { it in setOf("TYPE", "GROUP-ID", "NAME", "DEFAULT", "AUTOSELECT", "LANGUAGE", "URI", "CHANNELS") } && audio.containsKey("URI") && audio.containsKey("GROUP-ID")) { "DOWNLOAD_AUDIO" }
          val streamTag = source.single { it.startsWith("#EXT-X-STREAM-INF:") }; val stream = attributes(streamTag)
          check(stream["AUDIO"] == audio["GROUP-ID"] && stream.keys.all { it in setOf("BANDWIDTH", "AVERAGE-BANDWIDTH", "RESOLUTION", "CODECS", "FRAME-RATE", "AUDIO", "VIDEO-RANGE", "CLOSED-CAPTIONS") } &&
            (stream["VIDEO-RANGE"] == null || stream["VIDEO-RANGE"] == "SDR") && (stream["CLOSED-CAPTIONS"] == null || stream["CLOSED-CAPTIONS"] == "NONE")) { "DOWNLOAD_AUDIO" }
          val resolution = Regex("([0-9]+)x([0-9]+)").matchEntire(stream["RESOLUTION"] ?: "") ?: error("DOWNLOAD_QUALITY")
          val width = resolution.groupValues[1].toLong(); val height = resolution.groupValues[2].toLong(); check(width in 1..9007199254740991L && height in 1..9007199254740991L && minOf(width, height) <= 1080) { "DOWNLOAD_QUALITY" }
          for (name in listOf("BANDWIDTH", "AVERAGE-BANDWIDTH")) stream[name]?.let { check(it.matches(Regex("[0-9]+")) && it.toLong() in 0..9007199254740991L) { "DOWNLOAD_QUALITY" } }
          val position = source.indexOf(streamTag); check(position + 1 < source.size && !source[position + 1].startsWith('#'))
          check(source.size == 4 || source.size == 5 && (source[1] == "#EXT-X-INDEPENDENT-SEGMENTS" || source[1].matches(Regex("#EXT-X-VERSION:[0-9]{1,2}")))) { "DOWNLOAD_MASTER" }
          fun fetched(uri: String, isAudio: Boolean): ResourceRecord {
            check(URI(policy.url(uri)).path.endsWith(".m3u8")) { "DOWNLOAD_FORMAT" }
            val fetched = remote(t, expires, ReelmRemote(policy.url(uri), kind = "playlist"), PLAYLIST_MAX.toLong()) { inputStream, finalUrl, _ -> decode(inputStream.readBytes()) to finalUrl }
            return child(fetched.first, fetched.second, isAudio)
          }
          val videoRoot = fetched(source[position + 1], false); val audioRoot = fetched(audio.getValue("URI"), true)
          val output = source.mapIndexed { i, line -> if (line == audioTag) line.replace(Regex("URI=\"[^\"]+\""), "URI=\"${audioRoot.resourceId}\"") else if (i == position + 1) videoRoot.resourceId else line }.joinToString("\n", postfix = "\n")
          check(!output.contains(Regex("https?://"))); root = local(output.toByteArray(Charsets.UTF_8))
        } else {
          check(resolved.getString("transport") == "app-cache-manifest-direct-https-segments") { "DOWNLOAD_FORMAT" }; root = child(body, null)
        }
        contentType = "application/vnd.apple.mpegurl"
      }
      val metadata = JSONObject().put("version", 1).put("detail", d).put("identity", JSONObject().put("seriesId", c.getString("id")).put("slug", c.getString("slug")).put("platform", c.getString("platform")).put("episodeNumber", num))
        .put("episodeNumber", num).put("englishSubtitleCues", captions).put("subtitleStatus", resolved.getString("subtitleStatus")).put("type", type).put("rootResourceId", root.resourceId)
      val metadataBytes = metadata.toString().toByteArray(Charsets.UTF_8); check(metadataBytes.size <= 524288) { "DOWNLOAD_METADATA_LIMIT" }
      val meta = local(metadataBytes)
      synchronized(store) {
        try {
          current(t); checkTransfer(t, expires); row.put("metadata", meta.resourceId); store.complete(packageId, root.resourceId, contentType); current(t)
          row.put("state", "complete").put("errorCode", JSONObject.NULL).put("bytesStored", store.physicalBytes(packageId)).put("bytesTotal", row.getLong("bytesReceived")); save(); current(t); revoke()
        } catch (failure: Throwable) { settleFailure(t, failure); throw failure }
      }
    } catch (failure: Throwable) {
      primary = failure
      synchronized(store) { settleFailure(t, failure) }
      throw failure
    } finally {
      if (admitted) synchronized(store) {
        var cleanup: Throwable? = null
        try {
          if (row.getString("state") != "complete") {
            beforeIO("cleanup"); store.discardPartial(packageId)
            if (row.optString("package") == packageId) row.put("package", JSONObject.NULL).put("metadata", JSONObject.NULL).put("bytesStored", 0).put("bytesTotal", JSONObject.NULL)
            if (row.getString("state") == "deleting") rows.remove(row)
          }
        } catch (failure: Throwable) {
          cleanup = failure // Keep the owned package pointer: list/retry/restart must account for it.
          if (row.getString("state") in setOf("queued", "resolving", "downloading")) row.put("state", "failed").put("errorCode", errorCode(primary ?: failure))
        } finally {
          worker = false; workingRow = null
        }
        try { if (rows.contains(row)) save() } catch (failure: Throwable) { if (cleanup == null) cleanup = failure else cleanup!!.addSuppressed(failure) }
        if (cleanup != null) { if (primary != null) primary!!.addSuppressed(cleanup!!) else throw cleanup!! }
      }
    }
  }
  private fun errorCode(failure: Throwable): String {
    val value = failure.message ?: "DOWNLOAD_FAILED"; return if (value.matches(Regex("[A-Z][A-Z0-9_]{0,79}"))) value else "DOWNLOAD_FAILED"
  }
}
