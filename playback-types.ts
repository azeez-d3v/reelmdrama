import type {DramaDetail,ResolvedEpisode} from './services/types';
export type OfflineResolvedEpisode=Readonly<Pick<ResolvedEpisode,'identity'|'title'|'episodeNumber'|'type'|'englishSubtitleCues'|'subtitleStatus'|'languageQualification'>&{sourceId:'offline';downloadId:string;transport:'app-private-encrypted'}>;
export type PlaybackResolution=ResolvedEpisode|OfflineResolvedEpisode;
export type OfflineMetadata=Pick<OfflineResolvedEpisode,'identity'|'episodeNumber'|'type'|'englishSubtitleCues'|'subtitleStatus'>&{version:1;detail:Omit<DramaDetail,'episodes'>};
