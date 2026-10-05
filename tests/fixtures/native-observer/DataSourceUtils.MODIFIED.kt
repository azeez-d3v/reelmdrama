package expo.modules.video

import android.content.Context
import android.util.Log
import android.os.SystemClock
import androidx.media3.datasource.TransferListener
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import android.content.pm.ApplicationInfo
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.MediaSource
import expo.modules.video.records.VideoSource
import expo.modules.video.managers.VideoManager
import okhttp3.OkHttpClient

@OptIn(UnstableApi::class)
fun buildBaseDataSourceFactory(context: Context, videoSource: VideoSource): DataSource.Factory {
  return if (videoSource.uri?.scheme?.startsWith("http") == true) {
    buildOkHttpDataSourceFactory(context, videoSource)
  } else {
    DefaultDataSource.Factory(context).setTransferListener(NativeProbeTransferListener())
  }
}

@OptIn(UnstableApi::class)
fun buildOkHttpDataSourceFactory(context: Context, videoSource: VideoSource): OkHttpDataSource.Factory {
  val client = OkHttpClient.Builder().build()

  // If the application name has ANY non-ASCII characters, we need to strip them out. This is because using non-ASCII characters
  // in the User-Agent header can cause issues with getting the media to play.
  val applicationName = getApplicationName(context).filter { it.code in 0..127 }

  val defaultUserAgent = Util.getUserAgent(context, applicationName)

  return OkHttpDataSource.Factory(client).setTransferListener(NativeProbeTransferListener()).apply {
    val headers = videoSource.headers
    headers?.takeIf { it.isNotEmpty() }?.let {
      setDefaultRequestProperties(it)
    }
    val userAgent = headers?.get("User-Agent") ?: defaultUserAgent
    setUserAgent(userAgent)
  }
}

@OptIn(UnstableApi::class)
fun buildCacheDataSourceFactory(context: Context, videoSource: VideoSource): DataSource.Factory {
  return CacheDataSource.Factory().apply {
    setCache(VideoManager.cache.instance)
    setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
    setUpstreamDataSourceFactory(buildBaseDataSourceFactory(context, videoSource))
  }
}

fun buildMediaSourceFactory(context: Context, dataSourceFactory: DataSource.Factory): MediaSource.Factory {
  return DefaultMediaSourceFactory(context).setDataSourceFactory(dataSourceFactory)
}

@OptIn(UnstableApi::class)
fun buildExpoVideoMediaSource(context: Context, videoSource: VideoSource): MediaSource {
  val dataSourceFactory = if (videoSource.useCaching) {
    buildCacheDataSourceFactory(context, videoSource)
  } else {
    buildBaseDataSourceFactory(context, videoSource)
  }
  val mediaSourceFactory = buildMediaSourceFactory(context, dataSourceFactory)
  val mediaItem = videoSource.toMediaItem(context)
  return mediaSourceFactory.createMediaSource(mediaItem)
}

private fun getApplicationName(context: Context): String {
  val applicationInfo: ApplicationInfo = context.applicationInfo
  val stringId = applicationInfo.labelRes
  return if (stringId == 0) applicationInfo.nonLocalizedLabel.toString() else context.getString(stringId)
}

// Test-only observer: request bodies, headers, paths and signed queries are NEVER logged.
@OptIn(UnstableApi::class)
private class NativeProbeTransferListener : TransferListener {
  private data class Sample(val started: Long, val requestScheme: String, val requestHost: String, val kind: String, var bytes: Long = 0)
  private val samples = ConcurrentHashMap<DataSource, Sample>()
  override fun onTransferInitializing(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) {}
  override fun onTransferStart(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) {
    val path = dataSpec.uri.path ?: ""
    val kind = listOf("m3u8", "ts", "m4s", "mp4", "vtt", "key").firstOrNull { path.endsWith("." + it) } ?: "other"
    samples[source] = Sample(SystemClock.elapsedRealtime(), dataSpec.uri.scheme ?: "", dataSpec.uri.host ?: "", kind)
  }
  override fun onBytesTransferred(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean, bytesTransferred: Int) {
    samples[source]?.let { it.bytes += bytesTransferred.toLong() }
  }
  override fun onTransferEnd(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) {
    val sample = samples.remove(source) ?: return
    val uri = source.uri ?: dataSpec.uri
    val row = JSONObject().put("timestamp", System.currentTimeMillis()).put("network", isNetwork)
      .put("scheme", uri.scheme ?: sample.requestScheme).put("host", uri.host ?: sample.requestHost)
      .put("requestHost", sample.requestHost).put("kind", sample.kind).put("bytes", sample.bytes)
      .put("elapsedMs", SystemClock.elapsedRealtime() - sample.started)
    if (source is HttpDataSource) row.put("httpStatus", source.responseCode)
    Log.i("ReelmProbeNet", row.toString())
  }
}
