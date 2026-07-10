export function keyBy<T>(arr: T[], fn: (item: T) => string): Record<string, T> {
  const result: Record<string, T> = {};
  for (const item of arr) {
    result[fn(item)] = item;
  }
  return result;
}

export function sortBy<T>(arr: T[], fn: (item: T) => string | number): T[] {
  return [...arr].toSorted((a, b) => {
    const va = fn(a);
    const vb = fn(b);
    return va < vb ? -1 : va > vb ? 1 : 0;
  });
}

export function uniqBy<T>(arr: T[], fn: (item: T) => unknown): T[] {
  const seen = new Set();
  return arr.filter((item) => {
    const key = fn(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
