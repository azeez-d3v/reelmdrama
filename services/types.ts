export type AudioEvidence = 'sampled-english' | 'dubbed-label-unverified' | 'unknown' | 'sampled-non-english';
export type DramaPlatform = Readonly<{name:string;logo:string|null;count:number}>;
export type DramaPlatformDirectory = Readonly<{platforms:readonly DramaPlatform[];receipt:SourceReceipt;cached:boolean}>;
export type DramaCard = Readonly<{
  id:string;slug:string;title:string;platform:string;cover:string|null;
  totalEpisodes:number;availableEpisodes:number;catalogueLanguage:'en';
  audioEvidence:AudioEvidence;languageQualification:string;isNew:boolean;isPopular:boolean;
  countWarning:string|null;
}>;
export type Episode = Readonly<{number:number;advertisedAvailable:boolean;qualification:string}>;
export type DramaDetail = Readonly<DramaCard&{
  description:string;episodesInDB:number;episodes:readonly Episode[];
  sourceDeclaredLanguage:'en';sourceDeclaredMode:string|null;
  subtitleEvidence:'prior-sampled-english-captions'|'unverified';
  sampledEnglishEpisodes:readonly number[];
  receipt:SourceReceipt|null;cached:boolean;
}>;
export type SourcePage = Readonly<{
  items:readonly DramaCard[];total:number;page:number;pages:number;limit:number;
  receipt:SourceReceipt;cached:boolean;
}>;
export type DramaHome = Readonly<{
  hero:readonly DramaCard[];rows:readonly Readonly<{key:string;title:string;total:number;items:readonly DramaCard[]}>[];
  platforms:readonly DramaPlatform[];receipt:SourceReceipt;cached:boolean;
}>;
export type SourceRequestReceipt = Readonly<{
  lane:'guest-config'|'platforms'|'catalogue'|'search'|'home'|'detail'|'manifest'|'subtitle-index'|'english-subtitle';
  host:'dramadunyam.com';pathSHA256:string;status:number;bytesRead:number;bodySHA256:string;
}>;
export type SourceReceipt = Readonly<{requestId:string;requestProfile:'observed-desktop-UA';requests:readonly SourceRequestReceipt[];freshGuestSessionReceived:boolean;cached:boolean}>;
export type SubtitleCue = Readonly<{start:number;end:number;text:string}>;
export type ResolvedEpisode = Readonly<{
  sourceId:'dramadunyam';identity:Readonly<{seriesId:string;slug:string;platform:string;episodeNumber:number}>;
  title:string;episodeNumber:number;type:'hls';manifestBody:string;manifestSHA256:string;
  referenceHosts:readonly string[];referenceCount:number;expiresAt:number;
  englishSubtitleCues:readonly SubtitleCue[];subtitleStatus:'english-sidecar'|'no-english-sidecar'|'unavailable';
  receipt:SourceReceipt;transport:'app-cache-manifest-direct-https-segments';
  cdnCredentialsAttached:false;languageQualification:string;
}>;
export type CatalogueOptions = Readonly<{platform?:string;page?:number}>;
export type SearchOptions = Readonly<{page?:number}>;
export type SourceFailureCode = 'ABORTED'|'DEADLINE_EXCEEDED'|'NETWORK_ERROR'|'BODY_LIMIT'|'INVALID_JSON'|'INVALID_CONTENT_TYPE'|'REDIRECT_REJECTED'|'FRESH_GUEST_SESSION_MISSING'|'INVALID_PLATFORM'|'INVALID_CARD'|'INVALID_PAGE'|'INVALID_DETAIL'|'DETAIL_IDENTITY_MISMATCH'|'DETAIL_NOT_ISSUED'|'INVALID_EPISODE'|'EPISODE_NOT_ADVERTISED'|'INVALID_MANIFEST'|'UNSUPPORTED_MANIFEST'|'UNSAFE_MEDIA_REFERENCE'|'INVALID_SUBTITLE'|'INVALID_SEARCH'|'INVALID_HOME'|`HTTP_${number}`;
export class SourceError extends Error {
  readonly code:SourceFailureCode;readonly receipt:SourceReceipt|null;
  constructor(code:SourceFailureCode,receipt:SourceReceipt|null=null){super(code);this.name='SourceError';this.code=code;this.receipt=receipt;}
}
