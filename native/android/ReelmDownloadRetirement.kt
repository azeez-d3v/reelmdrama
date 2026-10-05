package expo.modules.video

import android.content.Context
import android.system.Os
import android.system.OsConstants
import android.system.ErrnoException
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest

/** Upgrade-only retirement of the former flat, app-private episode store. */
internal object ReelmDownloadRetirement {
  private val ownedName = Regex("(?:(?:key-id|queue\\.sealed|[a-f0-9]{32}\\.inventory)(?:\\.(?:bak|new))?|[a-f0-9]{32}\\.[a-f0-9]{32}\\.(?:bin(?:\\.part)?|meta(?:\\.(?:bak|new))?))")
  fun retire(context: Context) {
    retire(File(context.noBackupFilesDir, "reelmDownloads"), context.packageName + ".reelm.downloads.") { alias ->
      val keys = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      if (keys.containsAlias(alias)) keys.deleteEntry(alias)
    }
  }
  internal fun retire(root: File, aliasPrefix: String, removeKey: (String) -> Unit) {
    val stat = try { Os.lstat(root.path) } catch (missing: ErrnoException) {
      if (missing.errno == OsConstants.ENOENT) return else throw missing
    }
    val parent = requireNotNull(root.parentFile) { "RETIREMENT_ROOT" }
    check(root.name == "reelmDownloads" && OsConstants.S_ISDIR(stat.st_mode) &&
      OsConstants.S_ISDIR(Os.lstat(parent.path).st_mode) &&
      root.canonicalFile.parentFile == parent.canonicalFile) { "RETIREMENT_ROOT" }
    val files = requireNotNull(root.listFiles()) { "RETIREMENT_STORAGE" }.toList()
    files.forEach { file ->
      check(ownedName.matches(file.name) && file.canonicalFile.parentFile == root.canonicalFile &&
        OsConstants.S_ISREG(Os.lstat(file.path).st_mode)) { "RETIREMENT_UNKNOWN_FILE" }
    }
    val keyFiles = files.filter { it.name in listOf("key-id", "key-id.bak", "key-id.new") }
    val keyIdentity = keyFiles.firstOrNull { it.name == "key-id.bak" }
      ?: keyFiles.firstOrNull { it.name == "key-id" }
      ?: keyFiles.firstOrNull()
    val alias = keyIdentity?.let { file ->
      check(file.length() == 16L) { "RETIREMENT_KEY_ID" }
      val bytes = file.readBytes()
      check(bytes.size == 16) { "RETIREMENT_KEY_ID" }
      aliasPrefix + MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
    }
    // Keep identity until both payload retirement and exact-key retirement succeed.
    files.filter { it !in keyFiles }.forEach { file -> check(file.delete()) { "RETIREMENT_DELETE" } }
    if (alias != null) removeKey(alias)
    keyFiles.forEach { file -> check(file.delete()) { "RETIREMENT_DELETE" } }
    check(root.delete()) { "RETIREMENT_DELETE" }
  }
}
