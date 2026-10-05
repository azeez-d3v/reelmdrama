import {ScaledText as Text} from './ScaledText';
import React, {memo, useCallback, useState} from 'react';
import {Pressable, StyleSheet,  View, type LayoutChangeEvent, type GestureResponderEvent} from 'react-native';
import {colors, layout, radius, type, type ScreenInsets} from '../theme';
import {ActionButton, IconButton} from './Primitives';
import {formatTime, progressFraction, safeInset} from './format';
import {MeasurementProvider, useNativeMeasurement} from './measurement';
import {AnimatedPresence, TimelineSweep} from './Motion';

export interface PlayerOverlayProps {
  title: string;
  episodeNumber: number;
  totalEpisodes: number;
  playing: boolean;
  buffering: boolean;
  time: number;
  duration: number;
  saved: boolean;
  liked: boolean;
  visible?: boolean;
  insets: ScreenInsets;
  error?: string | null;
  captionsAvailable?: boolean;
  captionsEnabled?: boolean;
  muted?: boolean;
  onBack: () => void;
  onToggleSave: () => void;
  onToggleLike: () => void;
  onEpisodes: () => void;
  onSeekFraction: (fraction: number) => void;
  onRetry?: () => void;
  onToggleCaptions?: () => void;
  onToggleMute?: () => void;
}

const RailAction = memo(function RailAction({icon, label, onPress, active = false}: {icon: 'heart' | 'bookmark' | 'episodes'; label: string; onPress: () => void; active?: boolean}) {
  return <View style={styles.railItem}><IconButton icon={icon} label={icon === 'heart' ? active ? 'Remove local like' : 'Like on this device' : icon === 'bookmark' ? active ? 'Remove from saved on this device' : 'Save on this device' : 'Choose an episode'} active={active} onPress={onPress} overlay testID={`player-${icon}`} size={25} /><Text style={styles.railLabel}>{label}</Text></View>;
});

const OverlayContent = memo(function OverlayContent(props: PlayerOverlayProps) {
  const [timelineWidth, setTimelineWidth] = useState(0);
  const progress = progressFraction(props.time, props.duration);
  const seekEnabled = !props.error && Number.isFinite(props.duration) && props.duration > 0 && timelineWidth > 0;
  const topBounds = useNativeMeasurement('player-top'), timelineBounds = useNativeMeasurement('player-timeline', {safeAreaRequired: true, interactive: true});
  const onTimelineLayout = useCallback((event: LayoutChangeEvent) => {setTimelineWidth(event.nativeEvent.layout.width);timelineBounds.onLayout();}, [timelineBounds.onLayout]);
  const seek = useCallback((event: GestureResponderEvent) => {if (seekEnabled) props.onSeekFraction(Math.min(1, Math.max(0, event.nativeEvent.locationX / timelineWidth)));}, [seekEnabled, props.onSeekFraction, timelineWidth]);
  const top = safeInset(props.insets.top) + 8;
  const bottom = Math.max(safeInset(props.insets.bottom), 8) + 8;
  return <View pointerEvents="box-none" style={styles.overlay}>
    <AnimatedPresence visible={props.visible !== false} style={styles.overlay} testID="player-control-chrome">
    <View {...topBounds} style={[styles.top, {paddingTop: top, paddingLeft: 12 + safeInset(props.insets.left), paddingRight: 12 + safeInset(props.insets.right)}]} pointerEvents="box-none">
      <View style={styles.fixedControl} testID="player-back-slot"><IconButton icon="back" label="Back to catalogue" onPress={props.onBack} overlay testID="player-back" /></View>
      <View style={styles.topContext}><Text style={styles.topTitle} numberOfLines={1} ellipsizeMode="tail" testID="player-header-title">{props.title}</Text><Text style={styles.topMeasure}>EPISODE {props.episodeNumber} / {props.totalEpisodes}</Text></View>
      <View style={styles.headerActions} testID="player-header-actions">
        {props.captionsAvailable && props.onToggleCaptions ? <IconButton icon="captions" label={props.captionsEnabled ? 'Turn English subtitles off' : 'Turn English subtitles on'} active={props.captionsEnabled} onPress={props.onToggleCaptions} overlay testID="player-captions" /> : null}
        {props.onToggleMute ? <IconButton icon={props.muted ? 'muted' : 'volume'} label={props.muted ? 'Unmute audio' : 'Mute audio'} onPress={props.onToggleMute} overlay testID="player-mute" /> : null}
      </View>
    </View>
    <View style={[styles.rail, {right: 12 + safeInset(props.insets.right), bottom: bottom + 200}]} pointerEvents="box-none">
      <RailAction icon="heart" label={props.liked ? 'Liked' : 'Like'} active={props.liked} onPress={props.onToggleLike} />
      <RailAction icon="bookmark" label={props.saved ? 'Saved' : 'Save'} active={props.saved} onPress={props.onToggleSave} />
      <RailAction icon="episodes" label="Episodes" onPress={props.onEpisodes} />
    </View>
    {props.error ? <View style={styles.errorPanel} accessibilityLiveRegion="polite"><Text style={styles.errorTitle}>This episode didn’t load.</Text><Text style={styles.errorCopy}>{props.error}</Text>{props.onRetry ? <ActionButton label="Try again" icon="retry" onPress={props.onRetry} tone="secondary" testID="player-retry" /> : null}</View> : null}
    </AnimatedPresence>
      <Pressable {...timelineBounds} disabled={!seekEnabled} accessibilityRole="adjustable" accessibilityLabel="Playback timeline" accessibilityValue={{min: 0, max: 100, now: Math.round(progress * 100)}} onAccessibilityAction={event => {if (seekEnabled) props.onSeekFraction(Math.min(1, Math.max(0, progress + (event.nativeEvent.actionName === 'increment' ? 0.05 : -0.05))));}} accessibilityActions={[{name: 'increment', label: 'Seek forward'}, {name: 'decrement', label: 'Seek backward'}]} onPress={seek} onLayout={onTimelineLayout} testID="player-timeline" style={[styles.timelineTouch, {bottom, left: layout.gutter + safeInset(props.insets.left), right: layout.gutter + safeInset(props.insets.right)}]}>
        <View pointerEvents="none" style={styles.timecodes}><Text style={styles.time}>{formatTime(Math.round(props.time))}</Text><Text style={styles.time}>{formatTime(Math.round(props.duration))}</Text></View>
        <View pointerEvents="none" style={styles.timeline}><View style={styles.sweepClip}><TimelineSweep loading={props.buffering && !props.playing && !props.error} width={timelineWidth} /></View><View style={[styles.timelineProgress, {width: `${progress * 100}%`}]} /><View style={[styles.playhead, {left: `${progress * 100}%`}]} /></View>
      </Pressable>
  </View>;
});

export const PlayerOverlay = memo(function PlayerOverlay(props: PlayerOverlayProps) {
  return <MeasurementProvider view="watch" variant={`${props.title}/${props.episodeNumber}/${props.buffering}/${props.playing}/${props.visible}/${!!props.error}`}><OverlayContent {...props} /></MeasurementProvider>;
});

const styles = StyleSheet.create({
  overlay: {...StyleSheet.absoluteFillObject},
  top: {position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 12, backgroundColor: 'rgba(7,9,7,0.30)'},
  topContext: {flex: 1, gap: 3, minWidth: 0},
  fixedControl: {flexShrink: 0},
  headerActions: {flexShrink: 0, flexDirection: 'row', gap: 8},
  topTitle: {...type.label, color: colors.text},
  topMeasure: {...type.measure, color: colors.secondary},
  rail: {position: 'absolute', gap: 14},
  railItem: {alignItems: 'center', gap: 3},
  railLabel: {...type.small, fontSize: 10, lineHeight: 14, color: colors.text, textShadowColor: colors.deep, textShadowOffset: {width: 0, height: 1}, textShadowRadius: 3},
  timelineTouch: {position: 'absolute', minHeight: layout.touchTarget, justifyContent: 'center', gap: 8},
  timecodes: {flexDirection: 'row', justifyContent: 'space-between'},
  time: {...type.measure, color: colors.text},
  sweepClip: {...StyleSheet.absoluteFillObject, overflow: 'hidden'},
  timeline: {height: 2, backgroundColor: 'rgba(240,234,216,0.3)'},
  timelineProgress: {height: 2, backgroundColor: colors.signal},
  playhead: {position: 'absolute', top: -3, width: 2, height: 8, backgroundColor: colors.signal, marginLeft: -1},
  errorPanel: {position: 'absolute', left: layout.gutter, right: layout.gutter, top: '30%', padding: 20, gap: 14, backgroundColor: colors.scrim, borderRadius: radius.panel},
  errorTitle: {...type.title, color: colors.text},
  errorCopy: {...type.body, color: colors.secondary},
});
