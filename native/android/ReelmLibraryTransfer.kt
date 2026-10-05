package expo.modules.video

import android.app.Activity
import android.content.ContentResolver
import android.content.Intent
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.ByteArrayInputStream
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/** User-selected documents carry library/preferences only; imports never write the app store. */
class ReelmLibraryTransfer(private val io: CoroutineScope) {
  private companion object { val codes = AtomicInteger(0x5240) }
  private data class Pending(val code: Int, val bytes: ByteArray?, val resolver: ContentResolver, val continuation: CancellableContinuation<String?>, val received: AtomicBoolean = AtomicBoolean(false))
  private val pending = AtomicReference<Pending?>(null)
  private val destroyed = AtomicBoolean(false)

  suspend fun exportLibrary(activity: Activity, body: String): Boolean = choose(activity, ReelmLibraryStore.encode(body)) != null
  suspend fun importLibrary(activity: Activity): String? = choose(activity, null)

  private suspend fun choose(activity: Activity, bytes: ByteArray?): String? = suspendCancellableCoroutine { continuation ->
    check(!destroyed.get() && !activity.isFinishing && !activity.isDestroyed) { "LIBRARY_TRANSFER_CLOSED" }
    val code = codes.getAndIncrement(); check(code <= 0xffff) { "LIBRARY_TRANSFER_LIMIT" }
    val request = Pending(code, bytes, activity.applicationContext.contentResolver, continuation)
    check(pending.compareAndSet(null, request)) { "LIBRARY_TRANSFER_BUSY" }
    continuation.invokeOnCancellation { if (pending.compareAndSet(request, null)) request.bytes?.fill(0) }
    if (destroyed.get()) { finish(request, Result.success(null)); return@suspendCancellableCoroutine }
    activity.runOnUiThread {
      if (pending.get() === request && continuation.isActive) try {
        val intent = Intent(if (bytes == null) Intent.ACTION_OPEN_DOCUMENT else Intent.ACTION_CREATE_DOCUMENT)
          .addCategory(Intent.CATEGORY_OPENABLE).setType("application/json")
        if (bytes != null) intent.putExtra(Intent.EXTRA_TITLE, "ReelmDrama-library.json")
        @Suppress("DEPRECATION")
        activity.startActivityForResult(intent, code)
      } catch (failure: Throwable) { finish(request, Result.failure(failure)) }
    }
  }

  private fun finish(request: Pending, result: Result<String?>) {
    if (pending.compareAndSet(request, null)) {
      request.bytes?.fill(0); request.continuation.resumeWith(result)
    }
  }

  fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
    val request = pending.get() ?: return false
    if (request.code != requestCode) return false
    if (!request.received.compareAndSet(false, true)) return true
    if (resultCode != Activity.RESULT_OK) { finish(request, Result.success(null)); return true }
    val uri = data?.data
    if (uri?.scheme != "content") { finish(request, Result.failure(IllegalArgumentException("LIBRARY_DOCUMENT_URI"))); return true }
    io.launch {
      try {
        if (pending.get() !== request || !request.continuation.isActive) return@launch
        val bytes = request.bytes
        if (bytes == null) {
          val body = requireNotNull(request.resolver.openInputStream(uri)) { "LIBRARY_DOCUMENT_READ" }.use { ReelmLibraryStore.decode(it) }
          finish(request, Result.success(body))
        } else {
          val expected = ReelmLibraryStore.decode(ByteArrayInputStream(bytes))
          requireNotNull(request.resolver.openOutputStream(uri, "wt")) { "LIBRARY_DOCUMENT_WRITE" }.use { it.write(bytes); it.flush() }
          val actual = requireNotNull(request.resolver.openInputStream(uri)) { "LIBRARY_DOCUMENT_READ" }.use { ReelmLibraryStore.decode(it) }
          check(actual == expected) { "LIBRARY_DOCUMENT_ROUNDTRIP" }; finish(request, Result.success("exported"))
        }
      } catch (failure: Throwable) { finish(request, Result.failure(failure)) }
    }
    return true
  }

  fun destroy() { destroyed.set(true); pending.get()?.let { finish(it, Result.success(null)) } }
}
