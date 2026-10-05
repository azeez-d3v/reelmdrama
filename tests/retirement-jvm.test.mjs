import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const cache=path.join(process.env.GRADLE_USER_HOME??path.join(os.homedir(),'.gradle'),'caches/modules-2/files-2.1');
const jar=(group,name,version)=>{const dir=path.join(cache,group,name,version);if(!fs.existsSync(dir))return null;return fs.readdirSync(dir).flatMap(hash=>fs.readdirSync(path.join(dir,hash)).filter(name=>name.endsWith('.jar')).map(name=>path.join(dir,hash,name)))[0]??null;};
const stdlib=jar('org.jetbrains.kotlin','kotlin-stdlib','2.1.20');
const classpath=[jar('org.jetbrains.kotlin','kotlin-compiler-embeddable','2.1.20'),stdlib,jar('org.jetbrains.kotlin','kotlin-script-runtime','2.1.20'),jar('org.jetbrains.kotlin','kotlin-daemon-embeddable','2.1.20'),jar('org.jetbrains.intellij.deps','trove4j','1.0.20200330'),jar('org.jetbrains','annotations','13.0'),jar('org.jetbrains.kotlinx','kotlinx-coroutines-core-jvm','1.8.0')];
test('actual Kotlin retirement removes only owned media/key and preserves sibling, unknown, corrupt and interrupted data',{skip:classpath.some(file=>!file)},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'reelm-retirement-jvm-'));
 const sources={
  'Context.kt':'package android.content\nimport java.io.File\nclass Context(val noBackupFilesDir: File, val packageName: String)',
  'Os.kt':`package android.system
import java.nio.file.*
import java.nio.file.attribute.BasicFileAttributes
class ErrnoException(val errno: Int): Exception()
class StructStat(val st_mode: Int)
object OsConstants { const val ENOENT=2; fun S_ISDIR(mode:Int)=mode==1; fun S_ISREG(mode:Int)=mode==2 }
// Windows JVM follows directory junctions; this real link receives Android lstat's symbolic-link mode.
object Os { fun lstat(path:String):StructStat { if(path==System.getProperty("reelm.test.symlink")||path==System.getProperty("reelm.test.parent-link"))return StructStat(3);val attr=try{Files.readAttributes(Paths.get(path),BasicFileAttributes::class.java,LinkOption.NOFOLLOW_LINKS)}catch(e:NoSuchFileException){throw ErrnoException(2)};return StructStat(if(attr.isDirectory)1 else if(attr.isRegularFile)2 else 3) } }`,
  'Check.kt':`package expo.modules.video
import java.io.File
import java.security.MessageDigest
fun main(args:Array<String>){
 val parent=File(args[0]);val root=File(parent,"reelmDownloads");val updater=File(parent,"reelmUpdates").apply{mkdir()};val candidate=File(updater,"candidate.apk").apply{writeText("keep updater")};val library=File(parent,"library.json").apply{writeText("keep library")}
 val id="a".repeat(32);val res="b".repeat(32);val name="$id.$res.bin";val prefix="org.reelm.drama.reelm.downloads.";val identity=ByteArray(16){it.toByte()};val expected=prefix+MessageDigest.getInstance("SHA-256").digest(identity).joinToString(""){"%02x".format(it.toInt() and 255)}
 val keys=mutableListOf<String>();fun retire()=ReelmDownloadRetirement.retire(root,prefix){keys.add(it)}
 fun fresh(){check(root.mkdir());File(root,"key-id").writeBytes(identity);File(root,name).writeText("ciphertext")}
 fun reject(block:()->Unit){var failed=false;try{block()}catch(e:Exception){failed=true};check(failed)}
 retire();check(keys.isEmpty());fresh();File(root,"queue.sealed.bak").writeText("queue");retire();check(!root.exists()&&keys==listOf(expected));check(candidate.readText()=="keep updater"&&library.readText()=="keep library");retire();check(keys.size==1)
 fresh();val unknown=File(root,"unknown.txt").apply{writeText("keep unknown")};reject{retire()};check(File(root,name).readText()=="ciphertext"&&unknown.readText()=="keep unknown");check(unknown.delete());retire()
 fresh();File(root,"key-id").writeBytes(byteArrayOf(1));reject{retire()};check(File(root,name).exists());File(root,"key-id").writeBytes(identity);retire()
 fresh();reject{ReelmDownloadRetirement.retire(root,prefix){error("key unavailable")}};check(File(root,"key-id").exists()&&!File(root,name).exists());retire()
 fresh();val nested=File(root,"$id.inventory").apply{mkdir()};val keep=File(nested,"keep").apply{writeText("keep nested")};reject{retire()};check(File(root,name).exists()&&keep.readText()=="keep nested");check(keep.delete()&&nested.delete());retire()
 val other=File(parent,"wrong-root").apply{mkdir()};val otherFile=File(other,name).apply{writeText("keep other")};reject{ReelmDownloadRetirement.retire(other,prefix){error("unexpected key")}};check(otherFile.readText()=="keep other");check(otherFile.delete()&&other.delete())
 fresh();reject{ReelmDownloadRetirement.retire(File(args[1],"reelmDownloads"),prefix){error("unexpected linked key")}};check(File(root,name).readText()=="ciphertext");retire()
 fresh();reject{ReelmDownloadRetirement.retire(File(args[2],"reelmDownloads"),prefix){error("unexpected parent-linked key")}};check(File(root,name).readText()=="ciphertext");retire()
 val ancestor=File(parent,"ancestor");val privateParent=File(ancestor,"no_backup").apply{mkdir()};val aliasedRoot=File(privateParent,"reelmDownloads").apply{mkdir()};File(aliasedRoot,name).writeText("retire ancestor alias");ReelmDownloadRetirement.retire(File(args[3],"no_backup/reelmDownloads"),prefix){error("unexpected absent key")};check(!aliasedRoot.exists()&&privateParent.delete()&&ancestor.delete())
 check(candidate.readText()=="keep updater"&&library.readText()=="keep library");check(candidate.delete()&&updater.delete()&&library.delete());println("RETIREMENT_JVM_PASS: absent, owned, siblings, unknown, corrupt-key, retry, directory, wrong-root, linked-root, linked-parent, platform-ancestor-alias")
}`};
 try{
  for(const [name,body] of Object.entries(sources))fs.writeFileSync(path.join(dir,name),body);
  const output=path.join(dir,'check.jar'),source=path.resolve(import.meta.dirname,'../native/android/ReelmDownloadRetirement.kt');
  const java=process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',process.platform==='win32'?'java.exe':'java'):'java';
  const compiled=spawnSync(java,['-cp',classpath.join(path.delimiter),'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler','-no-stdlib','-no-reflect','-classpath',[stdlib,classpath[5]].join(path.delimiter),'-d',output,source,...Object.keys(sources).map(name=>path.join(dir,name))],{encoding:'utf8',windowsHide:true,timeout:60000});
  assert.equal(compiled.status,0,compiled.stdout+compiled.stderr);
  const fixtures=path.join(dir,'fixture');fs.mkdirSync(fixtures);
  const alias=path.join(dir,'linked-fixture');fs.mkdirSync(alias);fs.symlinkSync(path.join(fixtures,'reelmDownloads'),path.join(alias,'reelmDownloads'),process.platform==='win32'?'junction':'dir');
  const parentAlias=path.join(dir,'linked-parent'),platformAlias=path.join(dir,'platform-alias');fs.mkdirSync(path.join(fixtures,'ancestor'));fs.symlinkSync(fixtures,parentAlias,process.platform==='win32'?'junction':'dir');fs.symlinkSync(path.join(fixtures,'ancestor'),platformAlias,process.platform==='win32'?'junction':'dir');
  const run=spawnSync(java,['-Dreelm.test.symlink='+path.join(alias,'reelmDownloads'),'-Dreelm.test.parent-link='+parentAlias,'-cp',[output,stdlib].join(path.delimiter),'expo.modules.video.CheckKt',fixtures,alias,parentAlias,platformAlias],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(run.status,0,run.stdout+run.stderr);assert.match(run.stdout,/RETIREMENT_JVM_PASS/);
 }finally{
  for(const name of ['linked-fixture/reelmDownloads','linked-parent','platform-alias',...Object.keys(sources),'check.jar','fixture/reelmDownloads/key-id','fixture/reelmDownloads/'+ 'a'.repeat(32)+'.'+'b'.repeat(32)+'.bin','fixture/reelmDownloads/queue.sealed.bak','fixture/reelmDownloads/unknown.txt','fixture/reelmDownloads/'+'a'.repeat(32)+'.inventory/keep','fixture/wrong-root/'+'a'.repeat(32)+'.'+'b'.repeat(32)+'.bin','fixture/ancestor/no_backup/reelmDownloads/'+'a'.repeat(32)+'.'+'b'.repeat(32)+'.bin','fixture/reelmUpdates/candidate.apk','fixture/library.json']){const file=path.join(dir,name);try{fs.lstatSync(file);fs.unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}}
  for(const name of ['linked-fixture','fixture/reelmDownloads/'+'a'.repeat(32)+'.inventory','fixture/reelmDownloads','fixture/wrong-root','fixture/ancestor/no_backup/reelmDownloads','fixture/ancestor/no_backup','fixture/ancestor','fixture/reelmUpdates','fixture']){const file=path.join(dir,name);if(fs.existsSync(file))fs.rmdirSync(file);}fs.rmdirSync(dir);
 }
});
