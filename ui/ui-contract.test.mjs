import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {formatTime, progressFraction, safeInset} from './format.ts';
import {colors, layout, radius, fonts} from '../theme.ts';
import {normalizeNativeBounds, validNativeRectangle} from './coordinates.ts';
import {componentHarness, byID, nodes} from '../tests/ui-harness.mjs';
import {formatTime as nativeFormat, progressFraction as nativeFraction, safeInset as nativeInset} from './format.ts';
import * as theme from '../theme.ts';
import {pingPongOffsets} from '../motion-policy.ts';

test('timeline survives hidden chrome', () => {
  const h = componentHarness('../ui/PlayerOverlay.tsx', {'./ScaledText':{ScaledText:'Text'}, '../theme': theme, './Icon': {Icon: 'Icon'}, './Primitives': {IconButton: 'IconButton', ActionButton: 'ActionButton'}, './format': {formatTime: nativeFormat, progressFraction: nativeFraction, safeInset: nativeInset}, './measurement': {MeasurementProvider: 'Measurements', useNativeMeasurement: () => ({onLayout: () => {}})}, './Motion': {AnimatedPresence: 'Presence', LoadingSignal: 'Spinner', TimelineSweep: 'Sweep'}}, ['OverlayContent']);
  const props = {time: 32, duration: 60, playing: false, desiredPlaying: true, buffering: false, visible: false, insets: {top: 0, bottom: 24, left: 0, right: 0}, onSeekFraction: () => {}};
  for (const delta of [{}, {buffering: true}, {error: 'interrupted', onRetry: () => {}}]) {
    const tree = h.render('OverlayContent', {...props, ...delta}), timeline = byID(tree, 'player-timeline');
    assert(timeline);
    const hiddenChrome = byID(tree, 'player-control-chrome');
    assert(!nodes(hiddenChrome).includes(timeline), 'timeline must not inherit hidden chrome opacity/a11y');
    assert.equal(timeline.props.accessibilityValue.now, 53);
    assert.equal(timeline.props.style[0].minHeight, 48);
    assert.equal(timeline.props.style[1].bottom, 32);
    assert(!byID(tree, 'player-center-play'));
    assert(!nodes(tree).some(node => node.type === 'Spinner'));
    if (delta.error) assert(byID(tree, 'player-retry'));
  }
  let sought = null;
  let ready = h.render('OverlayContent', {...props, onSeekFraction: value => {sought = value;}});
  byID(ready, 'player-timeline').props.onLayout({nativeEvent: {layout: {width: 300}}});
  ready = h.render('OverlayContent', {...props, onSeekFraction: value => {sought = value;}});
  byID(ready, 'player-timeline').props.onPress({nativeEvent: {locationX: 150}});
  assert.equal(sought, 0.5);
  for (const id of ['player-play-pause', 'player-next', 'player-previous', 'player-deck']) assert(!byID(ready, id));
  const unknown = h.render('OverlayContent', {...props, duration: 0});
  assert.equal(byID(unknown, 'player-timeline').props.disabled, true);
});

test('header renders the current title with fixed back/CC controls and no bottom deck', () => {
  const h = componentHarness('../ui/PlayerOverlay.tsx', {'./ScaledText':{ScaledText:'Text'}, '../theme':theme,
    './Primitives':{IconButton:'IconButton',ActionButton:'ActionButton'}, './format':{formatTime,progressFraction,safeInset},
    './measurement':{MeasurementProvider:'Measurements',useNativeMeasurement:()=>({onLayout(){}})},
    './Motion':{AnimatedPresence:'Presence',TimelineSweep:'Sweep'}}, ['OverlayContent']);
  try {
    const base = {time:3,duration:60,playing:true,buffering:false,visible:true,insets:{top:24,bottom:24,left:4,right:7},totalEpisodes:80,
      captionsAvailable:true,captionsEnabled:true,onToggleCaptions(){},onBack(){},onToggleLike(){},onToggleSave(){},onEpisodes(){}};
    for (const [title,episode] of [['A very long resolved episode title '.repeat(8),20],['Series fallback',21],['Next episode title',22]]) {
      const tree = h.render('OverlayContent',{...base,title,episodeNumber:episode});
      const current = byID(tree,'player-header-title');
      assert(current, 'dynamic title must be in header');
      assert.equal(current.props.children[0],title); assert.equal(current.props.numberOfLines,1); assert.equal(current.props.ellipsizeMode,'tail');
      const context = nodes(tree).find(n=>n.props.style?.minWidth===0);
      assert.equal(context.props.style.flex,1); assert.equal(context.props.style.minWidth,0);
      assert.equal(byID(tree,'player-back-slot').props.style.flexShrink,0);
      assert.equal(byID(tree,'player-header-actions').props.style.flexShrink,0);
      const chrome = byID(tree,'player-control-chrome');
      assert(nodes(chrome).includes(byID(tree,'player-captions')));
      assert(nodes(tree).some(n=>n.type==='Text'&&n.props.children.join('')===`EPISODE ${episode} / 80`));
      assert(!nodes(tree).some(n=>n.props.children?.includes('Swipe up for next')));
      for (const id of ['player-play-pause','player-next','player-previous','player-deck']) assert(!byID(tree,id));
      for (const id of ['player-heart','player-bookmark','player-episodes']) {
        // RailAction is a real render function in this component, not an invented counter.
        const action = nodes(tree).find(n=>typeof n.type==='function'&&n.props.icon===id.slice(7)); assert(action);
      }
      assert(nodes(tree).some(n=>n.props.style?.[1]?.bottom===232));
    }
    assert(!byID(h.render('OverlayContent',{...base,title:'Series',episodeNumber:1,captionsAvailable:false}),'player-captions'));
  } finally {h.cleanup();}
});

test('App title selection rejects stale resolved identities and preserves existing routes', () => {
  const app = fs.readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
  const expression = app.match(/const playerTitle=(.*?);/)[1];
  const select = new Function('detail','source','episode',`return ${expression}`);
  const detail = {id:'id',slug:'series',platform:'Platform',title:'Series fallback'};
  const resolution = {title:'Chapter title',episodeNumber:20,identity:{seriesId:'id',slug:'series',platform:'Platform',episodeNumber:20}};
  assert.equal(select(detail,{resolution},20),'Chapter title');
  assert.equal(select(detail,{resolution},21),'Series fallback');
  for (const identity of [{...resolution.identity,seriesId:'other'},{...resolution.identity,slug:'other'},{...resolution.identity,platform:'other'}])
    assert.equal(select(detail,{resolution:{...resolution,identity}},20),'Series fallback');
  assert.equal(select(detail,{resolution:{...resolution,title:'  '}},20),'Series fallback');
  assert.equal(select(null,null,1),'Loading story…');
  assert.match(app,/<PlayerOverlay title=\{playerTitle\}/);
  const overlayCall = app.match(/<PlayerOverlay[^]*?\/>/)[0];
  assert.doesNotMatch(overlayCall,/desiredPlaying=|hasNext=|hasPrevious=|onTogglePlay=|onNext=|onPrevious=|onShowControls=/);
  assert.match(app,/const previous=useCallback/); assert.match(app,/const next=useCallback/); assert.match(app,/testCommands/);
});

test('accepted surface taps alone pulse the action icon for 500ms and cancel old/native animations', () => {
  const animations = [], state = {reduced:false,active:true};
  class Value {constructor(value){this.value=value;}setValue(value){this.value=value;}stopAnimation(){}}
  const Animated = {Value,View:'AnimatedView',timing:(value,config)=>{const a={config,start(cb){this.done=cb;},stop(){this.stopped=true;}};animations.push(a);return a;}};
  const h = componentHarness('../ui/PlaybackSurface.tsx', {'react-native':{Animated},'./Icon':{Icon:'Icon'},
    './Motion':{useReducedMotion:()=>state.reduced,useAppActive:()=>state.active}});
  let toggles=0; const props={active:true,desiredPlaying:true,holdSpeed:1.5,onTogglePlay(){toggles++;},onHoldStart(){return true;},onHoldEnd(){}};
  const point=(x=20,y=20)=>({nativeEvent:{pageX:x,pageY:y}});
  try {
    let tree=h.render('PlaybackSurface',props); assert(!byID(tree,'player-tap-feedback'));
    tree.props.onPressIn(point()); tree.props.onPress(); tree=h.render('PlaybackSurface',props);
    const pulse=byID(tree,'player-tap-feedback'); assert(pulse); assert.equal(pulse.props.pointerEvents,'none');
    assert.equal(nodes(pulse).find(n=>n.type==='Icon').props.name,'pause');
    assert.equal(animations.at(-1).config.duration,500); assert.equal(animations.at(-1).config.useNativeDriver,true);
    const first=animations.at(-1);
    tree.props.onPressIn(point());tree.props.onPress();tree=h.render('PlaybackSurface',{...props,desiredPlaying:false});
    assert(first.stopped); first.done({finished:true}); assert(byID(h.render('PlaybackSurface',props),'player-tap-feedback'));
    const last=animations.at(-1); last.done({finished:true}); assert(!byID(h.render('PlaybackSurface',props),'player-tap-feedback'));
    const before=animations.length;
    tree=h.render('PlaybackSurface',props); tree.props.onPressIn(point());tree.props.onLongPress();tree.props.onPress();
    tree.props.onPressIn(point());tree.props.onTouchMove(point(20,90));tree.props.onPress();
    tree.props.onPressIn(point());tree.props.onTouchCancel();tree.props.onPress();
    assert(!byID(h.render('PlaybackSurface',props),'player-tap-feedback'));assert.equal(animations.length,before);assert.equal(toggles,2);
    state.reduced=true; tree=h.render('PlaybackSurface',props);tree.props.onPressIn(point());tree.props.onPress();h.render('PlaybackSurface',props);
    assert.equal(animations.at(-1).config.delay,500); assert.equal(animations.at(-1).config.duration,0);
    state.active=false;h.render('PlaybackSurface',props); assert(!byID(h.render('PlaybackSurface',props),'player-tap-feedback'));
    state.active=true;tree=h.render('PlaybackSurface',props);tree.props.onPressIn(point());tree.props.onPress();h.render('PlaybackSurface',props);
    const current=animations.at(-1);h.render('PlaybackSurface',{...props,active:false});assert(current.stopped);
    assert(!byID(h.render('PlaybackSurface',{...props,active:false}),'player-tap-feedback'));
    h.cleanup(); assert(current.stopped);
  } finally {h.cleanup();}
});

test('loading sweep stops on playing and respects inactive/reduced motion', () => {
  const actions = [], state = {reduced: false, active: true};
  class Value {setValue(value) {actions.push(['value', value]);} interpolate(value) {return value;} stopAnimation() {actions.push('stop-value');}}
  const Animated = {Value, View: 'AnimatedView', timing: () => ({}), loop: () => ({start: () => actions.push('start'), stop: () => actions.push('stop')})};
  const h = componentHarness('../ui/Motion.tsx', {react: {useContext: () => state}, 'react-native': {Animated, AppState: {currentState: 'active'}, Easing: {linear: 'linear'}, AccessibilityInfo: {}}, '../theme': theme, '../motion-policy': {pingPongOffsets}});
  assert.equal(typeof h.exports.TimelineSweep, 'function', 'loading must use real timeline-only sweep');
  h.render('TimelineSweep', {loading: true, width: 300}); assert(actions.includes('start'));
  actions.length = 0;
  h.render('TimelineSweep', {loading: false, width: 300}); assert(actions.includes('stop')); assert(!actions.includes('start'));
  for (const delta of [{reduced: true, active: true}, {reduced: false, active: false}]) {
    Object.assign(state, delta); actions.length = 0; h.render('TimelineSweep', {loading: true, width: 300}); assert(!actions.includes('start'));
  }
  h.cleanup();
});

const settingsBoundaries={'./SubtitleOverlay':{SubtitleOverlay:'SubtitleOverlay'},'../updates':{getLastUpdateCheck:()=>null,getUpdateStatus:async()=>({state:'idle',bytes:0,total:null,errorCode:null})},'./Motion':{useReducedMotion:()=>false},'./format':{safeInset},'./measurement':{MeasurementProvider:'Measurements',NativeMeasurementRoot:'MeasurementRoot'}};
const read = name => fs.readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');
const luminance = hex => {
  const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
};
const contrast = (a, b) => {const [bright, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);return (bright + 0.05) / (dark + 0.05);};

test('theme preserves all authoritative Reelm viewing tokens and native Geist aliases', () => {
  assert.equal(colors.signal, '#d7ff5f');assert.equal(colors.background, '#0b0f0c');assert.equal(colors.deep, '#070907');assert.equal(colors.surface, '#121813');assert.equal(colors.text, '#f0ead8');assert.equal(colors.line, '#273128');
  assert.deepEqual(radius, {control: 2, media: 4, panel: 8});assert.deepEqual(fonts, {sans: 'Geist', bold: 'GeistBold', mono: 'GeistMono'});assert.equal(layout.touchTarget, 48);
});
test('static body/secondary/muted and primary-action roles exceed4.5:1 contrast', () => {
  for (const foreground of [colors.text, colors.secondary, colors.muted]) for (const background of [colors.background, colors.deep, colors.surface]) assert(contrast(foreground, background) >= 4.5, `${foreground} on ${background}`);
  assert(contrast(colors.onSignal, colors.signal) >= 4.5);
});
test('time formatting handles loading, invalid and long native times withoutNaN', () => {
  assert.equal(formatTime(0), '0:00');assert.equal(formatTime(9.99), '0:09');assert.equal(formatTime(60), '1:00');assert.equal(formatTime(3601), '60:01');
  for (const x of [-1, NaN, Infinity, -Infinity]) assert.equal(formatTime(x), '0:00');
});
test('progress clamps seeks and refuses unavailable or invalid duration', () => {
  assert.equal(progressFraction(30, 60), 0.5);assert.equal(progressFraction(-1, 60), 0);assert.equal(progressFraction(80, 60), 1);
  for (const duration of [0, -1, NaN, Infinity]) assert.equal(progressFraction(10, duration), 0);assert.equal(progressFraction(NaN, 60), 0);
});
test('safe insets cannot become negative orNaN', () => {for (const x of [undefined, NaN, Infinity, -Infinity, -10]) assert.equal(safeInset(x), 0);assert.equal(safeInset(31), 31);});
test('exact incumbent R path retained rather than new counterfeit logo', () => {const source=read('./Icon.tsx');assert(source.includes('M17 50V14h17c11.1 0 18 5.9 18 15.8'));assert(source.includes('fillRule="evenodd"'));assert(!source.includes('Image'));});
test('catalogue uses typed live cards, virtualized grids and honest empty/error/loading states', () => {const source=read('./CatalogueScreen.tsx');assert(source.includes('services/types'));assert(source.includes('FlatList'));assert(source.includes('props.platforms.map'));assert(source.includes('kind="error"'));assert(source.includes('kind="loading"'));assert(source.includes('kind="empty"'));assert(source.includes('advertised')===false);assert(!source.includes('fetch('));});
test('player native CC renders only with actual availability and handler', () => {const source=read('./PlayerOverlay.tsx');assert(source.includes('props.captionsAvailable && props.onToggleCaptions'));assert(source.includes('props.insets.top'));assert(source.includes('props.insets.bottom'));assert(source.includes('accessibilityRole="adjustable"'));assert(!source.includes('fetch('));assert(!source.includes('videoRef'));});
test('episode selectors require advertised availability and remain virtualized', () => {const source=read('./Sheets.tsx');assert(source.includes('disabled={!episode.advertisedAvailable}'));assert(source.includes('numColumns={4}'));assert(source.includes('onRequestClose={onClose}'));assert(source.includes('source listings do not guarantee playback'));});
test('all social interactions stay local with no invented metrics', () => {const source=read('./PlayerOverlay.tsx');assert(source.includes('Like on this device'));assert(source.includes('Save on this device'));assert(!source.match(/\b(followers|views|shares|comments)\b/i));});
test('layout receipts require actual native measureInWindow with cancellation and captured-run guard', () => {const source=read('./measurement.tsx');assert(source.includes('ref.current?.measureInWindow'));assert(source.includes('capturedRun !== getTestRun()'));assert(source.includes('root.capturedRun !== capturedRun'));assert(source.includes('!alive.current'));assert(source.includes('normalizeNativeBounds'));assert(source.includes("coordinateSpace: 'window'"));assert(source.includes('safeAreaInsets:'));assert(source.includes('bounds: [bounds]'));assert(source.includes('cancelAnimationFrame'));assert(source.includes('if (!E2E_ENABLED'));assert(!source.includes('fallback'));});
test('count anomalies remain marked instead of advertised as verified availability', () => {const grid=read('./CatalogueScreen.tsx'),details=read('./Sheets.tsx');assert(grid.includes("card.countWarning ? 'Episode counts unverified'"));assert(details.includes('Source episode counts need verification.'));});
test('native coordinate calibration subtracts actual observed origin rather than statusbar guesses', () => {const root={x:0,y:-33.818,width:392.727,height:872.727},child={x:20,y:0,width:352,height:64};assert.deepEqual(normalizeNativeBounds(child,root),{x:20,y:33.818,width:352,height:64});assert.deepEqual(normalizeNativeBounds(child,{x:7,y:11,width:600,height:900}),{x:13,y:-11,width:352,height:64});});
test('calibration keeps native dimensions and outside bounds intact, rejects invalid observations', () => {const root={x:0,y:-33.818,width:392.727,height:872.727};const normalized=normalizeNativeBounds({x:-10,y:900,width:48,height:48},root);assert.equal(normalized.x,-10);assert.equal(normalized.y,933.818);assert.equal(normalizeNativeBounds({x:0,y:0,width:0,height:48},root),null);assert.equal(normalizeNativeBounds({x:0,y:0,width:48,height:48},{...root,height:Infinity}),null);assert.equal(validNativeRectangle({...root,x:NaN}),false);});
test('feature and platform rail have finite explicit native heights in the unbounded list header', () => {const source=read('./CatalogueScreen.tsx');assert(source.includes('height: 264'));assert(source.includes('platformRail: {height: 52, flexGrow: 0, flexShrink: 0}'));assert(source.includes("featureImage: {width: '100%', flex: 1}"));assert(!source.includes("featureImage: {width: '100%', height: '100%'}"));});
test('native modal sheets calibrate their own real roots rather than sharing main-window origin', () => {const source=read('./Sheets.tsx');assert(source.includes('calibrationId="episodes-dialog"'));assert(source.includes('calibrationId="detail-dialog"'));});

test('timeline rounding removes measured floor quantization lag without changing stored time labels',()=>{const s=read('./PlayerOverlay.tsx');assert(s.includes('Math.round(props.time)'));assert(!s.includes("timeline: {height: 2, overflow: 'hidden'"));assert(s.includes('sweepClip'));assert.equal(formatTime(7.9),'0:07');const old=[{native:8.409,event:7.99},{native:1.008,event:.9}];for(const x of old)assert(Math.abs(x.native-Math.round(x.event))<=1);});

test('Settings choices use persistent native props with no catalogue dependency',()=>{let requested=[],choices=[];const prefs={holdSpeed:1.5,fontScale:1};const h=componentHarness('../ui/SettingsScreen.tsx',{...settingsBoundaries,'./Primitives':{ActionButton:'ActionButton'},'./ScaledText':{ScaledText:'Text',FontScaleContext:{Provider:'FontScale'}},'../native':{native:{reelmGetInstalledVersion:async()=>{requested.push('version');return {versionName:'0.1.0',versionCode:1,packageName:'org.reelm.drama'};}}},'../theme':theme,'./Navigation':{BrandedHeader:'Header',BottomTabs:'Tabs'},'react-native':{AppState:{currentState:'active',addEventListener:()=>({remove(){}})},ScrollView:'ScrollView',Modal:'Modal',useWindowDimensions:()=>({height:800,width:360}),FlatList:'FlatList'}});try{const tree=h.render('SettingsScreen',{preferences:prefs,onChange:p=>choices.push(p),insets:{top:0,bottom:0},onTabChange(){}});for(const speed of [1.25,1.5,1.75,2]){const n=byID(tree,`settings-speed-${speed}`);assert(n);n.props.onPress();assert.equal(choices.at(-1).holdSpeed,speed);}for(const scale of [.9,1,1.15,1.3]){const n=byID(tree,`settings-font-${scale}`);assert(n);n.props.onPress();assert.equal(choices.at(-1).fontScale,scale);}assert.deepEqual(requested,['version']);}finally{h.cleanup();}});
