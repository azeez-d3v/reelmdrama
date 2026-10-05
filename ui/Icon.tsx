import React, {memo} from 'react';
import Svg, {Circle, Path, Rect} from 'react-native-svg';
import {colors} from '../theme';

export type IconName = 'home' | 'search' | 'bookmark' | 'play' | 'pause' | 'back' | 'close' | 'heart' | 'episodes' | 'next' | 'previous' | 'retry' | 'volume' | 'muted' | 'check' | 'chevron' | 'captions' | 'download' | 'settings';
const paths: Record<IconName, string> = {
  settings: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
  home: 'M3 10.5 12 3l9 7.5V21h-6v-7H9v7H3V10.5Z',
  search: 'M16.5 16.5 21 21',
  bookmark: 'M6 3h12v18l-6-4-6 4V3Z',
  play: 'M8 4.5 20 12 8 19.5V4.5Z',
  pause: 'M7 4h3v16H7V4Zm7 0h3v16h-3V4Z',
  back: 'M15 5 8 12l7 7M8 12h13',
  close: 'M5 5 19 19M19 5 5 19',
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
  episodes: 'M3 4h18v5H3V4Zm0 8h18v8H3v-8Zm6-8v5M9 12v8',
  next: 'M5 5 15 12 5 19V5Zm14 0v14',
  previous: 'M19 5 9 12l10 7V5ZM5 5v14',
  retry: 'M20 9a8 8 0 1 0 .3 6M20 3v6h-6',
  volume: 'M4 9h4l5-4v14l-5-4H4V9Zm12-1a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14',
  muted: 'M4 9h4l5-4v14l-5-4H4V9Zm13 0 5 6M22 9l-5 6',
  check: 'M4 12 9 17 20 6',
  chevron: 'M9 5 16 12 9 19',
  captions: 'M8.5 9a3 3 0 1 0 0 6M17.5 9a3 3 0 1 0 0 6',
  download: 'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',
};

export const Icon = memo(function Icon({name, size = 24, color = colors.text, filled = false}: {name: IconName; size?: number; color?: string; filled?: boolean}) {
  const shapeFilled = filled && (name === 'heart' || name === 'bookmark' || name === 'home' || name === 'play' || name === 'pause');
  return <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    {name === 'search' ? <Circle cx={10.5} cy={10.5} r={7} fill="none" stroke={color} strokeWidth={1.8} /> : null}
    {name === 'captions' ? <Rect x={2} y={5} width={20} height={14} rx={2} fill="none" stroke={color} strokeWidth={1.8} /> : null}
    <Path d={paths[name]} fill={shapeFilled ? color : 'none'} stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>;
});

export const ReelmMark = memo(function ReelmMark({size = 32}: {size?: number}) {
  return <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Rect x={4} y={4} width={56} height={56} rx={14} fill={colors.deep} stroke={colors.outline} strokeWidth={2} />
    <Path d="M17 50V14h17c11.1 0 18 5.9 18 15.8 0 6.3-3.5 11.1-9.7 13.5L52 50H38.8l-8.7-7H28v7H17Zm11-26v10h5l9-5-9-5h-5Z" fill={colors.signal} fillRule="evenodd" />
  </Svg>;
});
