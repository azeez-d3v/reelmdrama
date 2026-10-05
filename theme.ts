export const colors = Object.freeze({
  background: '#0b0f0c',
  deep: '#070907',
  surface: '#121813',
  surfaceHigh: '#19221b',
  line: '#273128',
  outline: '#4b5f4e',
  text: '#f0ead8',
  secondary: '#c0b9a6',
  muted: '#849086',
  signal: '#d7ff5f',
  onSignal: '#0b0f0c',
  error: '#ffc1b6',
  scrim: 'rgba(7,9,7,0.82)',
  videoScrim: 'rgba(7,9,7,0.60)',
  ripple: 'rgba(215,255,95,0.15)',
});

export const fonts = Object.freeze({sans: 'Geist', bold: 'GeistBold', mono: 'GeistMono'});
export const space = Object.freeze({xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32});
export const radius = Object.freeze({control: 2, media: 4, panel: 8});
export const layout = Object.freeze({touchTarget: 48, gutter: 20, navHeight: 68, headerHeight: 64});

export const type = Object.freeze({
  display: {fontFamily: fonts.bold, fontSize: 32, lineHeight: 37, letterSpacing: -0.8},
  headline: {fontFamily: fonts.bold, fontSize: 25, lineHeight: 30, letterSpacing: -0.5},
  title: {fontFamily: fonts.bold, fontSize: 18, lineHeight: 24, letterSpacing: -0.2},
  body: {fontFamily: fonts.sans, fontSize: 15, lineHeight: 22},
  label: {fontFamily: fonts.bold, fontSize: 13, lineHeight: 18},
  small: {fontFamily: fonts.sans, fontSize: 12, lineHeight: 17},
  measure: {fontFamily: fonts.mono, fontSize: 11, lineHeight: 16, letterSpacing: 0.4},
});

export interface ScreenInsets {top: number; bottom: number; left?: number; right?: number}
export type MainTab = 'home' | 'saved' | 'settings';
