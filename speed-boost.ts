/** Temporary speed belongs to the captured player, never the next episode. */
export function createSpeedBoost(getRate: () => number, setRate: (rate: number) => void) {
  let previous: number | null = null;
  return {
    isActive: () => previous !== null,
    begin(requested = 1.5): boolean {
      if (previous !== null) return true;
      if (![1.25, 1.5, 1.75, 2].includes(requested)) return false;
      let rate: number;
      try {
        rate = getRate();
        if (!Number.isFinite(rate) || rate <= 0 || rate > 16) return false;
        setRate(requested);
      } catch {return false;}
      previous = rate;
      return true;
    },
    end(): boolean {
      if (previous === null) return false;
      const rate = previous;
      try {setRate(rate); previous = null; return true;} catch {return false;}
    },
  };
}
