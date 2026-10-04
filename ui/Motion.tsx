import React, {createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {AccessibilityInfo, Animated, AppState, Easing, StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';
import {colors} from '../theme';
import {pingPongOffsets} from '../motion-policy';

// Resolve the native preference before starting spatial movement; respect changes
// while the app is open. A failed query leaves the conservative static readout.
const MotionContext = createContext({reduced: true, active: false});
export function MotionProvider({children}: {children: React.ReactNode}) {
  const [reduced, setReduced] = useState(true);
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    let alive = true, revision = 0;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      ++revision;
      if (alive) setReduced(value);
    });
    const queryRevision = revision;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (alive && revision === queryRevision) setReduced(value);
    }).catch(() => {});
    return () => {alive = false; subscription.remove();};
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);
  return <MotionContext.Provider value={{reduced, active}}>{children}</MotionContext.Provider>;
}
export const useReducedMotion = () => useContext(MotionContext).reduced;
export const useAppActive = () => useContext(MotionContext).active;

/** The Reelm signal rail: real indeterminate motion, never invented progress. */
export const LoadingSignal = memo(function LoadingSignal({compact = false}: {compact?: boolean}) {
  const reduced = useReducedMotion(), active = useAppActive();
  const travel = compact ? 24 : 78;
  const phase = useRef(new Animated.Value(0.25)).current;
  const position = useMemo(() => phase.interpolate(pingPongOffsets(travel)), [phase, travel]);
  useEffect(() => {
    if (reduced || !active) {phase.setValue(0.25); return;}
    phase.setValue(0);
    const loop = Animated.loop(Animated.timing(phase, {
      toValue: 1, duration: 2200, easing: Easing.linear, useNativeDriver: true, isInteraction: false,
    }));
    loop.start();
    return () => {loop.stop(); phase.stopAnimation();};
  }, [phase, reduced, active]);
  return <View testID="loading-signal-track" accessible={false} pointerEvents="none" style={[styles.signalTrack, compact ? styles.compactTrack : null]}>
    <Animated.View testID="loading-signal-playhead" style={[styles.signalPlayhead, compact ? styles.compactPlayhead : null, {transform: [{translateX: position}]}]} />
  </View>;
});

/** The hidden chrome never blocks swipes or exposes invisible a11y controls. */
export const AnimatedPresence = memo(function AnimatedPresence({visible = true, children, style, testID}: {visible?: boolean; children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string}) {
  const reduced = useReducedMotion(), active = useAppActive();
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  useEffect(() => {
    if (reduced || !active) {opacity.stopAnimation(); opacity.setValue(visible ? 1 : 0); return;}
    const animation = Animated.timing(opacity, {toValue: visible ? 1 : 0, duration: visible ? 200 : 150, easing: Easing.out(Easing.cubic), useNativeDriver: true, isInteraction: false});
    animation.start();
    return () => animation.stop();
  }, [visible, reduced, active, opacity]);
  return <Animated.View testID={testID} pointerEvents={visible ? 'box-none' : 'none'} accessibilityElementsHidden={!visible} importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
    style={[style, {opacity}]}>{children}</Animated.View>;
});

/** Short native-thread key travel; no JS frame loop or list-wide animation. */
export function usePressFeedback() {
  const reduced = useReducedMotion(), active = useAppActive();
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = useCallback(() => {
    scale.stopAnimation();
    if (reduced || !active) {scale.setValue(1); return;}
    Animated.timing(scale, {toValue: 0.94, duration: 100, useNativeDriver: true, isInteraction: false}).start();
  }, [scale, reduced, active]);
  const pressOut = useCallback(() => {
    scale.stopAnimation();
    if (reduced || !active) {scale.setValue(1); return;}
    Animated.timing(scale, {toValue: 1, duration: 150, easing: Easing.out(Easing.cubic), useNativeDriver: true, isInteraction: false}).start();
  }, [scale, reduced, active]);
  useEffect(() => {
    if (reduced || !active) {scale.stopAnimation(); scale.setValue(1);}
    return () => scale.stopAnimation();
  }, [scale, reduced, active]);
  return {scale, onPressIn: pressIn, onPressOut: pressOut};
}

const styles = StyleSheet.create({
  signalTrack: {width: 116, height: 2, overflow: 'hidden', backgroundColor: colors.outline},
  signalPlayhead: {width: 38, height: 2, backgroundColor: colors.signal},
  compactTrack: {width: 36},
  compactPlayhead: {width: 12},
});
