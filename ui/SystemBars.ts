import {useCallback, useEffect, useRef} from 'react';
import {Platform} from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';
import {setStatusBarHidden} from 'expo-status-bar';
import {createVisibilityQueue} from '../visibility-queue';
import {record} from '../diagnostics';

export function useSystemBars(visible: boolean, appActive: boolean) {
  const queue = useRef<ReturnType<typeof createVisibilityQueue> | null>(null);
  if (!queue.current) queue.current = createVisibilityQueue(async show => {
    if (Platform.OS === 'android') await NavigationBar.setVisibilityAsync(show ? 'visible' : 'hidden');
  }, () => record('systemBarsError', {errorCategory: 'NATIVE_VISIBILITY_ERROR'}));
  const controller = queue.current;
  useEffect(() => {void controller.request(visible);}, [visible, appActive, controller]);
  useEffect(() => () => {void controller.request(true);}, [controller]);
  // Native Modal copies the Activity's bar state at creation. Restore first,
  // then mount its window instead of opening a sheet with inherited hidden bars.
  return useCallback(async () => {
    setStatusBarHidden(false, 'fade');
    await controller.request(true);
  }, [controller]);
}
