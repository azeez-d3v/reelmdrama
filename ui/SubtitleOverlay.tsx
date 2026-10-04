import React, {memo} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {fonts} from '../theme';
import {SUBTITLE_METRICS, SUBTITLE_OUTLINE_OFFSETS, subtitleFrame} from '../subtitle-policy';

interface SubtitleOverlayProps {
  text: string;
  bottomInset: number;
  leftInset?: number;
  rightInset?: number;
  chromeVisible: boolean;
}

const outlineStyles = SUBTITLE_OUTLINE_OFFSETS.map(({x, y}) => ({
  transform: [{translateX: x}, {translateY: y}],
}));

export const SubtitleOverlay = memo(function SubtitleOverlay({
  text, bottomInset, leftInset, rightInset, chromeVisible,
}: SubtitleOverlayProps) {
  return <View testID="player-subtitles" pointerEvents="none" style={[
    styles.frame,
    subtitleFrame({top: 0, bottom: bottomInset, left: leftInset, right: rightInset}, chromeVisible),
  ]}>
    <View style={styles.stack}>
      {outlineStyles.map((offset, i) => <Text key={i}
        testID={`subtitle-outline-${i}`}
        accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        textBreakStrategy="simple"
        style={[styles.text, styles.outline, offset]}>{text}</Text>)}
      <Text testID="player-subtitle-text" accessible accessibilityLabel={text}
        textBreakStrategy="simple" style={styles.text}>{text}</Text>
    </View>
  </View>;
});

const styles = StyleSheet.create({
  frame: {position: 'absolute', alignItems: 'center'},
  stack: {width: '100%'},
  text: {
    width: '100%',
    fontFamily: fonts.bold,
    fontSize: SUBTITLE_METRICS.fontSize,
    lineHeight: SUBTITLE_METRICS.lineHeight,
    includeFontPadding: false,
    textAlign: 'center',
    color: '#ffffff',
  },
  outline: {...StyleSheet.absoluteFillObject, color: '#000000'},
});
