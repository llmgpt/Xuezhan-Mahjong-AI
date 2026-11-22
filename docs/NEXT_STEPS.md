# 下一步交接

## 当前状态

- 已合入默认开启的“先想后看”教学流程（[src/App.tsx](../src/App.tsx)、[src/components/AdviceCoach.tsx](../src/components/AdviceCoach.tsx)）：轮到玩家时先隐藏建议条与`荐`字角标；点击`揭晓本步建议`（或切换底栏`先想后看：开/关`）后**直接就地展开理由、备选与客观测算**，并在开局`换三张`、`选择定缺`及行牌阶段统一显示`荐`标识；未看提示直接出牌/响应后可通过底栏`刚这手复盘`（[src/components/TurnReviewDialog.tsx](../src/components/TurnReviewDialog.tsx)）回看当手建议。
- 已完成行牌/响应与桌面试玩交互修复（[src/components/tileBreakdown.ts](../src/components/tileBreakdown.ts)、[src/game/actionAdvice.ts](../src/game/actionAdvice.ts)、[src/components/settlementDetails.ts](../src/components/settlementDetails.ts)、[src/game/acceptRonTeacher.ts](../src/game/acceptRonTeacher.ts)、[src/game/v10Response.ts](../src/game/v10Response.ts)、[src/style.css](../src/style.css)）：血战途中对手胡牌亮出胡牌张、统一 `点胡` 牌数徽标并与 `candidatePublicCounts` 同步扣减对手自摸公开张，定缺清理阶段保留 `暗杠`/`补杠` 算账行与 `二八次边` 区分；`牌局设置` 重开复原种子、非法禁用且回车提交自动关闭，`玩法提示`/`对局记录` 弹窗同步暂停托管，展开建议时在 `1440×900` 与 `1280×720`/`1280×665` 较矮笔记本视口（含玩家多副露、对家暗杠/碰杠与响应按钮并发）下均保持桌面与弃牌区完整可读不遮挡。
- 已重构并打磨「换三张」与「定缺」教学启发式及人话解释（[src/game/openingAdvice.ts](../src/game/openingAdvice.ts)、[src/game/teacher.ts](../src/game/teacher.ts)、[src/components/setupAdvice.ts](../src/components/setupAdvice.ts)）：结合**主门保张、换后定缺清门成本、成组面子保留与清一色倾向**评估换牌并避开整对/整顺送出，修正跨花色备选等措辞；开发与目视复验已明确以桌面端浏览器为准（[AGENTS.md](../AGENTS.md)）。

## 下一步建议

1. **玩家实机试玩反馈**：当前桌面端核心局流、托管、复盘、流局查叫、暗杠/补杠与 `V10` 分歧均已实机走查，可由玩家直接试玩收集体验反馈。
2. **补全整局关键手时间线回看**：当前`刚这手复盘`仅保留最近一步快照，可按需扩展多步回顾。
3. **策略对照入口评估**：按 [PROJECT_PLAN.md](PROJECT_PLAN.md) 决定是否在牌局设置中提供“合理老师”与`V10`的切换或轻量对照说明。
4. **规则与策略边界**：规则改动须先更新 [RULES_V1.md](RULES_V1.md)；策略研究维持暂停（[research/README.md](research/README.md)）。

## 阻塞项

- 无阻塞；牌局状态与复盘快照仍只存在当前页面内存，未做持久化存档。

## 完成标准

- 种子 `7`、`15`、`35`、`36`、`37`、`45`、`520`、`888`、`999`、`2026`、`2027` 及随机开局桌面端试玩暴露的问题已全部修复，并通过 `npm run check`（`59` 组 `576` 条测试）与 Chrome 桌面目视复验（`0` 控制台报错）。
