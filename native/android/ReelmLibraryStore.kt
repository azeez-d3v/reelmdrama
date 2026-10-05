package expo.modules.video

import android.util.AtomicFile
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileNotFoundException
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CodingErrorAction

class ReelmLibraryStore(private val file: File) {
  companion object {
    const val CAP = 2097152; private val lock = Any()
    fun encode(body: String): ByteArray {
      require(body.length <= CAP) { "LIBRARY_BYTE_CAP" }
      val encoded = Charsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).encode(CharBuffer.wrap(body))
      require(encoded.remaining() <= CAP) { "LIBRARY_BYTE_CAP" }
      return ByteArray(encoded.remaining()).also { encoded.get(it) }
    }
    fun decode(input: InputStream): String {
      val result = ByteArrayOutputStream(); val buffer = ByteArray(8192)
      while (true) {
        val count = input.read(buffer); if (count < 0) break; require(count > 0) { "LIBRARY_READ_STALLED" }
        require(result.size() + count <= CAP) { "LIBRARY_BYTE_CAP" }; result.write(buffer, 0, count)
      }
      return Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(result.toByteArray())).toString()
    }
  }
  fun read(): String? = synchronized(lock) {
    val atomic = AtomicFile(file)
    val input = try { atomic.openRead() } catch (error: FileNotFoundException) {
      if (!file.exists() && !File(file.path + ".bak").exists()) return@synchronized null
      throw error
    }
    input.use { decode(it) }
  }
  fun write(body: String) = synchronized(lock) {
    val bytes = encode(body)
    val atomic = AtomicFile(file)
    val output = atomic.startWrite()
    try { output.write(bytes); atomic.finishWrite(output) }
    catch (error: Throwable) { atomic.failWrite(output); throw error }
  }
}
