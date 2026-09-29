export type Suit = "wan" | "tiao" | "tong";
export type Tile = number;

const suits: Suit[] = ["wan", "tiao", "tong"];

export function tile(suit: Suit, rank: number): Tile {
  const suitIndex = suits.indexOf(suit);
  if (suitIndex < 0 || !Number.isInteger(rank) || rank < 1 || rank > 9) {
    throw new Error("无效牌");
  }
  return suitIndex * 9 + rank - 1;
}

export function suitOf(value: Tile): Suit {
  if (!Number.isInteger(value) || value < 0 || value >= 27) {
    throw new Error("无效牌");
  }
  return suits[Math.floor(value / 9)];
}

export function labelOf(value: Tile): string {
  const suffix = { wan: "万", tiao: "条", tong: "筒" }[suitOf(value)];
  return `${(value % 9) + 1}${suffix}`;
}

export function createWall(): Tile[] {
  return Array.from(
    { length: 27 },
    (_, value) => Array(4).fill(value) as Tile[],
  ).flat();
}

// Fisher–Yates + mulberry32；洗牌算法改变时要同步提升牌谱版本。
export function shuffle(wall: readonly Tile[], seed: number): Tile[] {
  if (!Number.isInteger(seed)) throw new Error("种子须为整数");
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const result = [...wall];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(next() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function deal(wall: readonly Tile[]): { hands: Tile[][]; wall: Tile[] } {
  if (wall.length !== 108) throw new Error("发牌前须有 108 张牌");
  const hands: Tile[][] = [[], [], [], []];
  let cursor = 0;
  for (let round = 0; round < 13; round += 1) {
    for (let seat = 0; seat < 4; seat += 1) hands[seat].push(wall[cursor++]);
  }
  hands[0].push(wall[cursor++]);
  return { hands, wall: wall.slice(cursor) };
}
