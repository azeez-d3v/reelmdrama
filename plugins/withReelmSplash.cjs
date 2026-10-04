const fs = require('node:fs/promises');
const path = require('node:path');

// Same geometry and colours as ui/Icon.tsx's ReelmMark. The native OS icon
// stays static; the React Native intro owns its reveal and dismissal motion.
const MARK_PATH = 'M17 50V14h17c11.1 0 18 5.9 18 15.8 0 6.3-3.5 11.1-9.7 13.5L52 50H38.8l-8.7-7H28v7H17Zm11-26v10h5l9-5-9-5h-5Z';
const OUTLINE_PATH = 'M18,4 H46 A14,14 0,0 1 60,18 V46 A14,14 0,0 1 46,60 H18 A14,14 0,0 1 4,46 V18 A14,14 0,0 1 18,4 Z';
const BACKGROUND = '#0b0f0c';
const DEEP = '#070907';
const OUTLINE = '#4b5f4e';
const SIGNAL = '#d7ff5f';
const THEME = 'Theme.App.SplashScreen';
const COLOR = 'reelm_splash_background';
const markPaths = `    <path android:pathData="${OUTLINE_PATH}" android:fillColor="${DEEP}" android:strokeColor="${OUTLINE}" android:strokeWidth="2" />
    <path android:pathData="${MARK_PATH}" android:fillColor="${SIGNAL}" android:fillType="evenOdd" />`;
const markVectorXML = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="96dp" android:height="96dp" android:viewportWidth="64" android:viewportHeight="64">
${markPaths}
</vector>
`;
// Android 12's 288dp icon canvas masks its outer third. A centred 96dp mark
// fits wholly inside the safe 192dp circle, rather than clipping the R tile.
const systemVectorXML = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="288dp" android:height="288dp" android:viewportWidth="288" android:viewportHeight="288">
  <group android:translateX="96" android:translateY="96" android:scaleX="1.5" android:scaleY="1.5">
${markPaths}
  </group>
</vector>
`;
const legacyWindowXML = `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
  <item android:drawable="@color/${COLOR}" />
  <item android:width="96dp" android:height="96dp" android:gravity="center" android:drawable="@drawable/reelm_splash_mark" />
</layer-list>
`;
const generatedFiles = Object.freeze({
  'drawable/reelm_splash_mark.xml': markVectorXML,
  'drawable/reelm_splash_system_icon.xml': systemVectorXML,
  'drawable/reelm_splash_window.xml': legacyWindowXML,
});
const resources = Object.freeze({
  background: BACKGROUND, deep: DEEP, outline: OUTLINE, signal: SIGNAL,
  markPath: MARK_PATH, outlinePath: OUTLINE_PATH, themeName: THEME,
  colorName: COLOR, markVectorXML, systemVectorXML, legacyWindowXML, generatedFiles,
});

function cloneResources(xml) {
  if (!xml || typeof xml !== 'object' || Array.isArray(xml) ||
      !xml.resources || typeof xml.resources !== 'object' || Array.isArray(xml.resources)) {
    throw new TypeError('Expected parsed Android <resources> XML');
  }
  return JSON.parse(JSON.stringify(xml));
}
function namedArray(value, description) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(x => !x || typeof x !== 'object' ||
      !x.$ || typeof x.$.name !== 'string' || !x.$.name)) {
    throw new TypeError('Malformed Android ' + description + ' resources');
  }
  return value;
}
function mergeColors(xml) {
  const result = cloneResources(xml), owned = new Set([COLOR, 'splashscreen_background']);
  result.resources.color = namedArray(result.resources.color, 'colour')
    .filter(x => !owned.has(x.$.name));
  for (const name of owned) result.resources.color.push({$: {name}, _: BACKGROUND});
  return result;
}
function themeItems(version) {
  if (![0, 31, 33].includes(version)) throw new TypeError('Expected base, API31 or API33 splash theme');
  const items = {
    'android:windowBackground': version >= 31 ? '@color/' + COLOR : '@drawable/reelm_splash_window',
  };
  if (version >= 31) Object.assign(items, {
    'android:windowSplashScreenBackground': '@color/' + COLOR,
    'android:windowSplashScreenAnimatedIcon': '@drawable/reelm_splash_system_icon',
    'android:windowSplashScreenIconBackgroundColor': '@android:color/transparent',
  });
  if (version >= 33) items['android:windowSplashScreenBehavior'] = 'icon_preferred';
  return items;
}
function mergeTheme(xml, version = 0) {
  const result = cloneResources(xml), styles = namedArray(result.resources.style, 'style');
  const desired = themeItems(version), owned = new Set([
    ...Object.keys(themeItems(33)), 'android:windowSplashScreenAnimationDuration',
  ]);
  const matches = styles.filter(x => x.$.name === THEME);
  // Keep other theme attributes and items. Collapse only duplicate entries
  // owned by this plugin; never replace AppTheme or unrelated resource groups.
  const attributes = {name: THEME, parent: 'AppTheme'};
  for (const match of matches) for (const [name, value] of Object.entries(match.$)) {
    if (name === 'name' || name === 'parent') continue;
    if (name in attributes && attributes[name] !== value) {
      throw new TypeError('Conflicting duplicate splash theme attribute: ' + name);
    }
    attributes[name] = value;
  }
  const unrelatedItems = matches.flatMap(x => namedArray(x.item, 'theme item'))
    .filter(x => !owned.has(x.$.name));
  const theme = {$: attributes, item: [
    ...unrelatedItems, ...Object.entries(desired).map(([name, value]) => ({$: {name}, _: value})),
  ]};
  const first = styles.findIndex(x => x.$.name === THEME);
  result.resources.style = styles.filter(x => x.$.name !== THEME);
  result.resources.style.splice(first < 0 ? styles.length : first, 0, theme);
  return result;
}

function mergeAppBars(xml) {
  const result = cloneResources(xml), styles = namedArray(result.resources.style, 'style');
  const matches = styles.filter(x => x.$.name === 'AppTheme');
  if (matches.length > 1) throw new TypeError('Ambiguous duplicate AppTheme resources');
  const theme = matches[0] ?? {$: {name: 'AppTheme', parent: 'Theme.AppCompat.DayNight.NoActionBar'}, item: []};
  const owned = new Set([
    'android:windowLightStatusBar', 'android:windowLightNavigationBar', 'android:enforceNavigationBarContrast',
  ]);
  // A transparent bar should reveal the app's dark surface, not Android's
  // temporary contrast scrim. Do not change bar colours or immersion behaviour.
  theme.item = namedArray(theme.item, 'AppTheme item').filter(x => !owned.has(x.$.name));
  for (const name of owned) theme.item.push({$: {name}, _: 'false'});
  if (!matches.length) styles.push(theme);
  result.resources.style = styles;
  return result;
}

function withReelmSplash(config) {
  // These already-installed Expo APIs are loaded only when prebuild invokes
  // the plugin. Pure resource contracts can be tested without adding packages.
  const {withAndroidColors, withAndroidStyles, withDangerousMod, AndroidConfig, XML} = require('expo/config-plugins');
  config = withAndroidColors(config, next => {
    next.modResults = mergeColors(next.modResults);
    return next;
  });
  config = withAndroidStyles(config, next => {
    next.modResults = mergeTheme(mergeAppBars(next.modResults));
    return next;
  });
  return withDangerousMod(config, ['android', async next => {
    const res = path.join(next.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res');
    for (const [relative, contents] of Object.entries(generatedFiles)) {
      const target = path.join(res, relative);
      await fs.mkdir(path.dirname(target), {recursive: true});
      await fs.writeFile(target, contents, 'utf8');
    }
    for (const api of [31, 33]) {
      const target = path.join(res, 'values-v' + api, 'styles.xml');
      // Parse and merge existing variants rather than erasing their other styles.
      const current = await AndroidConfig.Resources.readResourcesXMLAsync({path: target});
      await XML.writeXMLAsync({path: target, xml: mergeTheme(current, api)});
    }
    return next;
  }]);
}

module.exports = withReelmSplash;
module.exports.resources = resources;
module.exports.mergeTheme = mergeTheme;
module.exports.mergeColors = mergeColors;
module.exports.mergeAppBars = mergeAppBars;
