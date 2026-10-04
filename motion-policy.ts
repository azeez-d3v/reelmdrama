/** Sample a closed cosine cycle once; native interpolation drives every frame. */
export function pingPongOffsets(travel: number) {
  if (!Number.isFinite(travel) || travel < 0) throw new Error('INVALID_SIGNAL_TRAVEL');
  const inputRange = Array.from({length: 33}, (_, i) => i / 32);
  const outputRange = inputRange.map(phase => travel * ((1 - Math.cos(2 * Math.PI * phase)) / 2));
  // Pin endpoints exactly equal: the native loop resets phase, not the visible head.
  outputRange[0] = outputRange[32] = 0;
  return {inputRange, outputRange};
}
