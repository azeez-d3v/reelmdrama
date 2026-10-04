import React, {memo, useCallback, useEffect, useMemo, useState} from 'react';
import {FlatList, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type ImageStyle, type ListRenderItemInfo} from 'react-native';
import type {DramaCard, DramaPlatform} from '../services/types';
import {colors, fonts, layout, radius, type, type MainTab, type ScreenInsets} from '../theme';
import {Icon} from './Icon';
import {BrandedHeader, BottomTabs} from './Navigation';
import {ActionButton, IconButton, StatePanel} from './Primitives';
import {safeInset} from './format';
import {MeasurementProvider} from './measurement';

export interface CatalogueScreenProps {
  tab: MainTab;
  items: readonly DramaCard[];
  platforms: readonly DramaPlatform[];
  platformsLoading?: boolean;
  platformsError?: string | null;
  onRetryPlatforms?: () => void;
  selectedPlatform: string | null;
  query: string;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  hasMore: boolean;
  savedIds: ReadonlySet<string>;
  insets: ScreenInsets;
  total?: number;
  onQueryChange: (query: string) => void;
  onSearchSubmit: () => void;
  onPlatformChange: (platform: string | null) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onOpenSeries: (card: DramaCard) => void;
  onWatch: (card: DramaCard) => void;
  onTabChange: (tab: MainTab) => void;
}

const Cover = memo(function Cover({uri, title, style}: {uri: string | null; title: string; style: Pick<ImageStyle, 'width' | 'height' | 'aspectRatio' | 'flex'>}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  const onError = useCallback(() => setFailed(true), []);
  if (!uri || failed) return <View style={[styles.coverFallback, style]}><Icon name="episodes" size={28} color={colors.muted} /><Text style={styles.artworkUnavailable}>Artwork unavailable</Text></View>;
  return <Image source={{uri}} accessibilityLabel={`${title} poster`} resizeMode="cover" style={style} onError={onError} />;
});

const PosterCard = memo(function PosterCard({card, width, saved, onOpen}: {card: DramaCard; width: number; saved: boolean; onOpen: (card: DramaCard) => void}) {
  const open = useCallback(() => onOpen(card), [onOpen, card]);
  return <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`Open ${card.title}, ${card.platform}, ${card.totalEpisodes} episodes${saved ? ', saved on this device' : ''}`} testID={`series-${card.id}`}
    android_ripple={{color: colors.ripple}} style={({pressed}) => [styles.posterCard, {width}, pressed ? styles.pressed : null]}>
    <View style={styles.posterFrame}><Cover uri={card.cover} title={card.title} style={styles.posterImage} />
      {saved ? <View style={styles.savedIndicator}><Icon name="bookmark" size={18} color={colors.signal} filled /></View> : null}
      {card.isNew ? <View style={styles.newTag}><Text style={styles.newText}>NEW</Text></View> : null}
    </View>
    <Text style={styles.posterTitle} numberOfLines={2}>{card.title}</Text>
    <Text style={styles.posterMeta} numberOfLines={1}>{card.platform}</Text>
    <Text style={styles.posterCount}>{card.countWarning ? 'Episode counts unverified' : `${card.totalEpisodes} episodes`}</Text>
  </Pressable>;
});

const FeaturedCard = memo(function FeaturedCard({card, onWatch, onOpen}: {card: DramaCard; onWatch: (card: DramaCard) => void; onOpen: (card: DramaCard) => void}) {
  const watch = useCallback(() => onWatch(card), [card, onWatch]);
  const open = useCallback(() => onOpen(card), [card, onOpen]);
  return <View style={styles.feature}>
    <View style={styles.featureInfo}><Text style={styles.featurePlatform}>{card.platform}</Text><Text style={styles.featureTitle} numberOfLines={4}>{card.title}</Text>
      <Text style={styles.featureMeta}>{card.countWarning ? 'Episode counts unverified' : `${card.totalEpisodes} episodes`}</Text>
      <ActionButton label="Start watching" icon="play" onPress={watch} testID="featured-watch" />
    </View>
    <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`See ${card.title} details`} style={styles.featureArtwork}>
      <Cover uri={card.cover} title={card.title} style={styles.featureImage} />
    </Pressable>
  </View>;
});

const PlatformChip = memo(function PlatformChip({name, active, onChange}: {name: string | null; active: boolean; onChange: (platform: string | null) => void}) {
  const press = useCallback(() => onChange(name), [onChange, name]);
  return <Pressable accessibilityRole="button" accessibilityLabel={name ? `Show ${name} dramas` : 'Show all platforms'} accessibilityState={{selected: active}} onPress={press} testID={name ? `platform-${name}` : 'platform-all'}
    android_ripple={{color: colors.ripple}} style={({pressed}) => [styles.platformChip, active ? styles.platformChipActive : null, pressed ? styles.pressed : null]}>
    <Text style={[styles.platformName, active ? styles.platformNameActive : null]}>{name ?? 'All platforms'}</Text>
  </Pressable>;
});

export const CatalogueScreen = memo(function CatalogueScreen(props: CatalogueScreenProps) {
  const {width} = useWindowDimensions();
  const columns = width >= 900 ? 4 : width >= 620 ? 3 : 2;
  const horizontalGutter = layout.gutter * 2 + safeInset(props.insets.left) + safeInset(props.insets.right);
  const cardWidth = Math.floor((width - horizontalGutter - 12 * (columns - 1)) / columns);
  const feature = props.tab === 'home' && !props.query && !props.selectedPlatform ? props.items[0] : undefined;
  const listItems = useMemo(() => feature ? props.items.slice(1) : props.items, [feature, props.items]);
  const renderItem = useCallback(({item}: ListRenderItemInfo<DramaCard>) => <PosterCard card={item} width={cardWidth} saved={props.savedIds.has(item.id)} onOpen={props.onOpenSeries} />, [cardWidth, props.savedIds, props.onOpenSeries]);
  const searchTab = useCallback(() => props.onTabChange('discover'), [props.onTabChange]);
  const clearQuery = useCallback(() => props.onQueryChange(''), [props.onQueryChange]);
  const loadMore = useCallback(() => {if (props.hasMore && !props.loading && !props.refreshing && !props.error) props.onLoadMore();}, [props.hasMore, props.loading, props.refreshing, props.error, props.onLoadMore]);
  const title = props.tab === 'home' ? 'Stories worth\nstaying for.' : props.tab === 'saved' ? 'Your saved reels.' : 'Find your next story.';
  const saved = props.tab === 'saved';
  const header = <View style={styles.listHeader}>
    <Text style={styles.screenTitle}>{title}</Text>
    {saved ? <Text style={styles.supporting}>Saved on this device. Ready when you are.</Text> : <Text style={styles.supporting}>English catalogue. Original or dubbed audio, as provided.</Text>}
    {!saved ? <View style={styles.search}>
      <Icon name="search" size={20} color={colors.muted} />
      <TextInput testID="catalogue-search-input" accessibilityLabel="Search drama titles" value={props.query} onChangeText={props.onQueryChange} onSubmitEditing={props.onSearchSubmit} placeholder="Search a title…" placeholderTextColor={colors.muted} selectionColor={colors.signal} returnKeyType="search" autoCapitalize="none" autoCorrect={false} style={styles.searchInput} />
      {props.query ? <IconButton icon="close" label="Clear search" onPress={clearQuery} testID="catalogue-search-clear" /> : null}
      <IconButton icon="chevron" label="Submit search" onPress={props.onSearchSubmit} testID="catalogue-search-submit" />
    </View> : null}
    {!saved ? <ScrollView horizontal style={styles.platformRail} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.platforms} keyboardShouldPersistTaps="handled">
      <PlatformChip name={null} active={!props.selectedPlatform} onChange={props.onPlatformChange} />
      {props.platforms.map(platform => <PlatformChip key={platform.name} name={platform.name} active={props.selectedPlatform === platform.name} onChange={props.onPlatformChange} />)}
    </ScrollView> : null}
    {!saved && (props.platformsLoading || props.platformsError || props.platforms.length === 0) ? <View testID="platform-directory-status" style={styles.platformStatus} accessibilityLiveRegion="polite">
      <Text style={styles.supporting}>{props.platformsLoading ? (props.platforms.length ? 'Refreshing platforms…' : 'Loading platforms…') : props.platformsError ?? 'No platforms were returned. Refresh to check again.'}</Text>
      {!props.platformsLoading && props.onRetryPlatforms ? <ActionButton label="Retry platforms" icon="retry" tone="secondary" onPress={props.onRetryPlatforms} testID="platform-directory-retry"/> : null}
    </View> : null}
    {feature ? <FeaturedCard card={feature} onWatch={props.onWatch} onOpen={props.onOpenSeries} /> : null}
    <View style={styles.collectionHeading}><Text testID="catalogue-collection-heading" style={styles.collectionTitle}>{saved ? 'Your collection' : props.selectedPlatform ?? (props.query ? 'Search results' : 'Browse the reels')}</Text>
      {typeof props.total === 'number' ? <Text style={styles.collectionCount}>{props.total} titles</Text> : null}
    </View>
    {props.error ? <StatePanel kind="error" title="These reels didn’t load." message={props.error} onRetry={props.onRefresh} /> : null}
    {props.loading && props.items.length === 0 ? <StatePanel kind="loading" title="Finding your next story…" message="Loading the latest catalogue." /> : null}
  </View>;
  return <MeasurementProvider view={props.tab === 'discover' ? 'platform' : 'home'} variant={`${props.tab}/${props.selectedPlatform ?? ''}/${props.loading}/${props.refreshing}/${props.items.length}`}><View style={styles.screen}>
    <BrandedHeader topInset={props.insets.top} onSearch={searchTab} />
    <FlatList key={columns} testID="catalogue-grid" data={listItems} numColumns={columns} keyExtractor={item => item.id} renderItem={renderItem} extraData={props.savedIds} columnWrapperStyle={styles.gridRow}
      contentContainerStyle={[styles.list, {paddingHorizontal: layout.gutter + safeInset(props.insets.left), paddingRight: layout.gutter + safeInset(props.insets.right)}]}
      ListHeaderComponent={header} ListEmptyComponent={!props.loading && !props.error && !feature ? <StatePanel kind="empty" title={saved ? 'Keep a few stories for later.' : 'No reels found.'} message={saved ? 'Open a story and save it to build your collection.' : 'Try another title or choose a different platform.'} /> : null}
      ListFooterComponent={props.items.length > 0 && props.hasMore ? <View style={styles.footer}><ActionButton label={props.loading ? 'Loading more…' : 'Load more stories'} tone="secondary" onPress={props.onLoadMore} disabled={props.loading || props.refreshing} testID="catalogue-load-more" /></View> : <View style={styles.footerSpace} />}
      refreshControl={<RefreshControl refreshing={props.refreshing} onRefresh={props.onRefresh} tintColor={colors.signal} colors={[colors.signal]} progressBackgroundColor={colors.surface} />}
      onEndReached={loadMore} onEndReachedThreshold={0.3} initialNumToRender={6} maxToRenderPerBatch={6} windowSize={5} removeClippedSubviews keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false} />
    <BottomTabs active={props.tab} onChange={props.onTabChange} bottomInset={props.insets.bottom} />
  </View></MeasurementProvider>;
});

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  list: {paddingBottom: 8},
  listHeader: {gap: 16, paddingTop: 8, paddingBottom: 8},
  screenTitle: {...type.display, color: colors.text},
  supporting: {...type.small, color: colors.secondary, marginTop: -6},
  search: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.control, minHeight: 52},
  searchInput: {...type.body, color: colors.text, flex: 1, minWidth: 0, paddingVertical: 10},
  platforms: {gap: 8, paddingVertical: 2},
  platformRail: {height: 52, flexGrow: 0, flexShrink: 0},
  platformStatus: {gap: 10, alignItems: 'flex-start'},
  platformChip: {minHeight: layout.touchTarget, justifyContent: 'center', paddingHorizontal: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.control, overflow: 'hidden'},
  platformChipActive: {backgroundColor: colors.signal, borderColor: colors.signal},
  platformName: {...type.label, color: colors.secondary},
  platformNameActive: {color: colors.onSignal},
  feature: {flexDirection: 'row', height: 264, borderRadius: radius.media, overflow: 'hidden', backgroundColor: colors.surface},
  featureInfo: {flex: 1, padding: 16, gap: 12, justifyContent: 'space-between'},
  featurePlatform: {...type.small, color: colors.secondary},
  featureTitle: {...type.title, color: colors.text},
  featureMeta: {...type.measure, color: colors.muted},
  featureArtwork: {width: '40%', height: 264},
  featureImage: {width: '100%', flex: 1},
  collectionHeading: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginTop: 8},
  collectionTitle: {...type.title, color: colors.text, flex: 1},
  collectionCount: {...type.measure, color: colors.muted},
  gridRow: {gap: 12},
  posterCard: {marginBottom: 22, gap: 4, alignSelf: 'flex-start', overflow: 'hidden'},
  posterFrame: {aspectRatio: 2 / 3, borderRadius: radius.media, overflow: 'hidden', backgroundColor: colors.surface},
  posterImage: {height: '100%', width: '100%'},
  posterTitle: {...type.label, color: colors.text, marginTop: 6, minHeight: 36},
  posterMeta: {...type.small, color: colors.secondary},
  posterCount: {...type.measure, color: colors.muted},
  coverFallback: {backgroundColor: colors.surfaceHigh, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 8},
  artworkUnavailable: {...type.small, color: colors.muted, textAlign: 'center'},
  savedIndicator: {position: 'absolute', top: 8, right: 8, backgroundColor: colors.scrim, padding: 6, borderRadius: radius.control},
  newTag: {position: 'absolute', left: 8, bottom: 8, paddingVertical: 3, paddingHorizontal: 6, backgroundColor: colors.deep},
  newText: {fontFamily: fonts.mono, fontSize: 10, color: colors.text, letterSpacing: 0.5},
  pressed: {opacity: 0.72},
  footer: {paddingTop: 4, paddingBottom: 20},
  footerSpace: {height: 12},
});
