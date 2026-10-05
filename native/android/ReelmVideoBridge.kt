package expo.modules.video

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.ModuleDefinitionBuilder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import org.json.JSONObject

class ReelmVideoBridge {
  internal val io = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  internal val transfer = ReelmLibraryTransfer(io)
  private val ownedLeases = mutableSetOf<String>()
  private var downloadStore: ReelmDownloadStore? = null
  @Volatile private var destroyed = false
  // Odd generations are foreground; each transition invalidates earlier claims.
  private val nativeDownloadsForeground = AtomicLong(1)
  @Volatile private var downloadsReady = false
  @Volatile private var downloadQueue: ReelmDownloadQueue? = null
  private val downloadLifecycleFailure = AtomicReference<Throwable?>(null)
  private fun foregroundEpoch(): Long = nativeDownloadsForeground.get().let { if ((it and 1L) == 1L) it else -1L }
  private fun bind(queue: ReelmDownloadQueue) { queue.bindForeground { if (destroyed) -1L else foregroundEpoch() } }
  @Synchronized internal fun downloads(context: Context, create: Boolean = false): ReelmDownloadQueue? {
    check(!destroyed) { "OFFLINE_BRIDGE_DESTROYED" }
    downloadLifecycleFailure.getAndSet(null)?.let { throw it }
    val root = File(context.applicationContext.noBackupFilesDir, "reelmDownloads")
    if (!create && downloadStore == null && !File(root, "queue.sealed").exists() && !File(root, "queue.sealed.bak").exists()) return null
    val store = downloadStore ?: ReelmDownloadStore.get(context).also { downloadStore = it }
    return downloadQueue ?: store.downloads.also { bind(it); downloadQueue = it; it.reconcileActive { foregroundEpoch() >= 0 && downloadsReady } }
  }
  @Synchronized fun setDownloadsActive(active: Boolean) {
    downloadsReady = active; downloadQueue?.let { bind(it); it.reconcileActive { foregroundEpoch() >= 0 && downloadsReady } }
  }
  fun setNativeDownloadsForeground(foreground: Boolean) {
    nativeDownloadsForeground.updateAndGet { state -> if (((state and 1L) == 1L) == foreground) state else state + 1 }
    if (!foreground) downloadQueue?.cancelForegroundCall()
    io.launch {
      try { synchronized(this@ReelmVideoBridge) {
        if (!destroyed) downloadQueue?.reconcileActive { foregroundEpoch() >= 0 && downloadsReady }
      } } catch (failure: Throwable) { downloadLifecycleFailure.set(failure) }
    }
  }
  @Synchronized fun acquireOffline(context: Context, downloadId: String): OfflineLease {
    check(!destroyed) { "OFFLINE_BRIDGE_DESTROYED" }
    val queue = requireNotNull(downloads(context)) { "OFFLINE_NOT_COMPLETE" }
    val store = requireNotNull(downloadStore)
    return synchronized(store) { store.acquire(queue.packageId(downloadId)).also { ownedLeases.add(it.leaseId) }.copy(downloadId = downloadId) }
  }
  @Synchronized fun readOfflineMetadata(leaseId: String): Map<String, Any?> {
    check(!destroyed && leaseId in ownedLeases) { "OFFLINE_LEASE_REVOKED" }
    val queue = requireNotNull(downloadQueue)
    val metadata = JSONObject(queue.completedMetadata(leaseId))
    metadata.remove("rootResourceId")
    return queue.jsonMap(metadata)
  }
  @Synchronized fun storageBytes(context: Context): Long {
    check(!destroyed) { "OFFLINE_BRIDGE_DESTROYED" }
    return downloadStore?.storageBytes() ?: ReelmDownloadStore.storageBytes(File(context.applicationContext.noBackupFilesDir, "reelmDownloads"))
  }
  @Synchronized fun releaseOffline(leaseId: String) {
    if (ownedLeases.remove(leaseId)) downloadStore?.release(leaseId)
  }
  @Synchronized fun destroy() {
    nativeDownloadsForeground.updateAndGet { if ((it and 1L) == 1L) it + 1 else it }; downloadsReady = false
    downloadQueue?.let { bind(it); it.cancelForegroundCall() }
    var failure: Throwable? = null
    try { downloadQueue?.setActive(false) } catch (error: Throwable) { failure = error }
    finally {
      destroyed = true;transfer.destroy()
      try { ownedLeases.toList().forEach { lease ->
        try { downloadStore?.release(lease) } catch (error: Throwable) { if (failure == null) failure = error else failure!!.addSuppressed(error) }
      } } finally { ownedLeases.clear(); io.cancel() }
    }
    failure?.let { throw it }
  }
  @Suppress("DEPRECATION")
  fun installed(context: Context): Map<String, Any> {
    val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
    val info = context.packageManager.getPackageInfo(context.packageName, flags)
    val signatures = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
    require(signatures != null && signatures.size == 1) { "SIGNER_COUNT" }
    val hash = MessageDigest.getInstance("SHA-256").digest(signatures.single().toByteArray()).joinToString("") { "%02x".format(it.toInt() and 255) }
    val code = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
    require(code in 0..9007199254740991L) { "VERSION_CODE_RANGE" }
    return mapOf("packageName" to info.packageName, "versionName" to requireNotNull(info.versionName), "versionCode" to code, "certificateSHA256" to hash,"updateTrusted" to ReelmApkUpdater.get(context).trusted())
  }
}
fun ModuleDefinitionBuilder.reelmLibrary(bridge: ReelmVideoBridge, getApp: () -> AppContext) {
  fun context() = getApp().reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()
  OnActivityResult { _, payload -> bridge.transfer.onActivityResult(payload.requestCode,payload.resultCode,payload.data) }
  (AsyncFunction("reelmExportLibrary") Coroutine { body:String -> bridge.transfer.exportLibrary(getApp().throwingActivity,body) }).runOnQueue(bridge.io)
  (AsyncFunction("reelmImportLibrary") Coroutine { -> bridge.transfer.importLibrary(getApp().throwingActivity) }).runOnQueue(bridge.io)
  (AsyncFunction("reelmDownloadUpdate") Coroutine { candidate:Map<String,Any?> -> ReelmApkUpdater.get(context()).download(JSONObject(candidate)) }).runOnQueue(bridge.io)
  (AsyncFunction("reelmCancelUpdate") Coroutine { -> ReelmApkUpdater.get(context()).cancel() }).runOnQueue(bridge.io)
  (AsyncFunction("reelmGetUpdateStatus") Coroutine { -> ReelmApkUpdater.get(context()).status() }).runOnQueue(bridge.io)
  (AsyncFunction("reelmInstallVerifiedUpdate") Coroutine { -> ReelmApkUpdater.get(context()).install(getApp().throwingActivity) }).runOnQueue(bridge.io)
  (AsyncFunction("reelmListDownloads") Coroutine { -> bridge.downloads(context())?.list() ?: emptyList() }).runOnQueue(bridge.io)
  (AsyncFunction("reelmEnqueueDownloads") Coroutine { detail: Map<String, Any?>, ordinals: List<Double> -> bridge.downloads(context(), true)!!.enqueue(JSONObject(detail), ordinals) }).runOnQueue(bridge.io)
  (AsyncFunction("reelmClaimNextDownload") Coroutine { -> bridge.downloads(context())?.claim() }).runOnQueue(bridge.io)
  (AsyncFunction("reelmStartDownload") Coroutine { ticket: String, detail: Map<String, Any?>, resolved: Map<String, Any?> -> requireNotNull(bridge.downloads(context())).start(ticket, JSONObject(detail), JSONObject(resolved)) }).runOnQueue(bridge.io)
  (AsyncFunction("reelmFailDownload") Coroutine { ticket: String, code: String -> requireNotNull(bridge.downloads(context())).fail(ticket, code) }).runOnQueue(bridge.io)
  (AsyncFunction("reelmPauseDownloads") Coroutine { -> bridge.downloads(context())?.pause(); Unit }).runOnQueue(bridge.io)
  (AsyncFunction("reelmResumeDownloads") Coroutine { -> bridge.downloads(context())?.resume(); Unit }).runOnQueue(bridge.io)
  (AsyncFunction("reelmSetDownloadsActive") Coroutine { active: Boolean -> bridge.setDownloadsActive(active) }).runOnQueue(bridge.io)
  (AsyncFunction("reelmCancelDownloads") Coroutine { ids: List<String> -> bridge.downloads(context())?.edit(ids, "cancel"); Unit }).runOnQueue(bridge.io)
  (AsyncFunction("reelmRetryDownloads") Coroutine { ids: List<String> -> bridge.downloads(context())?.edit(ids, "retry"); Unit }).runOnQueue(bridge.io)
  (AsyncFunction("reelmDeleteDownloads") Coroutine { ids: List<String> -> bridge.downloads(context())?.edit(ids, "delete"); Unit }).runOnQueue(bridge.io)
  (AsyncFunction("reelmAcquireOffline") Coroutine { downloadId: String ->
    val lease = bridge.acquireOffline(getApp().reactContext?.applicationContext ?: throw Exceptions.ReactContextLost(), downloadId)
    mapOf("leaseId" to lease.leaseId, "downloadId" to lease.downloadId, "rootUri" to lease.rootUri, "contentType" to lease.contentType)
  }).runOnQueue(bridge.io)
  (AsyncFunction("reelmReleaseOffline") Coroutine { leaseId: String -> bridge.releaseOffline(leaseId) }).runOnQueue(bridge.io)
  (AsyncFunction("reelmReadOfflineMetadata") Coroutine { leaseId: String -> bridge.readOfflineMetadata(leaseId) }).runOnQueue(bridge.io)
  (AsyncFunction("reelmDownloadStorageBytes") Coroutine { -> bridge.storageBytes(context()) }).runOnQueue(bridge.io)
  (AsyncFunction("reelmReadLibraryJson") Coroutine { ->
    ReelmLibraryStore(File(getApp().persistentFilesDirectory, "reelm-drama-library.json")).read()
  }).runOnQueue(bridge.io)
  (AsyncFunction("reelmWriteLibraryJsonAtomic") Coroutine { body: String ->
    ReelmLibraryStore(File(getApp().persistentFilesDirectory, "reelm-drama-library.json")).write(body)
  }).runOnQueue(bridge.io)
  (AsyncFunction("reelmGetInstalledVersion") Coroutine { ->
    bridge.installed(getApp().reactContext?.applicationContext ?: throw Exceptions.ReactContextLost())
  }).runOnQueue(bridge.io)
}
