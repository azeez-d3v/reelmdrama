import test from 'node:test';
import assert from 'node:assert/strict';
import {componentHarness, byID, nodes} from '../tests/ui-harness.mjs';
import * as theme from '../theme.ts';
import {formatTime, safeInset} from './format.ts';

const sheetBoundaries = {'./ScaledText':{ScaledText:'Text'}, '../theme':theme,
  '../updates':{getLastUpdateCheck:()=>null,getUpdateStatus:async()=>({state:'idle',bytes:0,total:null,errorCode:null})},
  './Primitives':{ActionButton:'ActionButton',IconButton:'IconButton',StatePanel:'StatePanel'},
  './format':{formatTime,safeInset}, './Motion':{useReducedMotion:()=>false},
  './measurement':{MeasurementProvider:'Measurements',NativeMeasurementRoot:'MeasurementRoot',useNativeMeasurement:()=>({})},
  'react-native':{FlatList:'FlatList',Image:'Image',Modal:'Modal',ScrollView:'ScrollView',useWindowDimensions:()=>({height:800,width:360}),AppState:{currentState:'active',addEventListener:()=>({remove(){}})}}};
const expand = tree => {
  if (!tree || typeof tree !== 'object') return tree;
  if (typeof tree.type === 'function' && tree.type.name === 'DownloadChooser') return expand(tree.type(tree.props));
  return {...tree,props:{...tree.props,children:[...(tree.props.children??[]).flat(Infinity),tree.props.ListHeaderComponent].filter(Boolean).map(expand)}};
};
const story={id:'12',slug:'fixture',platform:'DramaBox',title:'Stored story',totalEpisodes:5000,
  episodes:Array.from({length:5000},(_,i)=>({number:i+1,advertisedAvailable:i!==2})),cover:null,description:'Synopsis'};

test('story footer groups watch, save and icon-only download; chooser owns download actions',()=>{
  const h=componentHarness('../ui/Sheets.tsx',sheetBoundaries);
  const calls=[];
  const props={detail:story,loading:false,error:null,saved:false,bottomInset:24,topInset:28,
    onWatch:()=>calls.push('watch'),onClose:()=>calls.push('close'),onWatchEpisode:n=>calls.push(['watch',n]),
    onToggleSave:()=>calls.push('save'),onRetry(){},onDownloadEpisode:n=>calls.push(['download',n]),onDownloadSeries:()=>calls.push('series')};
  try {
    let tree=h.render('SeriesDetailSheet',props);
    const watch=byID(tree,'details-watch'),save=byID(tree,'details-save'),download=byID(tree,'details-download');
    assert(download,'download icon must sit beside Watch and Save');
    assert.equal(download.type,'IconButton');assert.equal(download.props.icon,'download');
    assert.equal(download.props.label,'Download episodes');
    const footer=nodes(tree).find(n=>n.props.children?.includes(watch)&&n.props.children?.includes(save)&&n.props.children?.includes(download));
    assert(footer);assert.deepEqual(footer.props.children.filter(Boolean).map(n=>n.props.testID),['details-watch','details-save','details-download']);
    assert.equal(watch.props.style.flex,1);assert.equal(watch.props.style.minWidth,0);
    assert(!byID(tree,'details-download-series'));assert(!byID(tree,'downloads-choice-list'));
    const list=nodes(tree).find(n=>n.type==='FlatList');
    assert(!nodes(list.props.ListHeaderComponent).some(n=>n.props.label==='Download whole series'));
    const key=list.props.renderItem({item:story.episodes[0]});
    assert.equal(key.props.onDownload,undefined,'ordinary episode grid has no secondary download button');
    watch.props.onPress();save.props.onPress();assert.deepEqual(calls,['watch','save']);
    download.props.onPress();tree=expand(h.render('SeriesDetailSheet',props));
    assert.equal(nodes(tree).filter(n=>n.type==='Modal').length,1,'chooser replaces content inside same native Modal');
    const choices=byID(tree,'downloads-choice-list');assert(choices);assert.equal(choices.props.data.length,5000);
    assert(choices.props.initialNumToRender<=24);assert(nodes(tree).length<100);
    assert.equal(byID(tree,'details-watch'),undefined,'watch footer stays outside download chooser');
    const selected=choices.props.renderItem({item:story.episodes[1]});
    const tileHarness=componentHarness('../ui/Sheets.tsx',sheetBoundaries,['EpisodeKey']);
    try {const tile=tileHarness.render('EpisodeKey',selected.props),pick=byID(tile,'episode-download-2');assert.equal(pick.props.accessibilityLabel,'Download episode 2');pick.props.onPress();}
    finally {tileHarness.cleanup();}
    assert.deepEqual(calls.at(-1),['download',2]);
  } finally {h.cleanup();}
  const whole=componentHarness('../ui/Sheets.tsx',sheetBoundaries);
  try {
    byID(whole.render('SeriesDetailSheet',props),'details-download').props.onPress();
    let tree=expand(whole.render('SeriesDetailSheet',props));byID(tree,'downloads-choice-series').props.onPress();
    assert.equal(calls.at(-1),'series');assert(!byID(expand(whole.render('SeriesDetailSheet',props)),'downloads-choice-list'));
    assert(!byID(whole.render('SeriesDetailSheet',{...props,offline:true}),'details-download'));
  } finally {whole.cleanup();}
});

test('player episode selector keeps playback selection and discloses downloads through one icon',()=>{
  const h=componentHarness('../ui/Sheets.tsx',sheetBoundaries),tileHarness=componentHarness('../ui/Sheets.tsx',sheetBoundaries,['EpisodeKey']);const calls=[];
  const props={episodes:story.episodes,currentEpisode:2,onSelect:n=>calls.push(['play',n]),onClose(){},
    onDownload:n=>calls.push(['download',n]),onDownloadSeries:()=>calls.push('series'),bottomInset:24};
  try {
    let tree=h.render('EpisodeSheet',props),list=nodes(tree).find(n=>n.type==='FlatList');
    const ordinary=list.props.renderItem({item:story.episodes[0]});const tile=tileHarness.render('EpisodeKey',ordinary.props);
    byID(tile,'episode-1').props.onPress();assert.deepEqual(calls,[['play',1]]);assert(!byID(tile,'episode-download-1'));
  } finally {h.cleanup();tileHarness.cleanup();}
  const mode=componentHarness('../ui/Sheets.tsx',sheetBoundaries);
  try {
    byID(mode.render('EpisodeSheet',props),'episodes-download').props.onPress();
    let tree=expand(mode.render('EpisodeSheet',props));assert(byID(tree,'downloads-choice-list'));
    assert.equal(nodes(tree).filter(n=>n.type==='Modal').length,1);
    byID(tree,'downloads-choice-back').props.onPress();tree=expand(mode.render('EpisodeSheet',props));
    assert(!byID(tree,'downloads-choice-list'));assert.equal(nodes(tree).find(n=>n.type==='FlatList').props.data.length,5000);
    assert(!byID(mode.render('EpisodeSheet',{...props,offline:true}),'episodes-download'));
  } finally {mode.cleanup();}
});

test('Settings reveals download management only on demand and keeps a compact version line',async()=>{
  const h=componentHarness('../ui/SettingsScreen.tsx',{...sheetBoundaries,'./ScaledText':{ScaledText:'Text'},'../theme':theme,
    './Primitives':{ActionButton:'ActionButton',IconButton:'IconButton'},'./Navigation':{BrandedHeader:'Header',BottomTabs:'Tabs'},
    './Motion':{useReducedMotion:()=>false},'./format':{safeInset},
    './measurement':{MeasurementProvider:'Measurements',NativeMeasurementRoot:'MeasurementRoot'},
    '../downloads':{listDownloads:async()=>[],downloadStorageBytes:async()=>4000,groupDownloads:()=>[]},
    '../native':{native:{reelmGetInstalledVersion:async()=>({versionName:'0.1.0',versionCode:1,packageName:'org.reelm.drama'})}},
    'react-native':{...sheetBoundaries['react-native'],FlatList:'FlatList',ScrollView:'ScrollView',Modal:'Modal',useWindowDimensions:()=>({height:800,width:360})}});
  const watched=[];
  const props={preferences:{holdSpeed:1.5,fontScale:1},insets:{top:28,bottom:24},onChange(){},onTabChange(){},onWatchDownload:row=>watched.push(row.id),onDeleteDownloads:async()=>{}};
  try {
    h.render('SettingsScreen',props);await new Promise(setImmediate);let tree=h.render('SettingsScreen',props);
    assert(!byID(tree,'downloads-list'),'download list must not crowd the Settings page');
    for(const id of ['downloads-refresh','downloads-delete-all'])assert(!byID(tree,id));
    assert(byID(tree,'downloads-storage'));assert(byID(tree,'settings-speed-1.5'));assert(byID(tree,'settings-font-1'));
    assert(!nodes(tree).some(n=>n.type==='Text'&&n.props.children.join('').includes('org.reelm.drama')));
    byID(tree,'downloads-open').props.onPress();tree=h.render('SettingsScreen',props);
    const modal=nodes(tree).find(n=>typeof n.type==='function'&&n.type.name==='DownloadManagementSheet');assert(modal);
    const opened=expand(modal.type(modal.props));assert(byID(opened,'downloads-list'));assert(byID(opened,'downloads-refresh'));
    const root=nodes(opened).find(n=>n.type==='MeasurementRoot');assert.equal(root.props.calibrationId,'downloads-dialog');
    const panel=byID(opened,'downloads-panel');assert.equal(panel.props.style[1].paddingBottom,24);assert.equal(panel.props.style[1].maxHeight,756);
    byID(opened,'downloads-close').props.onPress();assert(!nodes(h.render('SettingsScreen',props)).some(n=>typeof n.type==='function'&&n.type.name==='DownloadManagementSheet'));
    byID(h.render('SettingsScreen',props),'downloads-open').props.onPress();
    const again=nodes(h.render('SettingsScreen',props)).find(n=>typeof n.type==='function'&&n.type.name==='DownloadManagementSheet');
    again.props.onWatch({id:'completed-episode'});assert.deepEqual(watched,['completed-episode']);
    assert(!nodes(h.render('SettingsScreen',props)).some(n=>typeof n.type==='function'&&n.type.name==='DownloadManagementSheet'),'close sheet before offline selection starts');
  } finally {h.cleanup();}
});

test('download manager uses compact scoped actions, preserving queue, watch and delete dispatch',async()=>{
  const calls=[], card={id:'12',slug:'fixture',platform:'DramaBox',title:'Stored story'};
  const rows=['complete','downloading','paused','failed','unreadable','queued','resolving','deleting'].map((state,i)=>({id:String(i),card,episodeNumber:i+1,state,bytesStored:1000,bytesReceived:500,bytesTotal:1000,errorCode:state==='failed'?'DOWNLOAD_FAILED':null}));
  const group={key:'series',card,rows,bytesStored:8000,complete:1,failed:2,unavailable:0};
  const h=componentHarness('../ui/SettingsScreen.tsx',{
    ...sheetBoundaries,'./Navigation':{BrandedHeader:'Header',BottomTabs:'Tabs'},'../native':{native:{}},'../downloads':{groupDownloads:()=>[group],
      pauseDownloads:async()=>calls.push('pause'),resumeDownloads:async()=>calls.push('resume'),
      cancelDownloads:async ids=>calls.push(['cancel',Array.from(ids)]),retryDownloads:async ids=>calls.push(['retry',Array.from(ids)])}});
  const props={rows,bytes:8000,error:null,busy:false,insets:{top:28,bottom:24},
    onRefresh:()=>calls.push('refresh'),onAction:work=>work(),onWatch:row=>calls.push(['watch',row.id]),
    onDelete:ids=>calls.push(['delete',Array.from(ids)]),onClose(){}};
  const contents=busy=>{const tree=h.render('DownloadManagementSheet',{...props,busy}),list=byID(tree,'downloads-list');return {type:'View',props:{children:[tree,list.props.ListHeaderComponent,...list.props.data.map(item=>list.props.renderItem({item}))]}};};
  try {
    const tree=contents(false),toolbar=byID(tree,'downloads-toolbar');assert(toolbar);
    assert.equal(toolbar.props.style.flexDirection,'row');assert.equal(toolbar.props.style.gap,8);
    for(const [id,icon,label] of [['downloads-refresh','retry','Refresh downloads'],['downloads-pause','pause','Pause download queue'],['downloads-resume','play','Resume download queue']]){
      const control=byID(tree,id);assert.equal(control.type,'IconButton');assert.equal(control.props.icon,icon);assert.equal(control.props.label,label);
      await control.props.onPress();
    }
    assert.deepEqual(calls,['refresh','pause','resume']);
    assert.equal(byID(tree,'downloads-delete-all').props.label,'Delete');
    assert.equal(byID(tree,'downloads-delete-all').props.accessibilityLabel,'Delete all downloads');
    const actions=nodes(tree).filter(n=>n.type==='ActionButton');
    assert(actions.every(n=>!n.props.label.includes(' ')),'visible action labels must be single words');
    assert(actions.every(n=>n.props.accessibilityLabel),'short labels retain unambiguous spoken scopes');
    for(const [id,expected] of [['download-series-cancel-series',['cancel',rows.map(r=>r.id)]],['download-series-retry-series',['retry',rows.map(r=>r.id)]],['download-series-delete-series',['delete',rows.map(r=>r.id)]],['download-watch-0',['watch','0']],['download-retry-2',['retry',['2']]],['download-cancel-1',['cancel',['1']]],['download-delete-0',['delete',['0']]],['downloads-delete-all',['delete',rows.map(r=>r.id)]]]){
      await byID(tree,id).props.onPress();assert.deepEqual(calls.at(-1),expected);
    }
    for(const row of rows){
      assert.equal(Boolean(byID(tree,`download-watch-${row.id}`)),row.state==='complete');
      assert.equal(Boolean(byID(tree,`download-retry-${row.id}`)),['failed','paused'].includes(row.state));
      assert.equal(Boolean(byID(tree,`download-cancel-${row.id}`)),['queued','resolving','downloading','paused'].includes(row.state));
      assert(byID(tree,`download-delete-${row.id}`));
    }
    const disabled=contents(true);assert(nodes(disabled).filter(n=>['ActionButton','IconButton'].includes(n.type)&&n.props.testID!=='downloads-close').every(n=>n.props.disabled));
    group.rows=[rows[0]];group.complete=1;group.failed=0;
    const complete=contents(false);assert(!byID(complete,'download-series-cancel-series'));assert(!byID(complete,'download-series-retry-series'));
    assert(byID(complete,'download-series-delete-series'));
  } finally {h.cleanup();}
});

test('short button copy keeps its full accessibility scope and the existing 48dp target',()=>{
  const h=componentHarness('../ui/Primitives.tsx',{'./ScaledText':{ScaledText:'Text'},'../theme':theme,
    './Icon':{Icon:'Icon'},'./measurement':{useNativeMeasurement:()=>({})},
    './Motion':{usePressFeedback:()=>({scale:1}),LoadingSignal:'Signal'},'react-native':{Animated:{View:'AnimatedView'}}});
  try {
    const tree=h.render('ActionButton',{label:'Delete',accessibilityLabel:'Delete episode 20 of Stored story',tone:'quiet',onPress(){}});
    assert.equal(tree.props.accessibilityLabel,'Delete episode 20 of Stored story');
    assert.equal(tree.props.style({pressed:false})[0].minHeight,48);
    assert(nodes(tree).some(n=>n.type==='Text'&&n.props.children[0]==='Delete'));
    assert.equal(h.render('ActionButton',{label:'Watch',onPress(){}}).props.accessibilityLabel,'Watch');
    const icon=h.render('IconButton',{icon:'pause',label:'Pause download queue',onPress(){}});
    const bounds=icon.props.style({pressed:false})[0];assert.equal(bounds.minWidth,48);assert.equal(bounds.minHeight,48);
  } finally {h.cleanup();}
});
