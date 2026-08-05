// lib/chess/random.ts — Shared randomness helpers for position/army generation.

/** Fisher–Yates shuffle returning a new array (does not mutate the input). */
export const shuffle = <T>(arr: T[]): T[] => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};
