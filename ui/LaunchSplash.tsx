import React, {useEffect, useRef, useState} from 'react';
import {Animated, Easing, StyleSheet, Text, View} from 'react-native';
import {colors, fonts} from '../theme';
import {createLaunchLifetime, launchPresentation} from '../splash-policy';
import {ReelmMark} from './Icon';
import {useAppActive, useReducedMotion} from './Motion';

/** The native launch mark stays anchored while the ready app appears beneath it. */
export function LaunchSplash({ready, fontsLoaded, fontsSettled}: {ready: boolean; fontsLoaded: boolean; fontsSettled: boolean}) {
  const reduced = useReducedMotion(), active = useAppActive();
  const [completed, setCompleted] = useState(false);
  const lifetime = useRef(createLaunchLifetime()).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const presentation = launchPresentation(ready, completed, reduced, active);

  useEffect(() => {
    const ticket = lifetime.begin();
    if (lifetime.completed) return;
    if (!ready) {
      opacity.setValue(1);
      scale.setValue(1);
      return () => lifetime.invalidate();
    }
    if (!active) {
      if (lifetime.complete(ticket, true)) setCompleted(true);
      return () => lifetime.invalidate();
    }
    // A live Remove animations change must cut scale, not animate it backwards.
    if (!presentation.spatialMotion) scale.setValue(1);
    const animation = Animated.parallel([
      Animated.timing(opacity, {toValue: 0, duration: presentation.exitDurationMs, easing: Easing.inOut(Easing.cubic), useNativeDriver: true, isInteraction: false}),
      Animated.timing(scale, {toValue: presentation.spatialMotion ? 1.045 : 1, duration: presentation.exitDurationMs, easing: Easing.out(Easing.cubic), useNativeDriver: true, isInteraction: false}),
    ]);
    animation.start(({finished}) => {
      if (lifetime.complete(ticket, finished)) setCompleted(true);
    });
    return () => {
      lifetime.invalidate();
      animation.stop();
    };
  }, [ready, active, presentation.exitDurationMs, presentation.spatialMotion, lifetime, opacity, scale]);

  if (!presentation.visible) return null;
  return <Animated.View testID="reelm-splash-overlay" pointerEvents={presentation.blocking ? 'auto' : 'none'}
    accessible={presentation.blocking} accessibilityRole="progressbar" accessibilityLabel="Opening Reelm Drama"
    accessibilityElementsHidden={!presentation.blocking} importantForAccessibility={presentation.blocking ? 'yes' : 'no-hide-descendants'}
    style={[styles.overlay, {opacity}]}>
    <View style={styles.scene} pointerEvents="none">
      <Animated.View testID="reelm-splash-mark" style={{transform: [{scale}]}}><ReelmMark size={96}/></Animated.View>
      {fontsSettled ? <View testID="reelm-splash-wordmark" style={styles.wordmark}>
        <Text style={[styles.name, fontsLoaded ? styles.loadedName : null]}>REELM</Text>
        <View style={styles.divider}/>
        <Text style={[styles.edition, fontsLoaded ? styles.loadedEdition : null]}>Drama</Text>
      </View> : null}
    </View>
  </Animated.View>;
}

const styles = StyleSheet.create({
  overlay: {...StyleSheet.absoluteFillObject, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center'},
  // Absolute wordmark placement keeps the R at the native splash's exact centre.
  scene: {width: 96, height: 96, alignItems: 'center', justifyContent: 'center'},
  wordmark: {position: 'absolute', top: 120, left: -88, width: 272, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12},
  name: {fontSize: 30, lineHeight: 36, fontWeight: '700', letterSpacing: -0.6, color: colors.text},
  loadedName: {fontFamily: fonts.bold},
  divider: {width: 1, height: 22, backgroundColor: colors.outline},
  edition: {fontSize: 14, lineHeight: 20, color: colors.secondary},
  loadedEdition: {fontFamily: fonts.sans},
});
