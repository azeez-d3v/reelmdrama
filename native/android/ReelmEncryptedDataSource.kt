package expo.modules.video

import android.content.Context
import android.net.Uri
import androidx.media3.common.C
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import java.io.InputStream

/** No upstream, HTTP or cache factory exists in this branch. */
class ReelmEncryptedDataSource internal constructor(private val store: ReelmDownloadStore) : BaseDataSource(false) {
  class Factory internal constructor(private val store: ReelmDownloadStore, private val observer: TransferListener?) : DataSource.Factory {
    constructor(context: Context, observer: TransferListener? = null) : this(ReelmDownloadStore.get(context), observer)
    internal constructor(store: ReelmDownloadStore) : this(store, null)
    override fun createDataSource(): DataSource = ReelmEncryptedDataSource(store).also { source ->
      if (observer != null) {
        // One stable facade per source; sanitize both spec and getUri without breaking HLS relative resolution.
        val facade = object : DataSource by source { override fun getUri(): Uri = Uri.parse("reelm-offline://redacted/resource") }
        fun redacted(spec: DataSpec) = DataSpec.Builder().setUri(facade.uri!!).setPosition(spec.position).setLength(spec.length).build()
        source.addTransferListener(object : TransferListener {
          override fun onTransferInitializing(s: DataSource, spec: DataSpec, network: Boolean) = observer.onTransferInitializing(facade, redacted(spec), false)
          override fun onTransferStart(s: DataSource, spec: DataSpec, network: Boolean) = observer.onTransferStart(facade, redacted(spec), false)
          override fun onBytesTransferred(s: DataSource, spec: DataSpec, network: Boolean, bytes: Int) = observer.onBytesTransferred(facade, redacted(spec), false, bytes)
          override fun onTransferEnd(s: DataSource, spec: DataSpec, network: Boolean) = observer.onTransferEnd(facade, redacted(spec), false)
        })
      }
    }
  }
  private var input: InputStream? = null
  private var currentUri: Uri? = null
  private var remaining = 0L
  private var started = false
  private fun failed(failure: Throwable): Nothing {
    try { close() } catch (cleanup: Throwable) { if (cleanup !== failure) failure.addSuppressed(cleanup) }
    throw failure
  }
  override fun open(spec: DataSpec): Long {
    check(input == null && !started) { "OFFLINE_SOURCE_OPEN" }
    require(spec.httpMethod == DataSpec.HTTP_METHOD_GET && spec.httpBody == null && (spec.httpRequestHeaders.isEmpty() || spec.httpRequestHeaders == mapOf("Icy-MetaData" to "1"))) { "OFFLINE_REQUEST" }
    transferInitializing(spec)
    val opened = store.open(spec.uri, spec.position)
    input = opened.input; currentUri = spec.uri
    remaining = if (spec.length == C.LENGTH_UNSET.toLong()) opened.available else minOf(spec.length, opened.available)
    try { started = true; transferStarted(spec); return remaining }
    catch (failure: Throwable) { failed(failure) }
  }
  override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
    require(offset >= 0 && length >= 0 && offset <= buffer.size - length)
    val stream = input ?: error("OFFLINE_SOURCE_CLOSED")
    if (length == 0) return 0
    if (remaining == 0L) return C.RESULT_END_OF_INPUT
    try {
      val count = stream.read(buffer, offset, minOf(length.toLong(), remaining).toInt())
      check(count > 0) { "OFFLINE_UNEXPECTED_EOF" }; remaining -= count; bytesTransferred(count); return count
    } catch (failure: Throwable) { failed(failure) }
  }
  override fun getUri(): Uri? = currentUri
  override fun close() {
    try { input?.close() } finally {
      input = null; remaining = 0
      try { if (started) { started = false; transferEnded() } } finally { currentUri = null }
    }
  }
}
