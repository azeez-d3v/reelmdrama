import React, {memo} from 'react';
import {Animated, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle} from 'react-native';
import {colors, layout, radius, type} from '../theme';
import {Icon, type IconName} from './Icon';
import {useNativeMeasurement} from './measurement';
import {LoadingSignal, usePressFeedback} from './Motion';

export interface ActionButtonProps {label: string; onPress: () => void; icon?: IconName; disabled?: boolean; tone?: 'primary' | 'secondary' | 'quiet'; testID?: string; style?: StyleProp<ViewStyle>}
export const ActionButton = memo(function ActionButton({label, onPress, icon, disabled = false, tone = 'primary', testID, style}: ActionButtonProps) {
  const primary = tone === 'primary';
  const feedback = usePressFeedback();
  const measured = useNativeMeasurement(testID, {interactive: true, safeAreaRequired: true});
  return <Pressable {...measured} onPressIn={feedback.onPressIn} onPressOut={feedback.onPressOut} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} testID={testID} disabled={disabled} onPress={onPress} android_ripple={{color: colors.ripple}}
    style={({pressed}) => [styles.button, primary ? styles.primary : tone === 'secondary' ? styles.secondary : styles.quiet, disabled ? styles.disabled : null, pressed && !disabled ? styles.pressed : null, style]}>
    <Animated.View pointerEvents="none" style={[styles.buttonContent, {transform: [{scale: feedback.scale}]}]}>
    {icon ? <Icon name={icon} size={20} color={primary ? colors.onSignal : colors.text} filled={icon === 'play'} /> : null}
    <Text style={[styles.buttonText, primary ? styles.primaryText : null]}>{label}</Text>
    </Animated.View>
  </Pressable>;
});

export const IconButton = memo(function IconButton({icon, label, onPress, active = false, disabled = false, testID, overlay = false, size = 24}: {icon: IconName; label: string; onPress: () => void; active?: boolean; disabled?: boolean; testID?: string; overlay?: boolean; size?: number}) {
  const feedback = usePressFeedback();
  const measured = useNativeMeasurement(testID, {interactive: true, safeAreaRequired: true});
  return <Pressable {...measured} onPressIn={feedback.onPressIn} onPressOut={feedback.onPressOut} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled, selected: active}} disabled={disabled} onPress={onPress} testID={testID} android_ripple={{color: colors.ripple, borderless: false}}
    style={({pressed}) => [styles.iconButton, overlay ? styles.overlayButton : null, disabled ? styles.disabled : null, pressed && !disabled ? styles.pressed : null]}>
    <Animated.View pointerEvents="none" style={{transform: [{scale: feedback.scale}]}}><Icon name={icon} size={size} color={active ? colors.signal : colors.text} filled={active} /></Animated.View>
  </Pressable>;
});

export const StatePanel = memo(function StatePanel({kind, title, message, onRetry, retryLabel = 'Try again'}: {kind: 'loading' | 'error' | 'empty'; title: string; message?: string; onRetry?: () => void; retryLabel?: string}) {
  return <View style={styles.state} accessibilityLiveRegion="polite">
    {kind === 'loading' ? <LoadingSignal /> : null}
    <Text style={styles.stateTitle}>{title}</Text>
    {message ? <Text style={styles.stateCopy}>{message}</Text> : null}
    {onRetry ? <ActionButton label={retryLabel} icon="retry" onPress={onRetry} tone="secondary" /> : null}
  </View>;
});

const styles = StyleSheet.create({
  button: {minHeight: layout.touchTarget, paddingHorizontal: 18, paddingVertical: 12, borderRadius: radius.control, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', overflow: 'hidden'},
  primary: {backgroundColor: colors.signal},
  buttonContent: {flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', flexShrink: 1},
  secondary: {backgroundColor: colors.surfaceHigh, borderWidth: 1, borderColor: colors.outline},
  quiet: {backgroundColor: 'transparent'},
  buttonText: {...type.label, color: colors.text, textAlign: 'center', flexShrink: 1},
  primaryText: {color: colors.onSignal},
  iconButton: {minWidth: layout.touchTarget, minHeight: layout.touchTarget, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', overflow: 'hidden'},
  overlayButton: {backgroundColor: colors.videoScrim},
  pressed: {opacity: 0.72},
  disabled: {opacity: 0.4},
  state: {paddingVertical: 30, paddingHorizontal: 4, gap: 12, alignItems: 'flex-start'},
  stateTitle: {...type.title, color: colors.text},
  stateCopy: {...type.body, color: colors.secondary, maxWidth: 340},
});
