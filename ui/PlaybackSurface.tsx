import React, {memo, useCallback, useEffect, useRef, useState} from 'react';
import {Animated, Pressable, StyleSheet, View, type GestureResponderEvent, type StyleProp, type ViewStyle} from 'react-native';
import {Icon} from './Icon';
import {useAppActive, useReducedMotion} from './Motion';

/** The page owns taps; its native video cannot consume them or block list swipes. */
export const PlaybackSurface = memo(function PlaybackSurface({children, style, active, desiredPlaying, holdSpeed, onTogglePlay, onHoldStart, onHoldEnd}: {
  children: React.ReactNode; style: StyleProp<ViewStyle>; active: boolean;
  desiredPlaying: boolean; holdSpeed: number; onTogglePlay: () => void; onHoldStart: () => boolean; onHoldEnd: () => void;
}) {
  const gesture = useRef({x: 0, y: 0, moved: false, held: false});
  const reduced = useReducedMotion(), appActive = useAppActive();
  const opacity = useRef(new Animated.Value(0)).current;
  const sequence = useRef(0);
  const [pulse, setPulse] = useState<{id: number; action: 'pause' | 'play'} | null>(null);
  useEffect(() => {
    opacity.stopAnimation();
    if (!pulse || !active || !appActive) {opacity.setValue(0); if (pulse) setPulse(null); return;}
    let alive = true;
    opacity.setValue(1);
    const animation = Animated.timing(opacity, {toValue: 0, duration: reduced ? 0 : 500, delay: reduced ? 500 : 0, useNativeDriver: true, isInteraction: false});
    animation.start(({finished}) => {if (alive && finished) setPulse(null);});
    return () => {alive = false; animation.stop(); opacity.stopAnimation(); opacity.setValue(0);};
  }, [pulse, active, appActive, reduced, opacity]);
  const pressIn = useCallback((event: GestureResponderEvent) => {
    gesture.current = {x: event.nativeEvent.pageX, y: event.nativeEvent.pageY, moved: false, held: false};
  }, []);
  const move = useCallback((event: GestureResponderEvent) => {
    const g = gesture.current;
    if (!g.moved && Math.hypot(event.nativeEvent.pageX - g.x, event.nativeEvent.pageY - g.y) > 12) {
      g.moved = true;
      onHoldEnd();
    }
  }, [onHoldEnd]);
  const longPress = useCallback(() => {
    if (active && !gesture.current.moved) {
      gesture.current.held = true;
      onHoldStart();
    }
  }, [active, onHoldStart]);
  const press = useCallback(() => {
    if (active && appActive && !gesture.current.moved && !gesture.current.held) {
      onTogglePlay();
      setPulse({id: ++sequence.current, action: desiredPlaying ? 'pause' : 'play'});
    }
  }, [active, appActive, desiredPlaying, onTogglePlay]);
  const cancel = useCallback(() => {gesture.current.moved = true; onHoldEnd();}, [onHoldEnd]);
  useEffect(() => () => {if (gesture.current.held) onHoldEnd();}, [onHoldEnd]);
  return <Pressable testID="player-reveal-surface" disabled={!active} accessibilityRole="button" accessibilityLabel={desiredPlaying ? 'Pause episode' : 'Play episode'}
    accessibilityHint={`Tap to ${desiredPlaying ? 'pause' : 'play'} and show controls. Hold the video to play temporarily at ${holdSpeed} times speed.`}
    cancelable delayLongPress={350} onPressIn={pressIn} onTouchMove={move} onLongPress={longPress}
    onPressOut={onHoldEnd} onTouchCancel={cancel} onPress={press} style={style}>
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>{children}</View>
    {pulse && active && appActive ? <Animated.View testID="player-tap-feedback" collapsable={false} pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[styles.feedback, {opacity}]}><Icon name={pulse.action} size={56} filled /></Animated.View> : null}
  </Pressable>;
});
const styles = StyleSheet.create({feedback: {...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center'}});
