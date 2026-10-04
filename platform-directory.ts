import type {DramaPlatform, DramaPlatformDirectory} from './services/types.ts';

export type PlatformDirectoryState = Readonly<{platforms: readonly DramaPlatform[]; loading: boolean; error: string | null}>;
type Options = Readonly<{
  load: (signal: AbortSignal) => Promise<DramaPlatformDirectory>;
  onState: (state: PlatformDirectoryState) => void;
  describeError: (error: unknown) => string;
  onReady?: (directory: DramaPlatformDirectory) => void;
  onError?: (error: unknown) => void;
}>;
const transient = new Set(['NETWORK_ERROR', 'DEADLINE_EXCEEDED', 'HTTP_500', 'HTTP_502', 'HTTP_503', 'HTTP_504']);
function retryable(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && transient.has(String(error.code));
}

/** Independent from catalogue loading: an error cannot silently erase filtering. */
export function createPlatformDirectoryLoader(options: Options) {
  let state: PlatformDirectoryState = Object.freeze({platforms: Object.freeze([]), loading: false, error: null});
  let generation = 0, disposed = false, current: AbortController | null = null;
  const publish = (patch: Partial<PlatformDirectoryState>) => {
    state = Object.freeze({...state, ...patch});
    options.onState(state);
  };
  async function refresh(): Promise<boolean> {
    if (disposed) return false;
    const ticket = ++generation;
    current?.abort();
    const controller = new AbortController();
    current = controller;
    const live = () => !disposed && ticket === generation && !controller.signal.aborted;
    publish({loading: true, error: null});
    try {
      // One bounded recovery attempt, never an endless retry or validation bypass.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const directory = await options.load(controller.signal);
          if (!live()) return false;
          publish({platforms: directory.platforms, loading: false, error: null});
          options.onReady?.(directory);
          return true;
        } catch (error) {
          if (!live()) return false;
          if (error && typeof error === 'object' && 'code' in error && error.code === 'ABORTED') {
            publish({loading: false});
            return false;
          }
          if (attempt === 0 && retryable(error)) continue;
          publish({loading: false, error: options.describeError(error)});
          options.onError?.(error);
          return false;
        }
      }
      return false;
    } finally {
      if (current === controller) current = null;
    }
  }
  return Object.freeze({refresh, snapshot: () => state, dispose: () => {disposed = true; ++generation; current?.abort(); current = null;}});
}
