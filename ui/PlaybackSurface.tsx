import React, {memo, useCallback, useEffect, useRef} from 'react';
import {Pressable, StyleSheet, View, type GestureResponderEvent, type StyleProp, type ViewStyle} from 'react-native';

/** The page owns taps; its native video cannot consume them or block list swipes. */
export const PlaybackSurface = memo(function PlaybackSurface({children, style, active, onReveal, onHoldStart, onHoldEnd}: {
  children: React.ReactNode; style: StyleProp<ViewStyle>; active: boolean;
  onReveal: () => void; onHoldStart: () => boolean; onHoldEnd: () => void;
}) {
  const gesture = useRef({x: 0, y: 0, moved: false, held: false});
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
    if (!gesture.current.moved && !gesture.current.held) onReveal();
  }, [onReveal]);
  useEffect(() => () => {if (gesture.current.held) onHoldEnd();}, [onHoldEnd]);
  return <Pressable testID="player-reveal-surface" accessibilityRole="button" accessibilityLabel="Show playback controls"
    accessibilityHint="Tap to show controls. Hold the video to play temporarily at 1.5 times speed."
    cancelable delayLongPress={350} onPressIn={pressIn} onTouchMove={move} onLongPress={longPress}
    onPressOut={onHoldEnd} onTouchCancel={onHoldEnd} onPress={press} style={style}>
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>{children}</View>
  </Pressable>;
});
