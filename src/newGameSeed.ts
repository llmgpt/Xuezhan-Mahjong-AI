function randomUint32(): number {
  const value = new Uint32Array(1);
  try {
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(value);
      return value[0];
    }
  } catch {
    // 没有浏览器随机源时，仍可开始一局。
  }
  return Math.floor(Math.random() * 0x100000000);
}

export function newGameSeed(
  previous?: number,
  candidate = randomUint32(),
): number {
  const seed = candidate >>> 0;
  const lastSeed = previous === undefined ? undefined : previous >>> 0;
  return seed === lastSeed ? (seed + 1) >>> 0 : seed;
}
