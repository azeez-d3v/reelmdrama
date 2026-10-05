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
import org.json.JSONObject

class ReelmVideoBridge {
  internal val io = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  internal val transfer = ReelmLibraryTransfer(io)
  fun retireDownloads(app: AppContext) {
    io.launch {
      try { ReelmDownloadRetirement.retire(app.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()) }
      catch (failure: Exception) { android.util.Log.e("ReelmDownloadRetirement", "Retirement pending; retry on next launch", failure) }
    }
  }
  @Synchronized fun destroy() {
    transfer.destroy()
    io.cancel()
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
