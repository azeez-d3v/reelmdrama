export interface ImmersionState {
  view: 'catalogue' | 'player';
  playing: boolean;
  loading: boolean;
  error: boolean;
  sheetOpen: boolean;
  appActive: boolean;
}

/** Only uninterrupted, foreground playback may dismiss the viewing chrome. */
export function controlsMayAutoHide(state: ImmersionState): boolean {
  return state.view === 'player' && state.playing === true && state.loading === false &&
    state.error === false && state.sheetOpen === false && state.appActive === true;
}

export function shouldShowChrome(state: ImmersionState, requestedVisible: boolean): boolean {
  return requestedVisible || !controlsMayAutoHide(state);
}
