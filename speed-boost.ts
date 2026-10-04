/** Temporary speed belongs to the captured player, never the next episode. */
export function createSpeedBoost(getRate: () => number, setRate: (rate: number) => void) {
  let previous: number | null = null;
  return {
    isActive: () => previous !== null,
    begin(): boolean {
      if (previous !== null) return true;
      let rate: number;
      try {
        rate = getRate();
        if (!Number.isFinite(rate) || rate <= 0 || rate > 16) return false;
        setRate(1.5);
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
