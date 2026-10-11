import { describe, expect, it } from "vitest";
import {
  announcementsForDecision,
  announcementsFromLogs,
  cueForAction,
  selectChineseVoice,
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

  it("清缺门时只报牌，不重复朗读规则依据", () => {
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
          view: { missing: "wan" },
        },
        ["0 号玩家打出 1万。", "本局种子 42，庄家为 0 号玩家。"],
      ),
    ).toEqual(["一万"]);
    expect(
      announcementsForDecision(
        {
          actual: chosen,
          recommended: {
            ...chosen,
            action: { type: "discard", tile: 1 },
            label: "打出 2万",
          },
          matchesRecommendation: false,
          view: { missing: "wan" },
        },
        ["0 号玩家打出 1万。"],
      ),
    ).toEqual(["一万"]);
  });

  it("其他出牌只念行动时保存的简短结论，并保留本家报牌", () => {
    const chosen: DecisionChoice = {
      action: { type: "discard", tile: 9 },
      label: "打出 1条",
      summary: "打出后更接近听牌。",
      reason: "打出后估算向听下降，且有效进张增加；具体估算较长。",
      limit: "未预测未来摸牌。",
    };
    expect(
      announcementsForDecision(
        {
          actual: chosen,
          recommended: chosen,
          matchesRecommendation: true,
          view: { missing: "wan" },
        },
        [
          "0 号玩家打出 1条。",
          "1 号玩家打出 2条。",
          "2 号玩家打出 3筒。",
          "3 号玩家打出 4条。",
        ],
      ),
    ).toEqual(["一条", "三筒", "四条", "打出后更接近听牌。"]);
    expect(chosen.reason).toContain("具体估算较长");
  });

  it("换三张和定缺只报结果，偏离建议时简短提示推荐项", () => {
    const exchange: DecisionChoice = {
      action: { type: "exchange", tiles: [0, 1, 2] },
      label: "换出 1万、2万、3万",
      summary: "选择同一门的三张牌。",
      reason: "详细的基线策略说明。",
      limit: "未搜索交换结果。",
    };
    const missing: DecisionChoice = {
      action: { type: "missing", suit: "wan" },
      label: "定缺万",
      summary: "优先选择张数最少的一门。",
      reason: "详细的三门张数说明。",
      limit: "未比较搭子。",
    };
    const recommended: DecisionChoice = {
      ...missing,
      action: { type: "missing", suit: "tiao" },
      label: "定缺条",
    };
    expect(
      announcementsForDecision(
        {
          actual: exchange,
          recommended: exchange,
          matchesRecommendation: true,
          view: {},
        },
        [],
      ),
    ).toEqual(["换出 1万、2万、3万"]);
    expect(
      announcementsForDecision(
        {
          actual: missing,
          recommended,
          matchesRecommendation: false,
          view: {},
        },
        [],
      ),
    ).toEqual(["定缺万", "系统建议定缺条"]);
  });

  it("玩家未按建议行动时区分实际选择与当时建议的简短结论", () => {
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
        { actual, recommended, matchesRecommendation: false, view: {} },
        [],
      ),
    ).toEqual(["你选择过。放弃碰牌。", "系统建议碰。碰牌后可改善结构。"]);
  });

  it("优先使用用户选择的中文声音，不可用时回退本地普通话", () => {
    const voices = [
      {
        name: "Microsoft Huihui",
        lang: "zh-CN",
        localService: true,
        default: true,
      },
      {
        name: "Microsoft Kangkang",
        lang: "zh-CN",
        localService: true,
        default: false,
      },
      {
        name: "Online Natural",
        lang: "zh-CN",
        localService: false,
        default: false,
      },
    ];
    expect(selectChineseVoice(voices, "Microsoft Kangkang")).toBe(voices[1]);
    expect(selectChineseVoice(voices, "已卸载的声音")).toBe(voices[0]);
    expect(selectChineseVoice(voices)).toBe(voices[0]);
  });

  it("浏览器提供本地自然普通话时自动优先选择，不选其他语言", () => {
    const voices = [
      { name: "English", lang: "en-US", localService: true, default: true },
      { name: "Huihui", lang: "zh-CN", localService: true, default: false },
      {
        name: "Mandarin Natural",
        lang: "zh-CN",
        localService: true,
        default: false,
      },
    ];
    expect(selectChineseVoice(voices)).toBe(voices[2]);
  });
});
