import { describe, expect, it } from "vitest";
import { analyzeScoredDraws } from "./teacherEvaluation";
import { hand } from "./testHelpers";
import { createWall, tile, type Tile } from "./tiles";
import type { PlayerView } from "./view";

function view(notation = "w11123429 s345678"): PlayerView {
  const owned = hand(notation);
  return {
    seat: 0,
    hand: owned,
    melds: [],
    missing: "tong",
    legalDiscards: [...new Set(owned)],
    ownDiscards: [],
    opponents: [1, 2, 3].map((seat) => ({
      seat,
      handCount: 13,
      melds: [],
      discards: [],
      missing: "tong",
      won: false,
      score: 0,
    })),
    wallRemaining: 55,
  };
}

// 小型未知牌池让抽样顺序与本桌收益可以手算；所有其余牌均已公开。
function withUnknownPool(
  current: PlayerView,
  pool: readonly Tile[],
): PlayerView {
  const publicTiles = createWall();
  for (const owned of [...current.hand, ...pool]) {
    publicTiles.splice(publicTiles.indexOf(owned), 1);
  }
  current.opponents[0].discards = publicTiles;
  return current;
}

describe("按本桌计分的未知牌摸牌模型", () => {
  it("公开待牌减少后，清一色较少进张也能有更高的计分收益", () => {
    const current = view("w1112344567779 s1");
    current.opponents[0].discards = hand("w88889");
    const [plain, flush] = analyzeScoredDraws(current, [
      tile("wan", 9),
      tile("tiao", 1),
    ]);
    expect(plain.winningDraws).toBe(3);
    expect(flush.winningDraws).toBe(2);
    expect(plain.oneDrawValue).toBeCloseTo((3 * 3 * (1 + 1)) / 89);
    expect(flush.oneDrawValue).toBeCloseTo((2 * 3 * (4 + 1)) / 89);
    expect(flush.twoDrawWinChance).toBeLessThan(plain.twoDrawWinChance);
    expect(flush.twoDrawValue).toBeGreaterThan(plain.twoDrawValue);
  });
  it("一摸平胡按每家底分加一计收入，桌面只剩一张时不再延伸", () => {
    const current = view();
    current.wallRemaining = 1;
    const [result] = analyzeScoredDraws(current, [tile("wan", 9)]);
    expect(result.drawsConsidered).toBe(94);
    expect(result.winningDraws).toBe(9);
    expect(result.oneDrawWinChance).toBeCloseTo(9 / 94);
    expect(result.oneDrawValue).toBeCloseTo((9 / 94) * 3 * (1 + 1));
    expect(result.twoDrawWinChance).toBe(result.oneDrawWinChance);
    expect(result.twoDrawValue).toBe(result.oneDrawValue);
  });

  it("公开耗尽的待牌不算成胡张数", () => {
    const current = view();
    current.opponents[0].discards = hand("w223335555");
    const [result] = analyzeScoredDraws(current, [tile("wan", 9)]);
    expect(result.winningDraws).toBe(0);
    expect(result.oneDrawWinChance).toBe(0);
    expect(result.oneDrawValue).toBe(0);
  });

  it("七对与清一色使用当前三番封顶，加底仍只加一", () => {
    const mixed = withUnknownPool(view("w112233 s44556679"), [tile("tiao", 7)]);
    const pure = withUnknownPool(view("w11223344556679"), [tile("wan", 7)]);
    const [sevenPairs] = analyzeScoredDraws(mixed, [tile("tiao", 9)]);
    const [flushPairs] = analyzeScoredDraws(pure, [tile("wan", 9)]);
    expect(sevenPairs.oneDrawWinChance).toBe(1);
    expect(sevenPairs.oneDrawValue).toBe(3 * (4 + 1));
    expect(flushPairs.oneDrawValue).toBe(3 * (8 + 1));
  });

  it("一摸成胡即停止，缺门摸牌必须先打缺再等第二摸", () => {
    const current = withUnknownPool(view(), [tile("wan", 2), tile("tong", 1)]);
    const [result] = analyzeScoredDraws(current, [tile("wan", 9)]);
    expect(result.oneDrawWinChance).toBe(0.5);
    expect(result.oneDrawValue).toBe(3);
    expect(result.twoDrawWinChance).toBe(1);
    expect(result.twoDrawValue).toBe(6);
  });

  it("第二摸扣除第一摸的副本，不能重复使用唯一的未知牌", () => {
    const current = withUnknownPool(view("w111234559 s34579"), [
      tile("tiao", 7),
      tile("tong", 1),
    ]);
    const [result] = analyzeScoredDraws(current, [tile("wan", 9)]);
    expect(result.oneDrawWinChance).toBe(0);
    expect(result.twoDrawWinChance).toBe(0);
    expect(result.twoDrawValue).toBe(0);

    const paired = withUnknownPool(view("w111234559 s34579"), [
      tile("tiao", 7),
      tile("tiao", 7),
    ]);
    const [pairResult] = analyzeScoredDraws(paired, [tile("wan", 9)]);
    expect(pairResult.oneDrawWinChance).toBe(0);
    expect(pairResult.twoDrawWinChance).toBe(1);
    expect(pairResult.twoDrawValue).toBe(6);
  });

  it("已胡对手退出后自摸收分相应降低，成胡模型不变", () => {
    const current = view();
    current.wallRemaining = 1;
    const [threePayers] = analyzeScoredDraws(current, [tile("wan", 9)]);
    current.opponents[0].won = true;
    const [twoPayers] = analyzeScoredDraws(current, [tile("wan", 9)]);
    expect(twoPayers.oneDrawWinChance).toBe(threePayers.oneDrawWinChance);
    expect(twoPayers.oneDrawValue).toBeCloseTo(
      (threePayers.oneDrawValue * 2) / 3,
    );
  });

  it("缺门未清、无牌墙或非法弃牌不生成估计", () => {
    const uncleared = view();
    uncleared.missing = "wan";
    expect(analyzeScoredDraws(uncleared, [tile("wan", 9)])).toEqual([]);
    const noWall = view();
    noWall.wallRemaining = 0;
    expect(analyzeScoredDraws(noWall, [tile("wan", 9)])).toEqual([]);
    expect(analyzeScoredDraws(view(), [tile("tiao", 1)])).toEqual([]);
  });

  it("只分析去重的合法候选，且不修改玩家视图与输入候选", () => {
    const current = view();
    const candidates = [tile("wan", 9), tile("wan", 9), tile("tiao", 1)];
    const before = structuredClone(current);
    const beforeCandidates = [...candidates];
    const results = analyzeScoredDraws(current, candidates);
    expect(results.map((result) => result.tile)).toEqual([tile("wan", 9)]);
    expect(current).toEqual(before);
    expect(candidates).toEqual(beforeCandidates);
  });
});
