import { describe, expect, it } from "vitest";
import { announcementsFromLogs, cueForAction } from "./sound";
import type { DecisionAction } from "./game/decision";

describe("牌桌声效提示", () => {
  it.each<{
    action: DecisionAction;
    ended: boolean;
    cue: string;
  }>([
    {
      action: { type: "exchange", tiles: [0, 1, 2] },
      ended: false,
      cue: "select",
    },
    { action: { type: "missing", suit: "wan" }, ended: false, cue: "select" },
    { action: { type: "discard", tile: 0 }, ended: false, cue: "tile" },
    {
      action: { type: "respond", choice: "pass" },
      ended: false,
      cue: "select",
    },
    { action: { type: "respond", choice: "pung" }, ended: false, cue: "meld" },
    {
      action: { type: "kong", kind: "concealed", tile: 0 },
      ended: false,
      cue: "meld",
    },
    { action: { type: "respond", choice: "hu" }, ended: false, cue: "win" },
    { action: { type: "win" }, ended: true, cue: "win" },
    { action: { type: "discard", tile: 0 }, ended: true, cue: "finish" },
  ])("将 $action.type 映射为 $cue", ({ action, ended, cue }) => {
    expect(cueForAction(action, ended)).toBe(cue);
  });

  it("只从公开动作记录生成中文报牌，不朗读摸牌和种子", () => {
    expect(
      announcementsFromLogs([
        "本局种子 42，庄家为 0 号玩家。",
        "0 号玩家打出 1万。",
        "1 号玩家打出 9条。",
        "2 号玩家碰 5筒。",
        "2 号玩家直杠 5筒。",
        "3 号玩家自摸 7万，平胡。",
        "1 号玩家胡 0 号玩家 3条，平胡。",
        "已有三家胡牌，本局结束。",
      ]),
    ).toEqual([
      "一万",
      "九条",
      "碰五筒",
      "杠五筒",
      "自摸七万",
      "胡牌三条",
      "本局结束",
    ]);
  });
});
