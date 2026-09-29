import { tile, type Tile } from "./tiles";

export function hand(groups: string): Tile[] {
  return groups.split(" ").flatMap((group) => {
    const suit = { w: "wan", s: "tiao", d: "tong" }[group[0]] as
      "wan" | "tiao" | "tong";
    return [...group.slice(1)].map((rank) => tile(suit, Number(rank)));
  });
}
