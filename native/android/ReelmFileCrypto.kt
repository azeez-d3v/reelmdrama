package expo.modules.video

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.system.Os
import android.system.OsConstants
import android.system.ErrnoException
import java.io.*
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class ResourceRecord internal constructor(
  val version: Int, val downloadId: String, val resourceId: String,
  val plaintextLength: Long, val physicalSize: Long,
  internal val chunks: List<ReelmChunk>, internal val metadataHash: String
)
internal data class ReelmChunk(val length: Int, val nonce: ByteArray)

/** One authenticated chunk at a time. No key material or plaintext files leave this class. */
class ReelmFileCrypto internal constructor(internal val root: File, private val aliasPrefix: String) {
  companion object {
    const val CHUNK = 262144
    const val RESOURCE_MAX = 268435456L
    const val RESERVE = 268435456L
    internal const val VERSION = 1
    internal fun id(): String = ByteArray(16).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it.toInt() and 255) }
    internal fun requireId(id: String) { require(id.matches(Regex("[0-9a-f]{32}"))) { "OFFLINE_ID" } }
    internal fun digest(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
  }
  private val identity: ByteArray
  internal val alias: String
  init {
    check(root.exists() || root.mkdirs()) { "OFFLINE_ROOT" }
    check(root.isDirectory && !OsConstants.S_ISLNK(Os.lstat(root.path).st_mode)) { "OFFLINE_ROOT" }
    val identityFile = child("key-id")
    val existing = identityFile.exists() || File(identityFile.path + ".bak").exists()
    if (!existing) {
      check(root.list()?.isEmpty() == true) { "OFFLINE_KEY_ID_MISSING" }
      identity = ByteArray(16).also { SecureRandom().nextBytes(it) }
      alias = aliasPrefix + digest(identity)
      val keys = keyStore()
      check(!keys.containsAlias(alias)) { "OFFLINE_KEY_COLLISION" }
      val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
      generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
      generator.generateKey()
      atomic(identityFile, identity)
    } else {
      identity = AtomicFile(identityFile).openRead().use { input ->
        val bytes = ByteArray(16); DataInputStream(input).readFully(bytes)
        check(input.read() == -1) { "OFFLINE_KEY_ID_FORMAT" }; bytes
      }
      alias = aliasPrefix + digest(identity)
      key() // Existing data never silently gets a replacement key.
    }
  }
  private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
  internal fun key(): SecretKey = (keyStore().getKey(alias, null) as? SecretKey) ?: error("OFFLINE_KEY_MISSING")
  internal fun child(name: String): File {
    require(name.matches(Regex("[a-z0-9.-]+"))) { "OFFLINE_PATH" }
    check(root.isDirectory && !OsConstants.S_ISLNK(Os.lstat(root.path).st_mode)) { "OFFLINE_ROOT" }
    val file = File(root, name)
    // AtomicFile may promote/read .bak or create .new; guard all exact owned siblings.
    listOf(file, File(file.path + ".bak"), File(file.path + ".new")).forEach {
      check(it.canonicalFile.parentFile == root.canonicalFile) { "OFFLINE_PATH" }
      try { check(!OsConstants.S_ISLNK(Os.lstat(it.path).st_mode)) { "OFFLINE_PATH" } }
      catch (missing: ErrnoException) { if (missing.errno != OsConstants.ENOENT) throw missing }
    }
    return file
  }
  private fun owned(file: File): File = child(file.name).also {
    require(it.absoluteFile == file.absoluteFile) { "OFFLINE_PATH" }
  }
  internal fun payload(downloadId: String, resourceId: String): File {
    requireId(downloadId); requireId(resourceId); return child("$downloadId.$resourceId.bin")
  }
  internal fun metadata(downloadId: String, resourceId: String) = child("${downloadId}.${resourceId}.meta")
  private fun aad(domain: Int, downloadId: String, resourceId: String? = null, index: Int? = null, length: Int? = null): ByteArray {
    requireId(downloadId); if (resourceId != null) requireId(resourceId)
    return ByteArrayOutputStream().also { stream -> DataOutputStream(stream).use { out ->
      out.writeInt(domain); out.writeInt(VERSION); out.write(identity); out.writeUTF(downloadId)
      if (resourceId != null) out.writeUTF(resourceId)
      if (index != null) { out.writeInt(index); out.writeInt(requireNotNull(length)) }
    } }.toByteArray()
  }
  internal fun seal(body: ByteArray, downloadId: String, resourceId: String? = null): ByteArray {
    val domain = if (resourceId == null) 0x52524531 else 0x52524d31
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key()); cipher.updateAAD(aad(domain, downloadId, resourceId))
    val ciphertext = cipher.doFinal(body)
    return ByteArrayOutputStream().also { stream -> DataOutputStream(stream).use { out ->
      out.writeInt(domain); out.writeInt(VERSION); check(cipher.iv.size == 12)
      out.write(cipher.iv); out.writeInt(ciphertext.size); out.write(ciphertext)
    } }.toByteArray()
  }
  internal fun unseal(file: File, downloadId: String, resourceId: String? = null, cap: Int): ByteArray {
    val domain = if (resourceId == null) 0x52524531 else 0x52524d31
    return AtomicFile(owned(file)).openRead().use { stream ->
      val input = DataInputStream(stream)
      check(input.readInt() == domain && input.readInt() == VERSION) { "OFFLINE_FORMAT" }
      val nonce = ByteArray(12); input.readFully(nonce)
      val length = input.readInt(); check(length in 16..(cap + 16)) { "OFFLINE_METADATA_LIMIT" }
      val ciphertext = ByteArray(length); input.readFully(ciphertext); check(input.read() == -1) { "OFFLINE_TRAILING_BYTES" }
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, nonce))
      cipher.updateAAD(aad(domain, downloadId, resourceId)); cipher.doFinal(ciphertext)
    }
  }
  internal fun atomic(file: File, bytes: ByteArray) {
    val atomic = AtomicFile(owned(file)); val stream = atomic.startWrite()
    try { stream.write(bytes); stream.fd.sync(); atomic.finishWrite(stream) }
    catch (failure: Throwable) { atomic.failWrite(stream); throw failure }
  }
  fun write(input: InputStream, target: File, downloadId: String, resourceId: String, maxBytes: Long): ResourceRecord {
    return writeGuarded(input, target, downloadId, resourceId, maxBytes) { publish -> publish() }
  }
  internal fun writeGuarded(input: InputStream, target: File, downloadId: String, resourceId: String, maxBytes: Long,
    commit: (() -> ResourceRecord) -> ResourceRecord): ResourceRecord {
    val expected = payload(downloadId, resourceId)
    require(target.absoluteFile == expected.absoluteFile && maxBytes in 0..RESOURCE_MAX) { "OFFLINE_WRITE_ARGUMENT" }
    val meta = metadata(downloadId, resourceId); val part = child(expected.name + ".part")
    check(!expected.exists() && !meta.exists() && !part.exists()) { "OFFLINE_RESOURCE_EXISTS" }
    val chunks = mutableListOf<ReelmChunk>(); var total = 0L; var committed = false
    try {
      FileOutputStream(part).use { output ->
        val plaintext = ByteArray(CHUNK)
        try {
          while (true) {
            var size = 0
            while (size < CHUNK) {
              val count = input.read(plaintext, size, CHUNK - size)
              if (count < 0) break
              if (count == 0) { val next = input.read(); if (next < 0) break; plaintext[size++] = next.toByte() }
              else size += count
              check(total + size <= maxBytes) { "OFFLINE_RESOURCE_LIMIT" }
            }
            if (size == 0) break
            check(root.usableSpace >= RESERVE + size + 16) { "OFFLINE_SPACE" }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key()); cipher.updateAAD(aad(0x52524331, downloadId, resourceId, chunks.size, size))
            val encrypted = cipher.doFinal(plaintext, 0, size)
            check(cipher.iv.size == 12); output.write(encrypted)
            chunks.add(ReelmChunk(size, cipher.iv.clone())); total += size
            plaintext.fill(0)
          }
          output.fd.sync()
        } finally { plaintext.fill(0) }
      }
      // Verify every generated tag against the finished partial file before publishing metadata.
      RandomAccessFile(part, "r").use { file -> chunks.forEachIndexed { index, chunk -> decrypt(file, downloadId, resourceId, index, chunk).fill(0) } }
      return commit {
        check(part.renameTo(expected)) { "OFFLINE_PAYLOAD_COMMIT" }
        val body = ByteArrayOutputStream().also { stream -> DataOutputStream(stream).use { out ->
          out.writeLong(total); out.writeInt(chunks.size)
          chunks.forEach { out.writeInt(it.length); out.write(it.nonce) }
          out.writeLong(expected.length())
        } }.toByteArray()
        atomic(meta, seal(body, downloadId, resourceId)); val record = load(downloadId, resourceId)
        committed = true; record
      }
    } finally {
      if (part.exists()) check(part.delete())
      if (!committed) { if (expected.exists()) check(expected.delete()); AtomicFile(meta).delete() }
    }
  }
  internal fun load(downloadId: String, resourceId: String): ResourceRecord {
    val file = payload(downloadId, resourceId); val meta = metadata(downloadId, resourceId)
    val body = unseal(meta, downloadId, resourceId, 65536)
    val input = DataInputStream(ByteArrayInputStream(body))
    val total = input.readLong(); val count = input.readInt()
    check(total in 0..RESOURCE_MAX && count == ((total + CHUNK - 1) / CHUNK).toInt()) { "OFFLINE_INVENTORY" }
    val chunks = (0 until count).map { index ->
      val size = input.readInt(); val expected = minOf(CHUNK.toLong(), total - index.toLong() * CHUNK).toInt()
      check(size == expected) { "OFFLINE_CHUNK_LENGTH" }; val nonce = ByteArray(12); input.readFully(nonce); ReelmChunk(size, nonce)
    }
    val payloadSize = input.readLong()
    check(input.read() == -1 && payloadSize == total + count * 16L && file.length() == payloadSize && file.isFile) { "OFFLINE_PAYLOAD_LENGTH" }
    return ResourceRecord(VERSION, downloadId, resourceId, total, payloadSize + meta.length(), chunks, digest(meta.readBytes()))
  }
  private fun decrypt(file: RandomAccessFile, downloadId: String, resourceId: String, index: Int, chunk: ReelmChunk): ByteArray {
    val encrypted = ByteArray(chunk.length + 16); file.readFully(encrypted)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, chunk.nonce))
    cipher.updateAAD(aad(0x52524331, downloadId, resourceId, index, chunk.length))
    return cipher.doFinal(encrypted).also { check(it.size == chunk.length) { "OFFLINE_CHUNK_LENGTH" } }
  }
  fun open(resource: ResourceRecord, offset: Long): InputStream {
    val current = load(resource.downloadId, resource.resourceId)
    check(current.version == resource.version && current.metadataHash == resource.metadataHash &&
      current.plaintextLength == resource.plaintextLength && current.physicalSize == resource.physicalSize) { "OFFLINE_RESOURCE_CHANGED" }
    return reader(current, offset)
  }
  internal fun reader(resource: ResourceRecord, offset: Long): InputStream {
    require(offset in 0..resource.plaintextLength) { "OFFLINE_SEEK" }
    val file = RandomAccessFile(payload(resource.downloadId, resource.resourceId), "r")
    return object : InputStream() {
      var position = offset; var index = -1; var bytes = ByteArray(0); var closed = false
      private fun failed(failure: Throwable): Nothing {
        try { close() } catch (cleanup: Throwable) { if (cleanup !== failure) failure.addSuppressed(cleanup) }
        throw failure
      }
      override fun read(): Int {
        val one = ByteArray(1)
        try { return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 255 } finally { one.fill(0) }
      }
      override fun read(destination: ByteArray, off: Int, len: Int): Int {
        check(!closed) { "OFFLINE_READER_CLOSED" }; require(off >= 0 && len >= 0 && off <= destination.size - len)
        try {
          // Buffered bytes retain live sealed/path/length guards without another Keystore operation.
          val payload = payload(resource.downloadId, resource.resourceId); val meta = metadata(resource.downloadId, resource.resourceId)
          val payloadSize = resource.plaintextLength + resource.chunks.size * 16L
          val sealedSize = resource.physicalSize - payloadSize
          check(sealedSize in 40..65576) { "OFFLINE_RESOURCE_CHANGED" }
          val sealed = AtomicFile(meta).openRead().use { input ->
            ByteArray(sealedSize.toInt()).also { DataInputStream(input).readFully(it); check(input.read() == -1) { "OFFLINE_RESOURCE_CHANGED" } }
          }
          check(payload.isFile && meta.isFile && payload.length() == payloadSize && file.length() == payloadSize &&
            payloadSize + meta.length() == resource.physicalSize && digest(sealed) == resource.metadataHash) { "OFFLINE_RESOURCE_CHANGED" }
          if (len == 0) return 0
          if (position == resource.plaintextLength) return -1
          val next = (position / CHUNK).toInt()
          if (next != index) {
            // Fresh current-key authentication at each chunk; key changes expose at most its remaining bytes.
            val current = load(resource.downloadId, resource.resourceId)
            check(current.version == resource.version && current.metadataHash == resource.metadataHash &&
              current.plaintextLength == resource.plaintextLength && current.physicalSize == resource.physicalSize) { "OFFLINE_RESOURCE_CHANGED" }
            bytes.fill(0); bytes = ByteArray(0); file.seek(next.toLong() * (CHUNK + 16L))
            bytes = decrypt(file, resource.downloadId, resource.resourceId, next, resource.chunks[next]); index = next
          }
          val start = (position % CHUNK).toInt(); val count = minOf(len, bytes.size - start)
          bytes.copyInto(destination, off, start, start + count); position += count; return count
        } catch (failure: Throwable) { failed(failure) }
      }
      override fun close() { if (!closed) { closed = true; bytes.fill(0); bytes = ByteArray(0); index = -1; file.close() } }
    }
  }
}
