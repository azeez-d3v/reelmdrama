import {useEffect} from 'react';
import {useVideoPlayer} from 'expo-video';

/** One silent, unattached player warms only the next episode's opening buffer. */
export function NextEpisodeWarmup({uri}: {uri: string}) {
  const player = useVideoPlayer(null, p => {
    p.muted = true;
    p.pause();
    p.loop = false;
    p.staysActiveInBackground = false;
    p.bufferOptions = {preferredForwardBufferDuration: 6, minBufferForPlayback: 0.5, maxBufferBytes: 2 * 1024 * 1024, prioritizeTimeOverSizeThreshold: false};
  });
  useEffect(() => {
    let alive = true;
    void player.replaceAsync({uri, contentType: 'hls', useCaching: true}).catch(() => {
      if (alive) try {player.pause();} catch {}
    });
    return () => {alive = false; try {player.pause();} catch {}};
  }, [player, uri]);
  return null;
}
