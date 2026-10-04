import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {SUBTITLE_METRICS, SUBTITLE_OUTLINE_OFFSETS, subtitleFrame} from '../subtitle-policy.ts';
import {fonts} from '../theme.ts';

const read = relative => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
const source = read('../ui/SubtitleOverlay.tsx');
const app = read('../App.tsx');
const normalize = value => JSON.parse(JSON.stringify(value));

// Execute the actual component against minimal render-only RN/React stubs.
// This exercises props/tree/layout contracts, not native glyph painting.
const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const output = ts.transpileModule(source, {compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX,
}}).outputText;
const exports = {};
const absoluteFillObject = Object.freeze({position: 'absolute', left: 0, right: 0, top: 0, bottom: 0});
const element = (type, props, key) => ({type, props, key});
vm.runInNewContext(output, {exports, require: name => {
  if (name === 'react') return {memo: component => Object.assign(component, {memoized: true})};
  if (name === 'react/jsx-runtime') return {jsx: element, jsxs: element};
  if (name === 'react-native') return {View: 'View', Text: 'Text', StyleSheet: {create: styles => styles, absoluteFillObject}};
  if (name === '../theme') return {fonts};
  if (name === '../subtitle-policy') return {SUBTITLE_METRICS, SUBTITLE_OUTLINE_OFFSETS, subtitleFrame};
  throw new Error(`Unexpected subtitle dependency: ${name}`);
}}, {filename: 'SubtitleOverlay.contract.cjs'});
const render = overrides => exports.SubtitleOverlay({text: 'First line\nA second, longer line of English dialogue.', bottomInset: 24, leftInset: 0, rightInset: 0, chromeVisible: false, ...overrides});
const textNodes = node => {
  if (!node || typeof node !== 'object') return [];
  if (node.type === 'Text') return [node];
  return [node.props?.children].flat(Infinity).flatMap(textNodes);
};
const flattenStyle = style => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

test('subtitle metrics increase incumbent 17/23 regular type to 22/29 bold without changing theme fonts', () => {
  assert.equal(SUBTITLE_METRICS.fontSize, 22);
  assert.equal(SUBTITLE_METRICS.lineHeight, 29);
  assert(SUBTITLE_METRICS.fontSize > 17);
  assert(SUBTITLE_METRICS.lineHeight > 23);
  const foreground = textNodes(render()).at(-1);
  const style = flattenStyle(foreground.props.style);
  assert.equal(style.fontFamily, fonts.bold);
  assert.equal(style.fontSize, 22);
  assert.equal(style.lineHeight, 29);
});

test('subtitle frame centers exactly in both modes with asymmetric and optional side insets', () => {
  for (const chrome of [false, true]) {
    for (const [left, right] of [[0, 0], [14, 0], [0, 27], [8, 24], [undefined, 9], [5, undefined]]) {
      const frame = subtitleFrame({top: 40, bottom: 24, left, right}, chrome);
      const expected = (chrome ? 76 : 24) + Math.max(left ?? 0, right ?? 0);
      assert.equal(frame.left, expected);
      assert.equal(frame.right, expected);
      for (const screenWidth of [360, 393, 412, 800]) {
        const midpoint = frame.left + (screenWidth - frame.left - frame.right) / 2;
        assert.equal(midpoint, screenWidth / 2);
      }
    }
  }
});

test('subtitle policy sanitizes malformed, negative and non-finite safe insets symmetrically', () => {
  for (const bad of [undefined, null, -1, -90, NaN, Infinity, -Infinity, '12', true, false]) {
    for (const chrome of [false, true]) {
      assert.deepEqual(subtitleFrame({top: bad, bottom: bad, left: bad, right: bad}, chrome), {
        left: chrome ? 76 : 24, right: chrome ? 76 : 24, bottom: chrome ? 222 : 64,
      });
      const mixed = subtitleFrame({top: 0, bottom: 5, left: bad, right: 18}, chrome);
      assert.equal(mixed.left, (chrome ? 76 : 24) + 18);
      assert.equal(mixed.right, mixed.left);
      assert.equal(mixed.bottom, (chrome ? 222 : 64) + 5);
    }
  }
});

test('both subtitle positions rise exactly 32dp from incumbent offsets and retain bottom safe area', () => {
  for (const bottom of [0, 8, 24, 48]) {
    assert.equal(subtitleFrame({top: 0, bottom}, true).bottom - bottom - 190, 32);
    assert.equal(subtitleFrame({top: 0, bottom}, false).bottom - bottom - 32, 32);
  }
});

test('visible subtitle gutters reserve side-control width on both sides without asymmetric centering', () => {
  assert(SUBTITLE_METRICS.controlsGutter >= 12 + 48 + SUBTITLE_METRICS.outlineRadius + 12);
  assert(SUBTITLE_METRICS.controlsGutter > SUBTITLE_METRICS.immersiveGutter);
  const overlay = render({chromeVisible: true, leftInset: 20, rightInset: 0});
  const frame = flattenStyle(overlay.props.style);
  assert.equal(frame.left, 96);
  assert.equal(frame.right, 96);
  assert.equal(frame.bottom, 246);
});

test('outline has exactly eight immutable equal-radius balanced offsets and no central replica', () => {
  assert.equal(SUBTITLE_OUTLINE_OFFSETS.length, 8);
  assert(Object.isFrozen(SUBTITLE_METRICS));
  assert(Object.isFrozen(SUBTITLE_OUTLINE_OFFSETS));
  for (const offset of SUBTITLE_OUTLINE_OFFSETS) {
    assert(Object.isFrozen(offset));
    assert(Math.abs(Math.hypot(offset.x, offset.y) - 1.5) < 1e-12);
    assert(Math.hypot(offset.x, offset.y) > 0);
  }
  for (let i = 0; i < 4; ++i) {
    assert(Math.abs(SUBTITLE_OUTLINE_OFFSETS[i].x + SUBTITLE_OUTLINE_OFFSETS[i + 4].x) < 1e-12);
    assert(Math.abs(SUBTITLE_OUTLINE_OFFSETS[i].y + SUBTITLE_OUTLINE_OFFSETS[i + 4].y) < 1e-12);
  }
  assert(Math.abs(SUBTITLE_OUTLINE_OFFSETS.reduce((sum, offset) => sum + offset.x, 0)) < 1e-12);
  assert(Math.abs(SUBTITLE_OUTLINE_OFFSETS.reduce((sum, offset) => sum + offset.y, 0)) < 1e-12);
});

test('actual component renders eight dark contours followed by exactly one white primary caption', () => {
  const layers = textNodes(render());
  assert.equal(layers.length, 9);
  layers.slice(0, 8).forEach((layer, i) => {
    assert.equal(layer.props.testID, `subtitle-outline-${i}`);
    assert.equal(flattenStyle(layer.props.style).color, '#000000');
    assert.deepEqual(normalize(flattenStyle(layer.props.style).transform), [
      {translateX: SUBTITLE_OUTLINE_OFFSETS[i].x}, {translateY: SUBTITLE_OUTLINE_OFFSETS[i].y},
    ]);
  });
  assert.equal(layers.at(-1).props.testID, 'player-subtitle-text');
  assert.equal(flattenStyle(layers.at(-1).props.style).color, '#ffffff');
});

test('foreground alone determines natural multiline height and every contour uses its identical full width/type', () => {
  const overlay = render(), stack = overlay.props.children;
  assert.equal(flattenStyle(stack.props.style).width, '100%');
  const layers = textNodes(overlay), primary = flattenStyle(layers.at(-1).props.style);
  assert.equal(primary.position, undefined);
  assert.equal(primary.height, undefined);
  assert.equal(primary.maxHeight, undefined);
  assert.equal(primary.width, '100%');
  for (const layer of layers.slice(0, 8)) {
    const style = flattenStyle(layer.props.style);
    for (const field of ['width', 'fontFamily', 'fontSize', 'lineHeight', 'includeFontPadding', 'textAlign']) {
      assert.equal(style[field], primary[field], field);
    }
    assert.equal(style.position, 'absolute');
    assert.equal(style.left, 0);
    assert.equal(style.right, 0);
    assert.equal(style.top, 0);
    assert.equal(style.bottom, 0);
  }
});

test('long and explicitly multiline cue text is preserved identically in all native wrapping layers', () => {
  const text = 'She said: “Do not leave.”\nBut this is a very long second line that must wrap normally rather than being cut short.\nÁ bientôt — café, naïve.';
  const layers = textNodes(render({text}));
  for (const layer of layers) {
    assert.equal(layer.props.children, text);
    assert.equal(layer.props.textBreakStrategy, 'simple');
    for (const prop of ['numberOfLines', 'ellipsizeMode', 'adjustsFontSizeToFit', 'minimumFontScale', 'maxFontSizeMultiplier']) {
      assert.equal(layer.props[prop], undefined, prop);
    }
    assert.notEqual(layer.props.allowFontScaling, false);
    assert.equal(flattenStyle(layer.props.style).textAlign, 'center');
  }
});

test('no view or glyph layer adds a filled subtitle background, shadow blur or clipping', () => {
  const overlay = render(), nodes = [overlay, overlay.props.children, ...textNodes(overlay)];
  for (const node of nodes) {
    const style = flattenStyle(node.props.style);
    assert.equal(style.backgroundColor, undefined);
    assert.equal(style.textShadowRadius, undefined);
    assert.notEqual(style.overflow, 'hidden');
  }
});

test('screen readers get one primary cue and cannot access any decorative outline replica', () => {
  const text = 'Read this English dialogue once.', layers = textNodes(render({text}));
  for (const replica of layers.slice(0, 8)) {
    assert.equal(replica.props.accessible, false);
    assert.equal(replica.props.accessibilityElementsHidden, true);
    assert.equal(replica.props.importantForAccessibility, 'no-hide-descendants');
    assert.equal(replica.props.accessibilityLabel, undefined);
  }
  const primary = layers.at(-1);
  assert.equal(primary.props.accessible, true);
  assert.equal(primary.props.accessibilityLabel, text);
  assert.equal(primary.props.accessibilityElementsHidden, undefined);
  assert.equal(primary.props.importantForAccessibility, undefined);
  assert(layers.every(layer => layer.props.accessibilityLiveRegion === undefined));
});

test('subtitle parent never intercepts playback reveal, long hold or swipe gestures', () => {
  const overlay = render();
  assert.equal(overlay.props.pointerEvents, 'none');
  for (const node of [overlay, overlay.props.children, ...textNodes(overlay)]) {
    for (const prop of ['onPress', 'onLongPress', 'onTouchStart', 'onTouchEnd', 'onStartShouldSetResponder', 'onMoveShouldSetResponder']) {
      assert.equal(node.props[prop], undefined, prop);
    }
  }
});

test('memoized subtitle component reuses static outline transforms across cues and chrome transitions', () => {
  assert.equal(exports.SubtitleOverlay.memoized, true);
  const one = textNodes(render({text: 'One.', chromeVisible: false}));
  const two = textNodes(render({text: 'Two.\nContinued.', chromeVisible: true}));
  for (let i = 0; i < 8; ++i) {
    assert.equal(one[i].props.style[0], two[i].props.style[0]);
    assert.equal(one[i].props.style[1], two[i].props.style[1]);
    assert.equal(one[i].props.style[2], two[i].props.style[2]);
  }
  assert.equal(one.at(-1).props.style, two.at(-1).props.style);
  assert.doesNotMatch(source, /useState|useEffect|useWindowDimensions|onTextLayout|onLayout|requestAnimationFrame|setInterval/);
});

test('App retains caption gate, exact active English cue timing and primitive safe/chrome props', () => {
  assert.match(app, /const cue=source\?\.resolution\.englishSubtitleCues\.find\(c=>snap\.time>=c\.start&&snap\.time<c\.end\)/);
  assert.match(app, /captionsEnabled&&cue\?<SubtitleOverlay text=\{cue\.text\} bottomInset=\{insets\.bottom\} leftInset=\{insets\.left\} rightInset=\{insets\.right\} chromeVisible=\{chromeVisible\}\/>:null/);
  assert.doesNotMatch(app, /styles\.captions|styles\.captionText/);
});

test('subtitle implementation has only rendering/policy dependencies and no media/source/cache logic', () => {
  const imports = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map(match => match[1]).sort();
  assert.deepEqual(imports, ['../subtitle-policy', '../theme', 'react', 'react-native'].sort());
  assert.doesNotMatch(source, /fetch\(|resolveEpisode|loadEpisode|episodeCache|NativePlayer|setPlaybackRate|currentTime|\.seek\(/);
  const policy = read('../subtitle-policy.ts');
  assert.doesNotMatch(policy, /fetch\(|resolveEpisode|loadEpisode|episodeCache|NativePlayer|setPlaybackRate|\.seek\(/);
});
