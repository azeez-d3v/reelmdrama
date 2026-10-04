import React,{forwardRef,useCallback,useEffect,useImperativeHandle,useMemo,useRef} from 'react';
import {AppState,StyleSheet} from 'react-native';
import {useVideoPlayer,VideoView,type VideoSource} from 'expo-video';
import {record} from './diagnostics';
import {createSpeedBoost} from './speed-boost';
import type {ResolvedEpisode} from './services/types';
export type PlayerSnapshot={time:number;duration:number;playing:boolean;status:string;dimensions:{width:number;height:number};sourceLoadSeen:boolean;firstFrameRenderEvents:number;appState:string;bufferedPosition:number};
export const EMPTY_PLAYER:PlayerSnapshot={time:0,duration:0,playing:false,status:'idle',dimensions:{width:0,height:0},sourceLoadSeen:false,firstFrameRenderEvents:0,appState:'active',bufferedPosition:0};
export type ActiveSource={uri:string;resolution:ResolvedEpisode;loadId:string;sourceSessionId:string;startTime:number;autoplay:boolean;runId:string;releasePrepared?:()=>void};
export type PlayerControls={play:()=>void;pause:()=>void;seek:(seconds:number)=>void;snapshot:()=>PlayerSnapshot;isDesiredPlaying:()=>boolean;beginSpeedBoost:()=>boolean;endSpeedBoost:()=>void};
const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:0;
const sourceURI=(s:VideoSource|null)=>typeof s==='string'?s:s&&typeof s==='object'?'uri'in s?s.uri:null:null;
export const NativePlayer=forwardRef<PlayerControls,{source:ActiveSource;caching?:boolean;onSnapshot:(s:PlayerSnapshot)=>void;onEnded:()=>void;onRecovery:(position:number,autoplay:boolean)=>void}>(function NativePlayer({source,caching=false,onSnapshot,onEnded,onRecovery},ref){
 const accepted=useRef(false),frames=useRef(0),pendingFrame=useRef(false),alive=useRef(true),started=useRef(false),desired=useRef(source.autoplay);
 const callbacks=useRef({onSnapshot,onEnded,onRecovery});callbacks.current={onSnapshot,onEnded,onRecovery};
 const p=useVideoPlayer(null,x=>{x.preservesPitch=true;x.timeUpdateEventInterval=1;x.staysActiveInBackground=false;x.loop=false;x.bufferOptions={preferredForwardBufferDuration:15,minBufferForPlayback:1,maxBufferBytes:12*1024*1024,prioritizeTimeOverSizeThreshold:false};});
 // Expo's Android implementation defaults pitch preservation off despite its API docs.
 // Reassert it before every temporary/restored speed write so dialogue keeps its pitch.
 const boost=useMemo(()=>createSpeedBoost(()=>p.playbackRate,rate=>{p.preservesPitch=true;p.playbackRate=rate;}),[p]);
 const snap=useCallback(():PlayerSnapshot=>{try{return {time:finite(p.currentTime),duration:finite(p.duration),playing:p.playing,status:p.status,dimensions:{width:finite(p.videoTrack?.size.width),height:finite(p.videoTrack?.size.height)},sourceLoadSeen:accepted.current,firstFrameRenderEvents:frames.current,appState:AppState.currentState,bufferedPosition:finite(p.bufferedPosition)};}catch{return EMPTY_PLAYER;}},[p]);
 const emit=useCallback((event:string,extra:Record<string,unknown>={})=>{if(!alive.current)return;const s=snap();callbacks.current.onSnapshot(s);record(event,{...s,...extra,runId:source.runId,identity:source.resolution.identity,loadId:source.loadId,sourceSessionId:source.sourceSessionId,instanceId:source.loadId});},[snap,source]);
 const acceptFrame=useCallback(()=>{if(!accepted.current||p.status!=='readyToPlay'||!pendingFrame.current)return;pendingFrame.current=false;frames.current++;emit('firstFrameRender',{nativeRenderedFrame:true});},[p,emit]);
 const start=useCallback(()=>{if(started.current||!accepted.current||p.status!=='readyToPlay')return;started.current=true;if(source.startTime>0)p.currentTime=Math.min(source.startTime,Math.max(0,p.duration-.2));const en=p.availableSubtitleTracks.find(x=>/^(en|eng|english)(?:[-_]|$)/i.test(x.language??''));p.subtitleTrack=en??null;if(desired.current&&AppState.currentState==='active')p.play();},[p,source.startTime]);
 useImperativeHandle(ref,()=>({snapshot:snap,isDesiredPlaying:()=>desired.current,play(){desired.current=true;p.play();emit('controlApplied',{command:'play'});},pause(){boost.end();desired.current=false;p.pause();emit('controlApplied',{command:'pause'});},seek(seconds){const target=Math.max(0,Math.min(seconds,Math.max(0,p.duration-.2)));p.currentTime=target;emit('controlApplied',{command:'seek',targetTime:target});},beginSpeedBoost(){if(!accepted.current||p.status!=='readyToPlay'||!p.playing||AppState.currentState!=='active')return false;return boost.begin();},endSpeedBoost(){boost.end();}}),[p,snap,emit,boost]);
 useEffect(()=>{
  alive.current=true;emit('playerAttached');
  const subscriptions=[p.addListener('sourceLoad',e=>{if(sourceURI(e.videoSource)!==source.uri)return;accepted.current=true;emit('sourceLoad',{nativeSourceMatched:true});acceptFrame();start();}),p.addListener('statusChange',e=>{emit('statusChange',e.error?{errorCategory:'NATIVE_PLAYBACK_ERROR'}:{});acceptFrame();start();}),p.addListener('playingChange',()=>emit('playingChange')),p.addListener('timeUpdate',()=>emit('timeUpdate')),p.addListener('videoTrackChange',()=>emit('videoTrackChange')),p.addListener('playToEnd',()=>{const s=snap();if(accepted.current&&s.duration>0&&s.time>=s.duration-Math.min(1,s.duration*.02)){desired.current=false;emit('playToEnd');callbacks.current.onEnded();}})];
  let backgroundAt:number|null=null;
  const app=AppState.addEventListener('change',state=>{if(state!=='active'){boost.end();backgroundAt??=Date.now();p.pause();}else {const elapsed=backgroundAt===null?0:Date.now()-backgroundAt;backgroundAt=null;if(elapsed>=30000||Date.now()>=source.resolution.expiresAt-5000){p.pause();emit('foregroundRecoveryRequested',{backgroundMs:elapsed});callbacks.current.onRecovery(snap().time,desired.current);}else if(desired.current&&accepted.current)p.play();}emit('appStateChange',{appState:state});});
  p.replaceAsync({uri:source.uri,contentType:'hls',useCaching:caching}).catch(()=>emit('statusChange',{errorCategory:'NATIVE_LOAD_ERROR'}));
  const timer=setInterval(()=>emit('nativeSnapshot'),1000);
  return()=>{boost.end();try{p.pause();}catch{};emit('playerDisposed');alive.current=false;clearInterval(timer);app.remove();subscriptions.forEach(s=>s.remove());};
 },[p,source,caching,emit,start,acceptFrame,snap,boost]);
 return <VideoView testID="native-video" style={StyleSheet.absoluteFill} player={p} contentFit="contain" surfaceType="textureView" nativeControls={false} fullscreenOptions={{enable:false}} allowsPictureInPicture={false} onFirstFrameRender={()=>{if(alive.current){pendingFrame.current=true;acceptFrame();}}}/>;
});

