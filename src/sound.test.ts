import { describe, expect, it } from "vitest";
import {
  announcementsForDecision,
  announcementsFromLogs,
  cueForAction,
} from "./sound";
import type { DecisionAction, DecisionChoice } from "./game/decision";

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

  it("打牌后连同报牌朗读行动时保存的依据", () => {
    const chosen: DecisionChoice = {
      action: { type: "discard", tile: 0 },
      label: "打出 1万",
      summary: "先打缺门牌。",
      reason: "缺门未清，还需打出两张万字牌。",
      limit: "没有读取对手暗牌。",
    };
    expect(
      announcementsForDecision(
        {
          actual: chosen,
          recommended: chosen,
          matchesRecommendation: true,
        },
        ["0 号玩家打出 1万。", "本局种子 42，庄家为 0 号玩家。"],
      ),
    ).toEqual(["一万", "这步依据：缺门未清，还需打出两张万字牌。"]);
  });

  it("对手连续行动较多时仍保留本家首先打出的牌名", () => {
    const chosen: DecisionChoice = {
      action: { type: "discard", tile: 0 },
      label: "打出 1万",
      summary: "先打缺门牌。",
      reason: "先清缺门。",
      limit: "未预测未来摸牌。",
    };
    expect(
      announcementsForDecision(
        { actual: chosen, recommended: chosen, matchesRecommendation: true },
        [
          "0 号玩家打出 1万。",
          "1 号玩家打出 2条。",
          "2 号玩家打出 3筒。",
          "3 号玩家打出 4条。",
        ],
      ),
    ).toEqual(["一万", "三筒", "四条", "这步依据：先清缺门。"]);
  });

  it("玩家未按建议行动时区分实际选择与当时建议的依据", () => {
    const actual: DecisionChoice = {
      action: { type: "respond", choice: "pass" },
      label: "过",
      summary: "放弃碰牌。",
      reason: "保留当前手牌结构。",
      limit: "未预测后续摸牌。",
    };
    const recommended: DecisionChoice = {
      action: { type: "respond", choice: "pung" },
      label: "碰",
      summary: "碰牌后可改善结构。",
      reason: "碰后预计进张更多。",
      limit: "未预测后续摸牌。",
    };
    expect(
      announcementsForDecision(
        { actual, recommended, matchesRecommendation: false },
        [],
      ),
    ).toEqual([
      "你选择过。这步依据：保留当前手牌结构。",
      "系统建议碰。依据：碰后预计进张更多。",
    ]);
  });
});
