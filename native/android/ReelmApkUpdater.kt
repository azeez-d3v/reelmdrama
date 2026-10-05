package expo.modules.video

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.AtomicFile
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/** One private candidate; GitHub metadata is a hint, never an APK trust anchor. */
class ReelmApkUpdater private constructor(private val context: Context) {
  companion object {
    const val MAX_BYTES = 256L * 1024 * 1024
    private val hosts = setOf("github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com")
    private val hex = Regex("[a-f0-9]{64}")
    @Volatile private var instance: ReelmApkUpdater? = null
    @Synchronized fun get(context: Context): ReelmApkUpdater = instance ?: ReelmApkUpdater(context.applicationContext).also { instance = it }
    fun safeURL(value: String, initial: Boolean = false): String {
      require(value.length in 1..16384) { "UPDATE_URL" }
      val uri = URI(value)
      require(uri.scheme == "https" && uri.host in hosts && uri.port in listOf(-1,443) && uri.rawUserInfo == null && uri.rawFragment == null) { "UPDATE_URL" }
      if (initial) require(uri.host == "github.com" && uri.path.startsWith("/azeez-d3v/reelmdrama/releases/download/") && uri.path.endsWith("/ReelmDrama-arm64-v8a.apk")) { "UPDATE_URL" }
      return uri.toASCIIString()
    }
    fun digest(file: File): String {
      val md = MessageDigest.getInstance("SHA-256")
      file.inputStream().use { input -> val buffer = ByteArray(65536); while(true) { val n=input.read(buffer); if(n<0)break; md.update(buffer,0,n) } }
      return md.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
    }
    @Suppress("DEPRECATION") private fun certificate(info: android.content.pm.PackageInfo): String {
      val signers = if(Build.VERSION.SDK_INT>=28) info.signingInfo?.apkContentsSigners else info.signatures
      require(signers != null && signers.size == 1) { "UPDATE_SIGNER" }
      return MessageDigest.getInstance("SHA-256").digest(signers.single().toByteArray()).joinToString("") { "%02x".format(it.toInt() and 255) }
    }
    @Suppress("DEPRECATION") private fun code(info: android.content.pm.PackageInfo): Long = if(Build.VERSION.SDK_INT>=28)info.longVersionCode else info.versionCode.toLong()
  }
  private val root = File(context.noBackupFilesDir,"reelmUpdates").apply { check(exists() || mkdir()) { "UPDATE_STORAGE" } }
  private val apk = File(root,"candidate.apk")
  private val partial = File(root,"candidate.part")
  private val record = AtomicFile(File(root,"candidate.json"))
  private val prefs = context.getSharedPreferences("reelmUpdater",Context.MODE_PRIVATE)
  private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
    .connectTimeout(15,TimeUnit.SECONDS).readTimeout(30,TimeUnit.SECONDS).callTimeout(15,TimeUnit.MINUTES).build()
  private var call: Call? = null
  private var epoch = 0L
  private var state = "idle"
  private var bytes = 0L
  private var total: Long? = null
  private var error: String? = null
  private var candidate: JSONObject? = null
  init {
    if(partial.exists())check(partial.delete()) { "UPDATE_STORAGE" }
    try { if(record.baseFile.exists()) candidate = record.openRead().use { input ->
      val raw=java.io.ByteArrayOutputStream();val buffer=ByteArray(4096);while(true){val n=input.read(buffer);if(n<0)break;require(raw.size()+n<=65536) { "UPDATE_METADATA" };raw.write(buffer,0,n)}; JSONObject(raw.toString("UTF-8"))
    }.also { verify(apk,it); state="verified"; bytes=apk.length(); total=it.getLong("bytes") } }
    catch(_:Exception) { clearFiles(); state="failed";error="UPDATE_CACHE_INVALID" }
    val pending=prefs.getInt("sessionId",-1)
    if(pending>=0) { state="installing"; reconcileInstall() }
  }
  @Suppress("DEPRECATION") fun trusted(): Boolean = try {
    val info=context.packageManager.getPackageInfo(context.packageName,signingFlags())
    hex.matches(ReelmBuildConfig.CERTIFICATE_SHA256) && context.packageName == ReelmBuildConfig.PACKAGE_NAME &&
      context.packageName in setOf("org.reelm.drama","org.reelm.drama.pilot") && certificate(info)==ReelmBuildConfig.CERTIFICATE_SHA256
  } catch(_:Exception) { false }
  private fun signingFlags() = if(Build.VERSION.SDK_INT>=28)PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
  private fun metadata(c:JSONObject,network:Boolean) {
    require(c.keys().asSequence().toSet()==setOf("releaseTag","assetName","url","bytes","sha256")) { "UPDATE_METADATA" }
    require(c.getString("releaseTag").length in 1..128 && c.getString("assetName")=="ReelmDrama-arm64-v8a.apk") { "UPDATE_METADATA" }
    val count=c.get("bytes"); require(count is Number && count.toDouble()==count.toLong().toDouble() && count.toLong() in 1..MAX_BYTES) { "UPDATE_SIZE" }
    require(hex.matches(c.getString("sha256"))) { "UPDATE_DIGEST" }
    if(network)safeURL(c.getString("url"),true)
  }
  /** Also used by E2E checks on a locally supplied APK; no production injection endpoint. */
  @Suppress("DEPRECATION") internal fun verify(file:File,c:JSONObject): Long {
    require(trusted()) { "UPDATE_SIGNER" };metadata(c,false)
    require(file.isFile && file.length()==c.getLong("bytes")) { "UPDATE_SIZE" }
    require(digest(file)==c.getString("sha256")) { "UPDATE_DIGEST" }
    val archive=context.packageManager.getPackageArchiveInfo(file.path,signingFlags()) ?: throw IllegalArgumentException("UPDATE_APK")
    require(archive.packageName==context.packageName && archive.packageName==ReelmBuildConfig.PACKAGE_NAME) { "UPDATE_PACKAGE" }
    require((archive.applicationInfo?.flags ?: ApplicationInfo.FLAG_DEBUGGABLE) and ApplicationInfo.FLAG_DEBUGGABLE == 0) { "UPDATE_DEBUGGABLE" }
    require(certificate(archive)==ReelmBuildConfig.CERTIFICATE_SHA256) { "UPDATE_SIGNER" }
    val installed=context.packageManager.getPackageInfo(context.packageName,0)
    val next=code(archive); require(next>code(installed)) { "UPDATE_DOWNGRADE" };return next
  }
  @Synchronized fun status(): Map<String,Any?> { reconcileInstall();return mapOf("state" to state,"bytes" to bytes,"total" to total,"errorCode" to error) }
  private fun clearFiles() { listOf(apk,partial).forEach { if(it.exists())check(it.delete()) { "UPDATE_STORAGE" } };record.delete();candidate=null;bytes=0;total=null }
  @Synchronized fun cancel() {
    require(state!="installing") { "UPDATE_INSTALL_PENDING" };++epoch;call?.cancel();call=null;clearFiles();state="idle";error=null
  }
  @Synchronized internal fun acceptVerifiedFile(file:File,c:JSONObject) {
    verify(file,c);check(file.renameTo(apk)) { "UPDATE_STORAGE" }
    val stream=record.startWrite();try {stream.write(c.toString().toByteArray(Charsets.UTF_8));record.finishWrite(stream)}catch(e:Exception){record.failWrite(stream);throw e}
    candidate=JSONObject(c.toString());bytes=apk.length();total=bytes;state="verified";error=null;call=null
  }
  fun download(c:JSONObject) {
    val generation = synchronized(this) {
      require(trusted()) { "UPDATE_SIGNER" };metadata(c,true);require(state!="downloading" && state!="installing") { "UPDATE_BUSY" }
      clearFiles();state="downloading";error=null;total=c.getLong("bytes");++epoch
    }
    try {
      var url=safeURL(c.getString("url"),true);var hops=0
      while(true) {
        val next=client.newCall(Request.Builder().url(url).header("Accept","application/octet-stream").build())
        synchronized(this) { require(generation==epoch) { "UPDATE_CANCELLED" };call=next }
        next.execute().use { response ->
          if(response.code in setOf(301,302,303,307,308)) {
            require(hops++<5) { "UPDATE_REDIRECT" };val location=response.header("Location") ?: throw IOException("UPDATE_REDIRECT")
            url=safeURL(URI(url).resolve(location).toString());return@use
          }
          require(response.code==200) { "UPDATE_HTTP_${response.code}" }
          val body=requireNotNull(response.body) { "UPDATE_EMPTY" };val expected=c.getLong("bytes")
          require(body.contentLength()<0 || body.contentLength()==expected) { "UPDATE_SIZE" }
          require(root.usableSpace>=expected+16L*1024*1024) { "UPDATE_NO_SPACE" }
          synchronized(this) { require(generation==epoch) { "UPDATE_CANCELLED" };partial.outputStream() }.use { output -> body.byteStream().use { input -> val buffer=ByteArray(65536);var read=0L
            while(true) {val n=input.read(buffer);if(n<0)break;read+=n;require(read<=expected && read<=MAX_BYTES) { "UPDATE_SIZE" }
              synchronized(this) { require(generation==epoch) { "UPDATE_CANCELLED" };output.write(buffer,0,n);bytes=read }
            };require(read==expected) { "UPDATE_SIZE" };output.fd.sync()
          } }
          synchronized(this) { require(generation==epoch) { "UPDATE_CANCELLED" };acceptVerifiedFile(partial,c) };return
        }
      }
    } catch(failure:Exception) {
      synchronized(this) { if(generation==epoch) { call=null;clearFiles();state="failed";error=code(failure) } };throw failure
    }
  }
  private fun code(failure:Exception):String = failure.message?.takeIf { Regex("UPDATE_[A-Z0-9_]+").matches(it) } ?: "UPDATE_NETWORK"
  @Synchronized private fun reconcileInstall() {
    val session=prefs.getInt("sessionId",-1);if(session<0)return
    @Suppress("DEPRECATION") val installed=context.packageManager.getPackageInfo(context.packageName,0)
    if(code(installed)>=prefs.getLong("targetCode",Long.MAX_VALUE)) {prefs.edit().clear().apply();clearFiles();state="idle";error=null;return}
    if(context.packageManager.packageInstaller.getSessionInfo(session)==null) {prefs.edit().clear().apply();state=if(candidate!=null)"verified" else "failed";error="UPDATE_INSTALL_CANCELLED"}
  }
  fun install(activity: Activity) {
    val generation:Long
    val pair=synchronized(this) { require(state=="verified") { "UPDATE_NOT_VERIFIED" };generation=epoch;val c=requireNotNull(candidate);c to verify(apk,c) }
    if(Build.VERSION.SDK_INT>=26 && !context.packageManager.canRequestPackageInstalls()) {
      activity.runOnUiThread { activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:${context.packageName}"))) }
      synchronized(this){if(generation==epoch && state=="verified")error="UPDATE_PERMISSION_REQUIRED"};throw IllegalStateException("UPDATE_PERMISSION_REQUIRED")
    }
    val installer=context.packageManager.packageInstaller
    val params=PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
      setAppPackageName(context.packageName);setSize(pair.first.getLong("bytes"));if(Build.VERSION.SDK_INT>=31)setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
    }
    val sessionId=installer.createSession(params)
    var admitted=false
    try { installer.openSession(sessionId).use { session ->
      // Prevent a queued Cancel/Download from changing bytes after archive verification.
      synchronized(this) { require(generation==epoch && state=="verified" && candidate?.toString()==pair.first.toString()) { "UPDATE_CANCELLED" };verify(apk,pair.first)
        session.openWrite("base.apk",0,pair.first.getLong("bytes")).use { output -> apk.inputStream().use { it.copyTo(output) };session.fsync(output) }
        verify(apk,pair.first);admitted=true;state="installing";error=null;check(prefs.edit().putInt("sessionId",sessionId).putLong("targetCode",pair.second).commit()) { "UPDATE_STORAGE" }
      }
      val intent=Intent(context,ReelmUpdateReceiver::class.java).setAction(context.packageName+".UPDATE_RESULT").putExtra("reelmSession",sessionId)
      val flags=PendingIntent.FLAG_UPDATE_CURRENT or (if(Build.VERSION.SDK_INT>=31)PendingIntent.FLAG_MUTABLE else 0)
      session.commit(PendingIntent.getBroadcast(context,sessionId,intent,flags).intentSender)
    } }catch(failure:Exception) {runCatching {installer.abandonSession(sessionId)};synchronized(this){if(admitted && generation==epoch && prefs.getInt("sessionId",-1) in setOf(-1,sessionId)){prefs.edit().clear().apply();state=if(candidate!=null)"verified" else "failed";error="UPDATE_INSTALL_FAILED"}};throw failure}
  }
  @Synchronized fun result(intent:Intent) {
    val id=intent.getIntExtra("reelmSession",-1);if(id<0 || id!=prefs.getInt("sessionId",-2) || intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID,id)!=id)return
    val status=intent.getIntExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_FAILURE)
    if(status==PackageInstaller.STATUS_PENDING_USER_ACTION) {
      @Suppress("DEPRECATION") val confirmation=intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
      if(confirmation!=null)try {context.startActivity(confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));return}catch(_:Exception){}
      context.packageManager.packageInstaller.abandonSession(id)
    }
    prefs.edit().clear().apply()
    if(status==PackageInstaller.STATUS_SUCCESS){clearFiles();state="idle";error=null}
    else {state=if(candidate!=null)"verified" else "failed";error=if(status==PackageInstaller.STATUS_FAILURE_ABORTED)"UPDATE_INSTALL_CANCELLED" else "UPDATE_INSTALL_FAILED"}
  }
}

class ReelmUpdateReceiver: BroadcastReceiver() {
  override fun onReceive(context:Context,intent:Intent) {
    if(intent.action==context.packageName+".UPDATE_RESULT") ReelmApkUpdater.get(context).result(intent)
  }
}
