/** Local startup is settled even when fonts or optional media caching fall back. */
export function isLaunchReady(fontsLoaded: boolean, fontFailed: boolean, cacheSetup: boolean | null) {
  return (fontsLoaded || fontFailed) && cacheSetup !== null;
}

export function launchPresentation(ready: boolean, completed: boolean, reduced: boolean, active: boolean) {
  const visible = !completed && !(ready && !active);
  return {
    visible,
    blocking: visible && !ready,
    animateExit: visible && ready && active,
    spatialMotion: !reduced && active,
    exitDurationMs: reduced ? 90 : 220,
  };
}

/** A stopped native animation may deliver its callback synchronously. */
export function createLaunchLifetime() {
  let generation = 0, completed = false;
  return {
    begin: () => ++generation,
    invalidate: () => {++generation;},
    complete(ticket: number, finished: boolean) {
      if (!finished || completed || ticket !== generation) return false;
      completed = true;
      ++generation;
      return true;
    },
    get completed() {return completed;},
  };
}
