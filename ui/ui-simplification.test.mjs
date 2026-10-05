import test from 'node:test';
import assert from 'node:assert/strict';
import {componentHarness,byID,nodes} from '../tests/ui-harness.mjs';
import * as theme from '../theme.ts';
import {formatTime,safeInset} from './format.ts';

const navigation={'./ScaledText':{ScaledText:'Text'},'../theme':theme,'./Icon':{Icon:'Icon',ReelmMark:'Mark'},
  './Primitives':{IconButton:'IconButton'},'./format':{safeInset},'./measurement':{useNativeMeasurement:()=>({})},'./Motion':{AnimatedPresence:'Presence'}};
const sheet={'./ScaledText':{ScaledText:'Text'},'../theme':theme,'./Primitives':{ActionButton:'ActionButton',IconButton:'IconButton',StatePanel:'StatePanel'},
  './format':{formatTime,safeInset},'./Motion':{useReducedMotion:()=>false},
  './measurement':{MeasurementProvider:'Measurements',NativeMeasurementRoot:'MeasurementRoot',useNativeMeasurement:()=>({})},
  'react-native':{FlatList:'FlatList',Image:'Image',Modal:'Modal',ScrollView:'ScrollView',useWindowDimensions:()=>({height:800,width:360})}};
const story={id:'12',slug:'fixture',platform:'DramaBox',title:'Story',totalEpisodes:5000,episodes:Array.from({length:5000},(_,i)=>({number:i+1,advertisedAvailable:i!==2})),cover:null,description:'Synopsis'};
const words=tree=>nodes(tree).filter(n=>n.type==='Text').map(n=>n.props.children.flat().join('')).join('\n');

test('three bottom tabs navigate Home, Library and Settings without a redundant header search action',()=>{
  const h=componentHarness('../ui/Navigation.tsx',navigation,['NavigationTab']),calls=[];
  try{
    const tree=h.render('BottomTabs',{active:'saved',onChange:t=>calls.push(t),bottomInset:24});
    const tabs=nodes(tree).filter(n=>typeof n.type==='function');
    assert.deepEqual(tabs.map(n=>n.props.tab.key),['home','saved','settings']);
    for(const tab of tabs){const button=h.render('NavigationTab',tab.props);button.props.onPress();assert.equal(button.props.accessibilityState.selected,tab.props.tab.key==='saved');}
    assert.deepEqual(calls,['home','saved','settings']);
    const header=h.render('BrandedHeader',{topInset:24,onSearch:()=>calls.push('search')});
    assert(!byID(header,'navigation-search'));
  }finally{h.cleanup();}
});

test('Home owns inline search and platform filters while Library preserves collection and resume actions',()=>{
  const h=componentHarness('../ui/CatalogueScreen.tsx',{'./ScaledText':{ScaledText:'Text',ScaledTextInput:'TextInput'},'../theme':theme,
    './Icon':{Icon:'Icon'},'./Navigation':{BrandedHeader:'Header',BottomTabs:'Tabs'},'./Primitives':{ActionButton:'ActionButton',IconButton:'IconButton',StatePanel:'StatePanel'},
    './format':{formatTime,safeInset},'./measurement':{MeasurementProvider:'Measurements'},'./Motion':{useAppActive:()=>true},
    'react-native':{FlatList:'FlatList',Image:'Image',RefreshControl:'RefreshControl',ScrollView:'ScrollView',useWindowDimensions:()=>({width:360})}}),calls=[];
  const card={...story,totalEpisodes:10};
  const props={tab:'home',items:[card],platforms:[{name:'DramaBox'}],savedIds:new Set(),insets:{top:24,bottom:24},query:'',selectedPlatform:null,
    onQueryChange:q=>calls.push(['query',q]),onSearchSubmit:()=>calls.push('search'),onPlatformChange:p=>calls.push(['platform',p]),onTabChange:t=>calls.push(['tab',t]),
    onWatch:c=>calls.push(['watch',c.id]),onOpenSeries:c=>calls.push(['detail',c.id]),onCollectionChange:c=>calls.push(['collection',c])};
  try{
    let tree=h.render('CatalogueScreen',props),list=byID(tree,'catalogue-grid'),header=list.props.ListHeaderComponent;
    const branded=nodes(tree).find(n=>n.type==='Header');assert.equal(branded.props.onSearch,undefined);
    byID(header,'catalogue-search-input').props.onChangeText('Story');byID(header,'catalogue-search-submit').props.onPress();
    const platform=nodes(header).find(n=>typeof n.type==='function'&&n.props.name==='DramaBox');platform.props.onChange(platform.props.name);
    assert.deepEqual(calls.splice(0),[['query','Story'],'search',['platform','DramaBox']]);
    tree=h.render('CatalogueScreen',{...props,query:'Story',selectedPlatform:'DramaBox'});list=byID(tree,'catalogue-grid');assert.equal(list.props.data.length,1,'filtered Home must not hide the first result behind a feature');
    tree=h.render('CatalogueScreen',{...props,tab:'saved',collection:'recents',progress:{fixture:{episode:20,time:32}}});list=byID(tree,'catalogue-grid');header=list.props.ListHeaderComponent;
    assert(!byID(header,'catalogue-search-input'));byID(header,'library-recents').props.onPress();
    const poster=list.props.renderItem({item:card});poster.props.onOpen(card);assert.equal(poster.props.progress.episode,20);
    assert.deepEqual(calls,[['collection','recents'],['watch','12']]);
  }finally{h.cleanup();}
});

test('episode and story sheets retain bounded playback/save/resume actions with no download controls',()=>{
  const h=componentHarness('../ui/Sheets.tsx',sheet,['EpisodeKey']),calls=[];
  const props={detail:story,loading:false,error:null,saved:false,progress:{episode:2,time:32},onWatch:()=>calls.push('watch'),onClose(){},onWatchEpisode:n=>calls.push(['play',n]),onToggleSave:()=>calls.push('save'),onRetry(){},onDownloadEpisode(){},onDownloadSeries(){}};
  try{
    let tree=h.render('SeriesDetailSheet',props),watch=byID(tree,'details-watch');assert.match(watch.props.label,/Resume.*Ep 2.*0:32/);watch.props.onPress();byID(tree,'details-save').props.onPress();
    assert.deepEqual(calls,['watch','save']);assert(!byID(tree,'details-download'));assert(!byID(tree,'downloads-choice-list'));
    let list=nodes(tree).find(n=>n.type==='FlatList');assert.equal(list.props.data.length,5000);assert(list.props.initialNumToRender<=24);assert(nodes(tree).length<100);
    tree=h.render('EpisodeSheet',{episodes:story.episodes,currentEpisode:2,onSelect:n=>calls.push(['play',n]),onClose(){},onDownload(){},onDownloadSeries(){}});
    assert(!byID(tree,'episodes-download'));list=nodes(tree).find(n=>n.type==='FlatList');
    for(const n of [1,3]){const item=list.props.renderItem({item:story.episodes[n-1]}),key=byID(h.render('EpisodeKey',item.props),`episode-${n}`);assert.equal(key.props.disabled,n===3);if(!key.props.disabled)key.props.onPress();}
    assert.deepEqual(calls.at(-1),['play',1]);
    tree=h.render('SeriesDetailSheet',{...props,progress:{episode:3,time:32}});assert.equal(byID(tree,'details-watch').props.disabled,true,'missing resume episode still requires explicit selection');
  }finally{h.cleanup();}
});

test('Settings has subtitle-only preview and filled transfer buttons without reading offline storage',async()=>{
  let reads=0;const calls=[];
  const h=componentHarness('../ui/SettingsScreen.tsx',{'./ScaledText':{ScaledText:'Text',FontScaleContext:{Provider:'FontScale'}},'./SubtitleOverlay':{SubtitleOverlay:'SubtitleOverlay'},'../theme':theme,
    './Primitives':{ActionButton:'ActionButton',IconButton:'IconButton'},'./Navigation':{BrandedHeader:'Header',BottomTabs:'Tabs'},'./format':{safeInset},'./Motion':{useReducedMotion:()=>false},
    './measurement':{MeasurementProvider:'Measurements',NativeMeasurementRoot:'MeasurementRoot'},'../downloads':{listDownloads:async()=>{reads++;return [];},downloadStorageBytes:async()=>{reads++;return 0;}},
    '../updates':{getLastUpdateCheck:()=>null,getUpdateStatus:async()=>({state:'idle',bytes:0,total:null,errorCode:null})},'../native':{native:{reelmGetInstalledVersion:async()=>({versionName:'0.2.0',versionCode:3,updateTrusted:true})}},
    'react-native':{ScrollView:'ScrollView',AppState:{currentState:'active',addEventListener:()=>({remove(){}})}}});
  const props={preferences:{holdSpeed:1.5,fontScale:1},insets:{top:24,bottom:24},onChange:p=>calls.push(p),onTabChange(){},onExportLibrary:async()=>true,onImportLibrary:async()=>true};
  try{
    for(const scale of [1,1.3]){
      const tree=h.render('SettingsScreen',{...props,preferences:{...props.preferences,fontScale:scale}});
      assert.match(words(tree),/Subtitle size/);assert.match(words(tree),/app-rendered|subtitle overlay/i);assert(!byID(tree,'downloads-open'));assert(!byID(tree,'downloads-storage'));
      const preview=byID(tree,'settings-subtitle-preview');assert(preview);const scoped=nodes(preview).find(n=>n.type==='FontScale');assert.equal(scoped.props.value,scale);assert(nodes(scoped).some(n=>n.type==='SubtitleOverlay'));
      assert(!nodes(scoped).includes(byID(tree,'library-export')),'preview context must not scale Settings actions');
      assert.equal(byID(tree,'library-export').props.tone,'primary');assert.equal(byID(tree,'library-import').props.tone,'secondary');
      byID(tree,'settings-font-1.3').props.onPress();assert.equal(calls.at(-1).fontScale,1.3);
    }
    await new Promise(setImmediate);assert.equal(reads,0,'Settings must not read or activate the removed offline feature');
  }finally{h.cleanup();}
});

test('short action labels retain full accessibility scope and the existing 48dp target',()=>{
  const h=componentHarness('../ui/Primitives.tsx',{'./ScaledText':{ScaledText:'Text'},'../theme':theme,
    './Icon':{Icon:'Icon'},'./measurement':{useNativeMeasurement:()=>({})},
    './Motion':{usePressFeedback:()=>({scale:1}),LoadingSignal:'Signal'},'react-native':{Animated:{View:'AnimatedView'}}});
  try{
    const tree=h.render('ActionButton',{label:'Import',accessibilityLabel:'Import library and preferences',tone:'secondary',onPress(){}});
    assert.equal(tree.props.accessibilityLabel,'Import library and preferences');assert.equal(tree.props.style({pressed:false})[0].minHeight,48);
    assert(nodes(tree).some(n=>n.type==='Text'&&n.props.children[0]==='Import'));
    assert.equal(h.render('ActionButton',{label:'Watch',onPress(){}}).props.accessibilityLabel,'Watch');
    const bounds=h.render('IconButton',{icon:'pause',label:'Pause playback',onPress(){}}).props.style({pressed:false})[0];
    assert.equal(bounds.minWidth,48);assert.equal(bounds.minHeight,48);
  }finally{h.cleanup();}
});
