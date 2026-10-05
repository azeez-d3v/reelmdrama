import React,{useEffect,useState,useRef} from 'react';
import {AppState,FlatList,ScrollView,Modal,View,StyleSheet,Pressable,Alert,useWindowDimensions} from 'react-native';
import {ScaledText as Text} from './ScaledText';
import type {PlaybackPreferences} from '../library-policy';
import {native,type InstalledVersion} from '../native';
import {checkForUpdate,getLastUpdateCheck,downloadUpdate,cancelUpdate,getUpdateStatus,installVerifiedUpdate,type UpdateCheck,type UpdateStatus} from '../updates';
import {listDownloads,downloadStorageBytes,groupDownloads,pauseDownloads,resumeDownloads,cancelDownloads,retryDownloads,type DownloadSummary} from '../downloads';
import {ActionButton,IconButton} from './Primitives';
import {colors,type,layout,radius,type MainTab,type ScreenInsets} from '../theme';
import {BrandedHeader,BottomTabs} from './Navigation';
import {MeasurementProvider,NativeMeasurementRoot} from './measurement';
import {useReducedMotion} from './Motion';
import {safeInset} from './format';

export function DownloadManagementSheet({rows,bytes,error,busy,onRefresh,onAction,onDelete,onWatch,onClose,insets}:{
 rows:readonly DownloadSummary[];bytes:number|null;error:string|null;busy:boolean;onRefresh:()=>void;
 onAction:(work:()=>Promise<void>)=>void;onDelete:(ids:readonly string[])=>void;onWatch:(row:DownloadSummary)=>void;onClose:()=>void;insets:ScreenInsets;
}){
 const {height}=useWindowDimensions(),reducedMotion=useReducedMotion();
 const groups=groupDownloads(rows);
 const entries=groups.flatMap(group=>[{key:'series-'+group.key,group},...group.rows.map(row=>({key:row.id,row}))]);
 const renderGroup=(group:ReturnType<typeof groupDownloads>[number])=><View style={styles.group}><Text style={styles.label}>{group.card.title}</Text><Text style={styles.copy}>{group.card.platform} · {formatBytes(group.bytesStored)} · {group.complete}/{group.rows.length} complete{group.unavailable?` · ${group.unavailable} unavailable`:''}{group.failed?` · ${group.failed} failed`:''}</Text>
  <View style={styles.choices}>
   {group.rows.some(r=>['queued','resolving','downloading','paused'].includes(r.state))?<ActionButton label="Cancel" accessibilityLabel={`Cancel series queue for ${group.card.title}`} tone="quiet" style={styles.compactAction} disabled={busy} testID={`download-series-cancel-${group.key}`} onPress={()=>onAction(()=>cancelDownloads(group.rows.map(r=>r.id)))}/>:null}
   {group.rows.some(r=>r.state==='failed'||r.state==='paused')?<ActionButton label="Retry" accessibilityLabel={`Retry series ${group.card.title}`} tone="quiet" style={styles.compactAction} disabled={busy} testID={`download-series-retry-${group.key}`} onPress={()=>onAction(()=>retryDownloads(group.rows.map(r=>r.id)))}/>:null}
   <ActionButton label="Delete" accessibilityLabel={`Delete series ${group.card.title}`} tone="quiet" style={styles.compactAction} disabled={busy} testID={`download-series-delete-${group.key}`} onPress={()=>onDelete(group.rows.map(r=>r.id))}/>
  </View>
 </View>;
 const renderEpisode=(row:DownloadSummary)=><View style={styles.episode}>
  <View style={styles.episodeInfo}><Text style={styles.label}>Ep {row.episodeNumber}</Text><Text style={styles.copy}>{row.state} · {formatBytes(row.bytesStored)}</Text>{row.state==='downloading'?<Text style={styles.copy}>{formatBytes(row.bytesReceived)} received{row.bytesTotal===null?' · total unknown':` / ${formatBytes(row.bytesTotal)}`}</Text>:null}{row.errorCode?<Text style={styles.error}>{row.errorCode}</Text>:null}</View>
  <View style={styles.choices}>
   {row.state==='complete'?<ActionButton label="Play" accessibilityLabel={`Play episode ${row.episodeNumber} of ${row.card.title} offline`} style={styles.compactAction} disabled={busy} onPress={()=>onWatch(row)} testID={`download-watch-${row.id}`}/>:null}
   {row.state==='failed'||row.state==='paused'?<ActionButton label="Retry" accessibilityLabel={`Retry episode ${row.episodeNumber} of ${row.card.title}`} tone="quiet" style={styles.compactAction} disabled={busy} testID={`download-retry-${row.id}`} onPress={()=>onAction(()=>retryDownloads([row.id]))}/>:null}
   {['queued','resolving','downloading','paused'].includes(row.state)?<ActionButton label="Cancel" accessibilityLabel={`Cancel episode ${row.episodeNumber} of ${row.card.title}`} tone="quiet" style={styles.compactAction} disabled={busy} testID={`download-cancel-${row.id}`} onPress={()=>onAction(()=>cancelDownloads([row.id]))}/>:null}
   <ActionButton label="Delete" accessibilityLabel={`Delete episode ${row.episodeNumber} of ${row.card.title}`} tone="quiet" style={styles.compactAction} disabled={busy} testID={`download-delete-${row.id}`} onPress={()=>onDelete([row.id])}/>
  </View>
 </View>;
 return <MeasurementProvider view="episodes" variant={`downloads/${rows.length}/${busy}`}><Modal transparent visible animationType={reducedMotion?'none':'slide'} onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
  <NativeMeasurementRoot calibrationId="downloads-dialog" style={styles.modalFrame}><Pressable style={styles.backdrop} accessibilityRole="button" accessibilityLabel="Close downloads" onPress={onClose}/>
   <View testID="downloads-panel" style={[styles.sheet,{maxHeight:height-safeInset(insets.top)-16,paddingBottom:Math.max(16,safeInset(insets.bottom))}]}>
    <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>Downloads</Text><IconButton icon="close" label="Close downloads" onPress={onClose} testID="downloads-close"/></View>
    <FlatList testID="downloads-list" data={entries} keyExtractor={entry=>entry.key} initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5} contentContainerStyle={styles.downloadContent} renderItem={({item})=>'group' in item?renderGroup(item.group):renderEpisode(item.row)} ListHeaderComponent={<View style={styles.downloadHeader}>
     <Text style={styles.copy}>{bytes===null?'Reading private storage…':`${formatBytes(bytes)} private storage · includes encrypted overhead`}</Text>
     {error?<Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>:null}
     <View testID="downloads-toolbar" style={styles.toolbar}><IconButton icon="retry" label="Refresh downloads" disabled={busy} onPress={onRefresh} testID="downloads-refresh"/><IconButton icon="pause" label="Pause download queue" disabled={busy} onPress={()=>onAction(pauseDownloads)} testID="downloads-pause"/><IconButton icon="play" label="Resume download queue" disabled={busy} onPress={()=>onAction(resumeDownloads)} testID="downloads-resume"/>{rows.length?<ActionButton label="Delete" accessibilityLabel="Delete all downloads" tone="quiet" style={styles.deleteAll} disabled={busy} testID="downloads-delete-all" onPress={()=>onDelete(rows.map(r=>r.id))}/>:null}</View>
     {!rows.length?<Text style={styles.copy}>No episodes downloaded on this device.</Text>:null}
    </View>}/>
   </View>
  </NativeMeasurementRoot>
 </Modal></MeasurementProvider>;
}

export function SettingsScreen({preferences,onChange,insets,onTabChange,onWatchDownload,onDeleteDownloads,onExportLibrary,onImportLibrary}:{onExportLibrary?:()=>Promise<boolean>;onImportLibrary?:()=>Promise<boolean>;onWatchDownload:(row:DownloadSummary)=>void;onDeleteDownloads:(ids:readonly string[])=>Promise<void>;preferences:PlaybackPreferences;onChange:(value:PlaybackPreferences)=>void;insets:ScreenInsets;onTabChange:(value:MainTab)=>void}){
 const [rows,setRows]=useState<DownloadSummary[]>([]),[bytes,setBytes]=useState<number|null>(null),[downloadError,setDownloadError]=useState<string|null>(null),[actionError,setActionError]=useState<string|null>(null),[busy,setBusy]=useState(false),[downloadsOpen,setDownloadsOpen]=useState(false),alive=useRef(true),loadGeneration=useRef(0),busyRef=useRef(false);busyRef.current=busy;
 const refresh=async()=>{const generation=++loadGeneration.current;try{const [next,total]=await Promise.all([listDownloads(),downloadStorageBytes()]);if(alive.current&&generation===loadGeneration.current){setRows(next);setBytes(total);setDownloadError(null);}}catch{if(alive.current&&generation===loadGeneration.current)setDownloadError('Downloads could not be read. Retry on this device.');}};
 const action=async(work:()=>Promise<void>)=>{setBusy(true);setActionError(null);try{await work();await refresh();}catch{if(alive.current)setActionError('Download action failed. Files may remain; retry on this device.');}finally{if(alive.current)setBusy(false);}};
 const confirmDelete=(ids:readonly string[])=>Alert.alert('Delete encrypted downloads?', 'These episodes will no longer play offline.',[{text:'Keep',style:'cancel'},{text:'Delete',style:'destructive',onPress:()=>void action(()=>onDeleteDownloads(ids))}]);
 useEffect(()=>{alive.current=true;void refresh();const timer=setInterval(()=>{if(!busyRef.current)void refresh();},1000);return()=>{alive.current=false;++loadGeneration.current;clearInterval(timer);};},[]);
 const [transferring,setTransferring]=useState(false),[transferResult,setTransferResult]=useState<string|null>(null),transferBusy=useRef(false);
 const transfer=async(kind:'export'|'import')=>{if(transferBusy.current)return;transferBusy.current=true;setTransferring(true);setTransferResult(null);try{const done=await (kind==='export'?onExportLibrary?.():onImportLibrary?.());if(alive.current)setTransferResult(done?(kind==='export'?'Library export verified. Keep this file before reinstalling.':'Library imported. Saved titles and resume points are restored.'):'Transfer cancelled. Your library is unchanged.');}catch(e){if(alive.current)setTransferResult(e instanceof Error?e.message:'Transfer failed. Your current library is unchanged.');}finally{transferBusy.current=false;if(alive.current)setTransferring(false);}};
 const [version,setVersion]=useState<InstalledVersion|null>(null),[error,setError]=useState(false);
 const versionGeneration=useRef(0);
 const load=()=>{const generation=++versionGeneration.current;setError(false);void native.reelmGetInstalledVersion().then(value=>{if(alive.current&&generation===versionGeneration.current){setVersion(value);setUpdateCheck(previous=>previous?.status==='available'&&previous.releaseTag?.replace(/^v/,'')===value.versionName?{...previous,status:'current',candidate:null}:previous);}}).catch(()=>{if(alive.current&&generation===versionGeneration.current)setError(true);});};
 const [updateCheck,setUpdateCheck]=useState<UpdateCheck|null>(getLastUpdateCheck()),[updateStatus,setUpdateStatus]=useState<UpdateStatus|null>(null),[updateError,setUpdateError]=useState<string|null>(null),[checking,setChecking]=useState(false),[updateAction,setUpdateAction]=useState<string|null>(null);
 const checkController=useRef<AbortController|null>(null),updateGeneration=useRef(0),updateActionRef=useRef<string|null>(null),updateActionEpoch=useRef(0),updateForeground=useRef(AppState.currentState==='active');
 const refreshUpdate=async()=>{const generation=++updateGeneration.current;try{const value=await getUpdateStatus();if(alive.current&&generation===updateGeneration.current){setUpdateStatus(value);setUpdateError(previous=>previous==='Update status could not be read. Retry on this device.'?null:previous);}}catch{if(alive.current&&generation===updateGeneration.current){setUpdateStatus(null);setUpdateError('Update status could not be read. Retry on this device.');}}};
 const check=async()=>{
  if(checkController.current||updateActionRef.current)return;
  const controller=new AbortController();checkController.current=controller;setChecking(true);setUpdateError(null);
  try{const result=await checkForUpdate(controller.signal);if(alive.current&&!controller.signal.aborted)setUpdateCheck(result);}
  catch{if(alive.current&&!controller.signal.aborted){setUpdateCheck(null);setUpdateError('Update check failed. Check your connection or GitHub availability, then retry.');}}
  finally{if(checkController.current===controller)checkController.current=null;if(alive.current)setChecking(false);}
 };
 const updateWork=async(name:string,work:()=>Promise<void>)=>{
  if(updateActionRef.current&&name!=='cancel')return;
  const epoch=++updateActionEpoch.current;++updateGeneration.current;updateActionRef.current=name;setUpdateAction(name);setUpdateError(null);
  try{await work();}catch{if(alive.current&&epoch===updateActionEpoch.current)setUpdateError('Update action failed. Refresh the status and retry on this device.');}
  finally{if(alive.current&&epoch===updateActionEpoch.current)await refreshUpdate();if(epoch===updateActionEpoch.current){updateActionRef.current=null;if(alive.current)setUpdateAction(null);}}
 };
 useEffect(()=>{load();void refreshUpdate();const timer=setInterval(()=>{if(updateForeground.current)void refreshUpdate();},1000);const subscription=AppState.addEventListener('change',state=>{updateForeground.current=state==='active';if(state==='active'){load();void refreshUpdate();}});return()=>{checkController.current?.abort();++versionGeneration.current;++updateGeneration.current;clearInterval(timer);subscription.remove();};},[]);
 const updating=updateStatus?.state==='downloading'||updateStatus?.state==='installing',trusted=version?.updateTrusted===true;
 const offer=updateCheck?.status==='available'&&updateCheck.candidate;
 const progress=updateStatus?.total&&updateStatus.total>0?Math.min(100,Math.round(updateStatus.bytes/updateStatus.total*100)):undefined;
 return <View style={styles.root}><BrandedHeader title="Settings" topInset={insets.top}/><ScrollView testID="settings-scroll" contentContainerStyle={styles.content}>
  <View style={styles.section}><Text style={styles.title}>Playback</Text><Text style={styles.label}>Press-and-hold speed</Text><View style={styles.choices}>{([1.25,1.5,1.75,2] as const).map(value=><Pressable key={value} testID={`settings-speed-${value}`} accessibilityRole="button" accessibilityLabel={`Hold speed ${value} times`} accessibilityState={{selected:preferences.holdSpeed===value}} onPress={()=>onChange({...preferences,holdSpeed:value})} style={[styles.choice,preferences.holdSpeed===value&&styles.selected]}><Text style={styles.label}>{value}×</Text></Pressable>)}</View></View>
  <View style={styles.section}><Text style={styles.title}>Text size</Text><View style={styles.choices}>{([.9,1,1.15,1.3] as const).map(value=><Pressable key={value} testID={`settings-font-${value}`} accessibilityRole="button" accessibilityLabel={`Text size ${Math.round(value*100)} percent`} accessibilityState={{selected:preferences.fontScale===value}} onPress={()=>onChange({...preferences,fontScale:value})} style={[styles.choice,preferences.fontScale===value&&styles.selected]}><Text style={styles.label}>{Math.round(value*100)}%</Text></Pressable>)}</View><Text style={styles.copy}>Your system text size also applies.</Text></View>
  <View style={styles.section}><Text style={styles.title}>Downloads</Text><Text testID="downloads-storage" style={styles.copy}>{bytes===null?'Reading private storage…':`${formatBytes(bytes)} · ${rows.length} episodes on this device`}</Text>{downloadError||actionError?<Text accessibilityLiveRegion="polite" style={styles.error}>{actionError??downloadError}</Text>:null}<ActionButton label="Manage downloads" icon="download" tone="secondary" onPress={()=>{setDownloadsOpen(true);void refresh();}} testID="downloads-open"/></View>
  <View style={styles.section}><Text style={styles.title}>App updates</Text><Text testID="updates-version" style={styles.copy}>{version?`Version ${version.versionName} (${version.versionCode})`:error?'Version could not be read.':'Reading installed version…'}</Text>{error?<ActionButton label="Retry installed version" tone="quiet" onPress={load}/>:null}
   {version&&!trusted?<Text style={styles.copy}>This installation needs the one-time private-signing migration before in-app updates.</Text>:null}
   <Text testID="updates-result" accessibilityLiveRegion="polite" style={styles.copy}>{checking?'Checking GitHub…':updateCheck?updateCheck.status==='available'?`Release ${updateCheck.releaseTag} is available. Download to verify compatibility.`:updateCheck.status==='unverified'?'The latest release is unverified. A unique compatible APK and published SHA256 are required.':updateCheck.releaseTag?'This version matches the latest public release.':'No public update release is available.':'Check GitHub manually for a new release.'}</Text>
   {updateCheck?<Text testID="updates-last-check" style={styles.copy}>Last checked {new Date(updateCheck.checkedAt).toLocaleString()}</Text>:null}
   {updateStatus?.state==='downloading'?<Text testID="updates-progress" accessibilityRole="progressbar" accessibilityLiveRegion="polite" accessibilityValue={progress===undefined?{text:`${formatBytes(updateStatus.bytes)} received`}:{min:0,max:100,now:progress}} style={styles.copy}>{formatBytes(updateStatus.bytes)} received{updateStatus.total===null?' · total unknown':` / ${formatBytes(updateStatus.total)} · ${progress}%`}</Text>:null}
   {updateStatus?.state==='verified'?<Text accessibilityLiveRegion="polite" style={styles.copy}>APK verified on this device. Android will ask you to confirm installation.</Text>:null}
   {updateStatus?.errorCode&&updateStatus.state!=='failed'?<Text accessibilityLiveRegion="polite" style={styles.error}>{updateStatus.errorCode==='UPDATE_PERMISSION_REQUIRED'?'Allow installs for Reelm Drama in Android settings, then tap Install again.':updateStatus.errorCode.endsWith('CANCELLED')?'Installation was cancelled. Tap Install to try again.':`Android did not install the APK (${updateStatus.errorCode}). Tap Install to retry.`}</Text>:null}
   {updateStatus?.state==='installing'?<Text accessibilityLiveRegion="polite" style={styles.copy}>Continue in Android to allow or confirm installation. The installed version will be checked when you return.</Text>:null}
   {updateStatus?.state==='failed'?<Text accessibilityLiveRegion="polite" style={styles.error}>Update failed ({updateStatus.errorCode??'UPDATE_FAILED'}). Check again or retry.</Text>:null}
   {updateError?<Text accessibilityLiveRegion="polite" style={styles.error}>{updateError}</Text>:null}
   <View style={styles.choices}>
    <ActionButton label={checking?'Checking…':'Check'} accessibilityLabel="Check GitHub for app updates" tone="secondary" disabled={checking||!!updateAction||updating} onPress={()=>void check()} testID="updates-check"/>
    {trusted&&offer&&!updating&&updateStatus?.state!=='verified'?<ActionButton label={updateStatus?.state==='failed'?'Retry':'Download'} accessibilityLabel={updateStatus?.state==='failed'?'Retry APK download':'Download and verify app update'} disabled={checking||!!updateAction||updateStatus===null} onPress={()=>void updateWork('download',()=>downloadUpdate(offer))} testID={updateStatus?.state==='failed'?'updates-retry':'updates-download'}/>:null}
    {updateStatus?.state==='downloading'||updateAction==='download'?<ActionButton label="Cancel" accessibilityLabel="Cancel APK download" tone="quiet" disabled={updateAction==='cancel'} onPress={()=>void updateWork('cancel',cancelUpdate)} testID="updates-cancel"/>:null}
    {trusted&&updateStatus?.state==='verified'?<ActionButton label="Install" accessibilityLabel="Install verified APK with Android confirmation" disabled={checking||!!updateAction} onPress={()=>void updateWork('install',installVerifiedUpdate)} testID="updates-install"/>:null}
    {updateStatus===null&&!updating?<ActionButton label="Refresh" accessibilityLabel="Refresh app update status" tone="quiet" onPress={()=>void refreshUpdate()} testID="updates-refresh"/>:null}
   </View>
  </View>
 {onExportLibrary&&onImportLibrary?<View style={styles.section}><Text style={styles.title}>Library transfer</Text><Text style={styles.copy}>Move Saved, Recents and preferences to the privately signed app. Downloaded media stays on this installation.</Text><View style={styles.choices}><ActionButton label="Export" accessibilityLabel="Export library and preferences" testID="library-export" tone="quiet" disabled={transferring} onPress={()=>void transfer('export')}/><ActionButton label="Import" accessibilityLabel="Import library and preferences" testID="library-import" tone="quiet" disabled={transferring} onPress={()=>Alert.alert('Replace library?', 'Import replaces Saved, Recents, progress and preferences. Export first if you want to keep the current library.',[{text:'Cancel',style:'cancel'},{text:'Import',onPress:()=>void transfer('import')}])}/></View>{transferResult?<Text accessibilityLiveRegion="polite" style={styles.copy}>{transferResult}</Text>:null}</View>:null}
 </ScrollView><BottomTabs active="settings" onChange={onTabChange} bottomInset={insets.bottom}/>
 {downloadsOpen?<DownloadManagementSheet rows={rows} bytes={bytes} error={actionError??downloadError} busy={busy} onRefresh={()=>void refresh()} onAction={work=>void action(work)} onDelete={confirmDelete} onWatch={row=>{setDownloadsOpen(false);onWatchDownload(row);}} onClose={()=>setDownloadsOpen(false)} insets={insets}/>:null}
 </View>;
}
const formatBytes=(value:number)=>value<1048576?`${Math.ceil(value/1024)} KiB`:`${(value/1048576).toFixed(1)} MiB`;
const styles=StyleSheet.create({
 root:{flex:1,backgroundColor:colors.background},content:{padding:layout.gutter,gap:28,paddingBottom:32},section:{gap:12},title:{...type.title,color:colors.text},label:{...type.label,color:colors.text},copy:{...type.body,color:colors.secondary},error:{...type.body,color:colors.error},choices:{flexDirection:'row',flexWrap:'wrap',gap:8},choice:{minWidth:64,minHeight:48,padding:12,justifyContent:'center',borderWidth:1,borderColor:colors.line},selected:{borderColor:colors.signal,backgroundColor:colors.surfaceHigh},
 modalFrame:{flex:1,justifyContent:'flex-end',backgroundColor:colors.videoScrim},backdrop:{flex:1},sheet:{backgroundColor:colors.background,borderTopLeftRadius:radius.panel,borderTopRightRadius:radius.panel,overflow:'hidden',flexShrink:1,borderTopWidth:1,borderColor:colors.outline},sheetHeader:{flexDirection:'row',alignItems:'center',paddingLeft:layout.gutter,paddingRight:8,paddingVertical:8,gap:8},sheetTitle:{...type.title,color:colors.text,flex:1,minWidth:0},downloadContent:{paddingHorizontal:layout.gutter,gap:8,paddingBottom:24},downloadHeader:{gap:12,paddingTop:8},toolbar:{flexDirection:'row',alignItems:'center',gap:8},compactAction:{minWidth:layout.touchTarget,paddingHorizontal:10},deleteAll:{minWidth:layout.touchTarget,paddingHorizontal:10,marginLeft:'auto',flexShrink:1},group:{gap:8,borderTopWidth:1,borderTopColor:colors.line,paddingTop:16},episode:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:12,paddingVertical:8},episodeInfo:{flex:1,minWidth:120,gap:4},
});
