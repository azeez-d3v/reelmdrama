import type {ScreenInsets} from './theme';

export const SUBTITLE_METRICS = Object.freeze({
  fontSize: 22,
  lineHeight: 29,
  outlineRadius: 1.5,
  immersiveGutter: 24,
  controlsGutter: 76,
  immersiveBottom: 64,
  controlsBottom: 222,
});

// Native Text has no stroke property. Eight equal-radius replicas form a crisp
// contour around the foreground while retaining native wrapping/font scaling.
export const SUBTITLE_OUTLINE_OFFSETS = Object.freeze(
  Array.from({length: 8}, (_, i) => Object.freeze({
    x: Math.cos(i * Math.PI / 4) * SUBTITLE_METRICS.outlineRadius,
    y: Math.sin(i * Math.PI / 4) * SUBTITLE_METRICS.outlineRadius,
  })),
);

const inset = (value: number | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;

export function subtitleFrame(insets: ScreenInsets, chromeVisible: boolean) {
  // Match both gutters even with an asymmetric cutout: the line's midpoint
  // remains the video/screen midpoint. Visible controls need rail clearance.
  const gutter = (chromeVisible ? SUBTITLE_METRICS.controlsGutter : SUBTITLE_METRICS.immersiveGutter)
    + Math.max(inset(insets.left), inset(insets.right));
  return {
    left: gutter,
    right: gutter,
    bottom: inset(insets.bottom)
      + (chromeVisible ? SUBTITLE_METRICS.controlsBottom : SUBTITLE_METRICS.immersiveBottom),
  };
}
