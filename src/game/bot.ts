import { suitOf, type Suit, type Tile } from "./tiles";

const suits: Suit[] = ["wan", "tiao", "tong"];

// 演示电脑只读取自己的手牌，选择是确定性的；不是教学建议。
export function chooseBotExchange(hand: readonly Tile[]): Tile[] {
  for (const suit of suits) {
    const candidate = hand.filter((item) => suitOf(item) === suit);
    if (candidate.length >= 3) return candidate.slice(0, 3);
  }
  throw new Error("无法选择换三张");
}

export function chooseBotMissing(hand: readonly Tile[]): Suit {
  return [...suits].sort(
    (a, b) =>
      hand.filter((item) => suitOf(item) === a).length -
      hand.filter((item) => suitOf(item) === b).length,
  )[0];
}

export function chooseBotDiscard(legalTiles: readonly Tile[]): Tile {
  if (legalTiles.length === 0) throw new Error("没有可打的牌");
  return legalTiles[0];
}
