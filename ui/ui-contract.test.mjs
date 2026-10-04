import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {formatTime, progressFraction, safeInset} from './format.ts';
import {colors, layout, radius, fonts} from '../theme.ts';
import {normalizeNativeBounds, validNativeRectangle} from './coordinates.ts';

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
