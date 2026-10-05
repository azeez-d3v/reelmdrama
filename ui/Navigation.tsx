import {ScaledText as Text} from './ScaledText';
import React, {memo, useCallback} from 'react';
import {Pressable, StyleSheet,  View} from 'react-native';
import {colors, fonts, layout, type, type MainTab} from '../theme';
import {Icon, ReelmMark, type IconName} from './Icon';
import {IconButton} from './Primitives';
import {safeInset} from './format';
import {useNativeMeasurement} from './measurement';
import {AnimatedPresence} from './Motion';

export const BrandedHeader = memo(function BrandedHeader({topInset = 0, title = 'Drama', onBack, onSearch}: {topInset?: number; title?: string; onBack?: () => void; onSearch?: () => void}) {
  const header = useNativeMeasurement('brand-header'), controls = useNativeMeasurement('brand-header-controls', {safeAreaRequired: true});
  return <View {...header} style={[styles.header, {paddingTop: safeInset(topInset)}]}>
    <View {...controls} style={styles.headerRow}>
      {onBack ? <IconButton icon="back" label="Back" onPress={onBack} testID="navigation-back" /> : <ReelmMark size={33} />}
      <View style={styles.brand}><Text style={styles.wordmark}>REELM</Text><View style={styles.brandRule} /><Text style={styles.context}>{title}</Text></View>
      {onSearch ? <IconButton icon="search" label="Search dramas" onPress={onSearch} testID="navigation-search" /> : <View style={styles.headerSpacer} />}
    </View>
  </View>;
});

const tabs: readonly {key: MainTab; label: string; icon: IconName}[] = [{key: 'home', label: 'Home', icon: 'home'}, {key: 'discover', label: 'Discover', icon: 'search'}, {key: 'saved', label: 'Library', icon: 'bookmark'}, {key: 'settings', label: 'Settings', icon: 'settings'}];
const NavigationTab = memo(function NavigationTab({tab, active, onChange}: {tab: typeof tabs[number]; active: boolean; onChange: (tab: MainTab) => void}) {
  const handlePress = useCallback(() => onChange(tab.key), [onChange, tab.key]);
  const measured = useNativeMeasurement(`tab-${tab.key}`, {safeAreaRequired: true, interactive: true});
  return <Pressable {...measured} testID={`tab-${tab.key}`} accessibilityRole="tab" accessibilityLabel={tab.label} accessibilityState={{selected: active}} onPress={handlePress} android_ripple={{color: colors.ripple}}
    style={({pressed}) => [styles.tab, pressed ? styles.pressed : null]}>
    <AnimatedPresence visible={active} style={styles.tabRule}><View /></AnimatedPresence>
    <Icon name={tab.icon} size={23} color={active ? colors.signal : colors.muted} filled={active && tab.key !== 'discover'} />
    <Text style={[styles.tabLabel, active ? styles.tabLabelActive : null]}>{tab.label}</Text>
  </Pressable>;
});

export const BottomTabs = memo(function BottomTabs({active, onChange, bottomInset = 0}: {active: MainTab; onChange: (tab: MainTab) => void; bottomInset?: number}) {
  const measured = useNativeMeasurement('bottom-navigation');
  return <View {...measured} style={[styles.tabs, {paddingBottom: Math.max(safeInset(bottomInset), 8)}]}>
    {tabs.map(tab => <NavigationTab key={tab.key} tab={tab} active={active === tab.key} onChange={onChange} />)}
  </View>;
});

const styles = StyleSheet.create({
  header: {backgroundColor: colors.background},
  headerRow: {height: layout.headerHeight, paddingHorizontal: layout.gutter, flexDirection: 'row', gap: 9, alignItems: 'center'},
  brand: {flex: 1, minWidth: 0, flexDirection: 'row', gap: 12, alignItems: 'center'},
  wordmark: {fontFamily: fonts.bold, fontSize: 19, letterSpacing: -0.4, color: colors.text},
  brandRule: {height: 18, width: 1, backgroundColor: colors.outline},
  context: {...type.label, color: colors.secondary},
  headerSpacer: {width: 16},
  tabs: {flexDirection: 'row', backgroundColor: colors.deep, borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: 20},
  tab: {minHeight: layout.navHeight, flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, overflow: 'hidden'},
  tabRule: {position: 'absolute', top: 0, height: 2, width: 30, backgroundColor: colors.signal},
  tabLabel: {...type.small, color: colors.muted},
  tabLabelActive: {color: colors.text, fontFamily: fonts.bold},
  pressed: {backgroundColor: colors.surfaceHigh},
});
