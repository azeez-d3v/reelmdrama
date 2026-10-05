import test from 'node:test';
import assert from 'node:assert/strict';
import {componentHarness, nodes} from '../tests/ui-harness.mjs';
import * as theme from '../theme.ts';
import {formatTime, safeInset} from './format.ts';

test('failed artwork retries once on foreground or remount, without changing valid or missing URLs', () => {
  let active = true;
  const create = () => componentHarness('../ui/CatalogueScreen.tsx', {
    './ScaledText': {ScaledText: 'Text', ScaledTextInput: 'TextInput'},
    'react-native': {Image: 'Image'}, '../theme': theme, './Icon': {Icon: 'Icon'},
    './Navigation': {BrandedHeader: 'Header', BottomTabs: 'Tabs'},
    './Primitives': {ActionButton: 'ActionButton', IconButton: 'IconButton', StatePanel: 'Panel'},
    './format': {formatTime, safeInset}, './measurement': {MeasurementProvider: 'Measurements'},
    './Motion': {useAppActive: () => active},
  }, ['Cover']);
  let h = create();
  const props = {uri: 'https://dramaflix.net/dfl-media/img/covers/0123456789abcdef/480.webp', title: 'Fixture', style: {width: 100, height: 150}};
  const render = () => {h.render('Cover', props); return h.render('Cover', props);};
  const unavailable = () => {
    const tree = render();
    assert.equal(tree.type, 'View');
    assert(nodes(tree).some(node => node.type === 'Text' && node.props.children[0] === 'Artwork unavailable'));
  };
  try {
    let image = render();
    assert.equal(image.type, 'Image'); assert.equal(image.props.source.uri, props.uri);
    image.props.onError();
    unavailable(); unavailable();
    active = false; unavailable();
    active = true; image = render();
    assert.equal(image.type, 'Image', 'foreground must retry the same valid URI');
    assert.equal(image.props.source.uri, props.uri);
    image.props.onError();
    unavailable(); unavailable();
    props.uri = 'https://dramaflix.net/dfl-media/img/covers/1123456789abcdef/480.webp';
    image = render(); assert.equal(image.type, 'Image'); assert.equal(image.props.source.uri, props.uri);
    active = false; assert.equal(render().type, 'Image');
    active = true; assert.equal(render().type, 'Image');
    image = render(); image.props.onError(); unavailable();
    // The existing explicit catalogue refresh clears items and remounts Covers.
    h.cleanup(); h = create(); assert.equal(render().type, 'Image');
    props.uri = null;
    for (const value of [true, false, true, true]) {active = value; unavailable();}
  } finally {h.cleanup();}
});
