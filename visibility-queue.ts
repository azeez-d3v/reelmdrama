/** Serialize native visibility writes: an older hide cannot finish after reveal. */
export function createVisibilityQueue(apply: (visible: boolean) => Promise<void>, onError: () => void = () => {}) {
  let tail: Promise<boolean> = Promise.resolve(true);
  return {
    request(visible: boolean): Promise<boolean> {
      tail = tail.then(async () => {
        try {await apply(visible); return true;} catch {try {onError();} catch {} return false;}
      });
      return tail;
    },
  };
}
