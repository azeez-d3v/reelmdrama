import {Platform} from 'react-native';
import {setVideoCacheSizeAsync} from 'expo-video';

export const VIDEO_CACHE_BYTES = 128 * 1024 * 1024;
let initialization: Promise<boolean> | null = null;
/** Runs before mounting any player: Expo forbids changing cache size mid-playback. */
export function prepareVideoCache(): Promise<boolean> {
  initialization ??= Platform.OS === 'android'
    ? setVideoCacheSizeAsync(VIDEO_CACHE_BYTES).then(() => true, () => false)
    : Promise.resolve(false); // Expo's HLS disk cache is Android-only.
  return initialization;
}
