import {ScaledText as Text} from './ScaledText';
import React, {memo, useCallback, useMemo, useEffect, useState} from 'react';
import {FlatList, Image, Modal, Pressable, ScrollView, StyleSheet,  View, useWindowDimensions, type ListRenderItemInfo} from 'react-native';
import type {DramaDetail, Episode} from '../services/types';
import {colors, fonts, layout, radius, type} from '../theme';
import {ActionButton, IconButton, StatePanel} from './Primitives';
import type {WatchProgress} from '../library-policy';
import {formatTime} from './format';
import {safeInset} from './format';
import {MeasurementProvider, NativeMeasurementRoot, useNativeMeasurement} from './measurement';
import {useReducedMotion} from './Motion';
const EpisodeKey = memo(function EpisodeKey({episode, current, onSelect,offline=false,download=false}: {offline?:boolean;download?:boolean;episode: Episode; current: boolean; onSelect: (episode: number) => void}) {
  const select = useCallback(() => onSelect(episode.number), [onSelect, episode.number]);
  const measured = useNativeMeasurement(`episode-${episode.number}`, {safeAreaRequired: true, interactive: true});
  return <View style={styles.episodeCell}><Pressable {...measured} disabled={!offline&&!episode.advertisedAvailable} accessibilityRole="button" accessibilityLabel={`${download?'Download episode':'Episode'} ${episode.number}${current ? ', currently selected' : ''}${!episode.advertisedAvailable ? ', unavailable' : ''}`} accessibilityState={{selected: current, disabled: !offline&&!episode.advertisedAvailable}} testID={`${download?'episode-download':'episode'}-${episode.number}`} onPress={select}
    android_ripple={{color: colors.ripple}} style={({pressed}) => [styles.episodeKey, current ? styles.episodeKeyCurrent : null, !episode.advertisedAvailable ? styles.unavailable : null, pressed ? styles.pressed : null]}>
    <Text style={[styles.episodeNumber, current ? styles.episodeNumberCurrent : null]}>E{String(episode.number).padStart(2, '0')}</Text>
  </Pressable></View>;
});
function DownloadChooser({episodes,onEpisode,onSeries}:{episodes:readonly Episode[];onEpisode:(n:number)=>void;onSeries?:()=>void}) {
  return <FlatList testID="downloads-choice-list" data={episodes} numColumns={4} keyExtractor={item=>String(item.number)} renderItem={({item})=><EpisodeKey episode={item} current={false} onSelect={onEpisode} download/>}
    ListHeaderComponent={<View style={styles.downloadHeading}>{onSeries?<ActionButton label="Download whole series" icon="download" onPress={onSeries} testID="downloads-choice-series"/>:null}<Text style={styles.detailQualification}>Or choose an episode below. Progress and storage are in Settings → Downloads.</Text></View>}
    columnWrapperStyle={styles.episodeRow} contentContainerStyle={styles.episodeGrid} initialNumToRender={24} maxToRenderPerBatch={24} windowSize={5} showsVerticalScrollIndicator={false}/>
}
export interface EpisodeSheetProps {offline?:boolean;onDownload?:(n:number)=>void;onDownloadSeries?:()=>void;episodes: readonly Episode[]; currentEpisode: number; onSelect: (episode: number) => void; onClose: () => void; bottomInset?: number; visible?: boolean; title?: string}
export const EpisodeSheet = memo(function EpisodeSheet({offline=false,onDownload,onDownloadSeries,episodes, currentEpisode, onSelect, onClose, bottomInset = 0, visible = true, title = 'Choose an episode'}: EpisodeSheetProps) {
  const {height} = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const [downloadsOpen,setDownloadsOpen]=useState(false);
  useEffect(()=>setDownloadsOpen(false),[episodes,visible,offline]);
  const render = useCallback(({item}: ListRenderItemInfo<Episode>) => <EpisodeKey episode={item} current={item.number === currentEpisode} onSelect={onSelect} offline={offline}/>, [currentEpisode, onSelect,offline]);
  const choosing=downloadsOpen&&!offline&&!!onDownload;
  return <MeasurementProvider view="episodes" variant={`${currentEpisode}/${visible}/${episodes.length}`}><Modal transparent visible={visible} animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
    <NativeMeasurementRoot calibrationId="episodes-dialog" style={styles.modalFrame}><Pressable style={styles.backdrop} accessibilityRole="button" accessibilityLabel="Close episode selector" onPress={onClose} />
      <View style={[styles.sheet, {maxHeight: height * 0.78, paddingBottom: Math.max(16, safeInset(bottomInset))}]}>
        <View style={styles.sheetHeader}>{choosing?<IconButton icon="back" label="Back to episodes" onPress={()=>setDownloadsOpen(false)} testID="downloads-choice-back"/>:null}<Text style={styles.sheetTitle}>{choosing?'Download episodes':title}</Text>{!choosing&&!offline&&onDownload?<IconButton icon="download" label="Download episodes" onPress={()=>setDownloadsOpen(true)} testID="episodes-download"/>:null}<IconButton icon="close" label="Close episodes" onPress={onClose} testID="episodes-close" /></View>
        {choosing?<DownloadChooser episodes={episodes} onEpisode={n=>{setDownloadsOpen(false);onDownload!(n);}} onSeries={onDownloadSeries?()=>{setDownloadsOpen(false);onDownloadSeries();}:undefined}/>:<>
        <Text style={styles.episodeQualification}>{offline?'Only completed downloads play offline. Missing episodes show unavailable; no network fallback.':'The source lists these episodes. Availability is checked when you press play.'}</Text>
        <FlatList data={episodes} numColumns={4} keyExtractor={item => String(item.number)} renderItem={render} extraData={currentEpisode} columnWrapperStyle={styles.episodeRow} contentContainerStyle={styles.episodeGrid} showsVerticalScrollIndicator={false} initialNumToRender={24} maxToRenderPerBatch={24} windowSize={5}
          ListEmptyComponent={<StatePanel kind="empty" title="No episodes listed yet." message="Try loading this story again." />} /></>}
      </View>
    </NativeMeasurementRoot>
  </Modal></MeasurementProvider>;
});
export interface SeriesDetailSheetProps {offline?:boolean;onDownloadEpisode?:(n:number)=>void;onDownloadSeries?:()=>void;detail: DramaDetail | null; loading: boolean; error: string | null; saved: boolean; progress?:WatchProgress;onWatch:()=>void; onClose: () => void; onWatchEpisode: (episode: number) => void; onToggleSave: () => void; onRetry: () => void; bottomInset?: number; topInset?: number; visible?: boolean}
export const SeriesDetailSheet = memo(function SeriesDetailSheet({offline=false,onDownloadEpisode,onDownloadSeries,detail, loading, error, saved, progress, onWatch, onClose, onWatchEpisode, onToggleSave, onRetry, bottomInset = 0, topInset = 0, visible = true}: SeriesDetailSheetProps) {
  const {height} = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const [downloadsOpen,setDownloadsOpen]=useState(false);
  useEffect(()=>setDownloadsOpen(false),[detail?.id,visible,offline]);
  const choosing=downloadsOpen&&!offline&&!!onDownloadEpisode;
  const firstEpisode = useMemo(() => detail?.episodes.find(episode => episode.advertisedAvailable)?.number ?? null, [detail]);
  const missing=!offline&&!!progress&&!detail?.episodes[progress.episode-1]?.advertisedAvailable;
  const watch=onWatch;
  const render = useCallback(({item}: ListRenderItemInfo<Episode>) => <EpisodeKey episode={item} current={false} onSelect={onWatchEpisode} offline={offline}/>, [onWatchEpisode,offline]);
  const audio = detail?.audioEvidence === 'sampled-english' ? 'Sampled English audio' : detail?.audioEvidence === 'dubbed-label-unverified' ? 'Dubbed · audio unverified' : detail?.audioEvidence === 'sampled-non-english' ? 'Original audio' : 'Audio as provided';
  const header = detail ? <View style={styles.detailContent}>
    <View style={styles.detailTop}>
      {detail.cover ? <Image source={{uri: detail.cover}} resizeMode="cover" accessibilityLabel={`${detail.title} poster`} style={styles.detailCover} /> : <View style={styles.detailCoverFallback}><Text style={styles.noCover}>No artwork</Text></View>}
      <View style={styles.detailHeading}><Text style={styles.detailPlatform}>{detail.platform}</Text><Text style={styles.detailTitle}>{detail.title}</Text>
        <Text style={styles.detailCounts}>{detail.totalEpisodes} episodes</Text>
        {detail.countWarning ? <Text style={styles.audioEvidence}>Source episode counts need verification.</Text> : null}
        <Text style={styles.audioEvidence}>{audio}</Text>
        {detail.subtitleEvidence === 'prior-sampled-english-captions' ? <Text style={styles.audioEvidence}>English captions seen in sampled episodes</Text> : null}
      </View>
    </View>
    {detail.description ? <Text style={styles.description}>{detail.description}</Text> : <Text style={styles.description}>No synopsis is available for this story yet.</Text>}
    <Text style={styles.detailQualification}>English catalogue. Spoken audio and captions vary by episode; source listings do not guarantee playback.</Text>
    {missing?<Text style={styles.detailQualification}>Choose an episode. The saved episode is no longer listed.</Text>:null}
    <Text style={styles.episodesHeading}>Episodes</Text>
  </View> : null;
  return <MeasurementProvider view="detail" variant={`${detail?.id ?? ''}/${loading}/${visible}`}><Modal transparent visible={visible} animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
    <NativeMeasurementRoot calibrationId="detail-dialog" style={styles.modalFrame}><Pressable style={styles.backdrop} accessibilityRole="button" accessibilityLabel="Close story details" onPress={onClose} />
      <View style={[styles.sheet, {maxHeight: height - safeInset(topInset) - 16, paddingBottom: Math.max(12, safeInset(bottomInset))}]}>
        <View style={styles.sheetHeader}>{choosing?<IconButton icon="back" label="Back to story details" onPress={()=>setDownloadsOpen(false)} testID="downloads-choice-back"/>:null}<Text style={styles.sheetTitle}>{choosing?'Download episodes':'Story details'}</Text><IconButton icon="close" label="Close story details" onPress={onClose} testID="details-close" /></View>
        {loading && !detail ? <ScrollView contentContainerStyle={styles.detailState}><StatePanel kind="loading" title="Opening this story…" /></ScrollView> : error ? <ScrollView contentContainerStyle={styles.detailState}><StatePanel kind="error" title="This story didn’t load." message={error} onRetry={onRetry} /></ScrollView> : detail ? choosing?<DownloadChooser episodes={detail.episodes} onEpisode={n=>{setDownloadsOpen(false);onDownloadEpisode!(n);}} onSeries={onDownloadSeries?()=>{setDownloadsOpen(false);onDownloadSeries();}:undefined}/>:<FlatList data={detail.episodes} numColumns={4} keyExtractor={item => String(item.number)} renderItem={render} ListHeaderComponent={header} columnWrapperStyle={styles.episodeRow} contentContainerStyle={styles.detailList} showsVerticalScrollIndicator={false} initialNumToRender={16} maxToRenderPerBatch={16} windowSize={5} /> : <View style={styles.detailState}><StatePanel kind="empty" title="This story isn’t available." onRetry={onRetry} /></View>}
        {detail && !error && !choosing ? <View style={styles.detailActions}><ActionButton label={missing?'Choose an episode':progress?`Resume · Ep ${progress.episode} · ${formatTime(progress.time)}`:'Start watching'} icon="play" onPress={watch} disabled={loading || !offline&&firstEpisode === null || missing} testID="details-watch" style={styles.watchButton} /><IconButton icon="bookmark" label={saved ? 'Remove from saved on this device' : 'Save on this device'} onPress={onToggleSave} active={saved} testID="details-save" />{!offline&&onDownloadEpisode?<IconButton icon="download" label="Download episodes" onPress={()=>setDownloadsOpen(true)} disabled={loading} testID="details-download"/>:null}</View> : null}
      </View>
    </NativeMeasurementRoot>
  </Modal></MeasurementProvider>;
});
const styles = StyleSheet.create({
  modalFrame: {flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)'},
  backdrop: {flex: 1},
  sheet: {backgroundColor: colors.background, borderTopLeftRadius: radius.panel, borderTopRightRadius: radius.panel, overflow: 'hidden', flexShrink: 1, borderTopWidth: 1, borderColor: colors.outline},
  sheetHeader: {flexDirection: 'row', alignItems: 'center', paddingLeft: layout.gutter, paddingRight: 8, paddingTop: 8, paddingBottom: 8, gap: 8},
  sheetTitle: {...type.title, color: colors.text, flex: 1},
  episodeQualification: {...type.small, color: colors.secondary, paddingHorizontal: layout.gutter, paddingBottom: 18},
  episodeGrid: {paddingHorizontal: layout.gutter, paddingBottom: 8},
  episodeRow: {gap: 8},
  episodeCell: {flex:1,gap:4,marginBottom:8},
  episodeKey: {flex: 1, minWidth: layout.touchTarget, minHeight: 56, marginBottom: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.control, justifyContent: 'center', alignItems: 'center'},
  episodeKeyCurrent: {backgroundColor: colors.signal, borderColor: colors.signal},
  episodeNumber: {fontFamily: fonts.mono, fontSize: 14, lineHeight: 20, color: colors.text},
  episodeNumberCurrent: {color: colors.onSignal},
  unavailable: {opacity: 0.38},
  pressed: {opacity: 0.65},
  detailContent: {gap: 18, paddingTop: 8, paddingBottom: 12},
  detailTop: {flexDirection: 'row', gap: 16, alignItems: 'flex-start'},
  detailCover: {width: 106, height: 159, borderRadius: radius.media, backgroundColor: colors.surface},
  detailCoverFallback: {width: 106, height: 159, borderRadius: radius.media, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center'},
  noCover: {...type.small, color: colors.muted},
  detailHeading: {flex: 1, gap: 8},
  detailPlatform: {...type.small, color: colors.secondary},
  detailTitle: {...type.title, color: colors.text},
  detailCounts: {...type.measure, color: colors.muted},
  audioEvidence: {...type.small, color: colors.secondary},
  description: {...type.body, color: colors.text},
  detailQualification: {...type.small, color: colors.muted},
  episodesHeading: {...type.title, color: colors.text, marginTop: 4},
  detailList: {paddingHorizontal: layout.gutter, paddingBottom: 8},
  detailState: {paddingHorizontal: layout.gutter, minHeight: 160},
  detailActions: {flexDirection: 'row', gap: 12, paddingHorizontal: layout.gutter, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.line},
  watchButton: {flex: 1, minWidth: 0},
  downloadHeading: {gap: 16, paddingVertical: 12},
});
