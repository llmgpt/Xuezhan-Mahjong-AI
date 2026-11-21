# 下一步交接

## 当前状态

- 已合入默认开启的“先想后看”教学流程（[src/App.tsx](../src/App.tsx)、[src/components/AdviceCoach.tsx](../src/components/AdviceCoach.tsx)）：轮到玩家时先隐藏建议条与`荐`字角标；点击`揭晓本步建议`（或切换底栏`先想后看：开/关`）后**直接就地展开理由、备选与客观测算**；未看提示直接出牌/响应后可通过底栏`刚这手复盘`（[src/components/TurnReviewDialog.tsx](../src/components/TurnReviewDialog.tsx)）回看当手建议。
- 已完成行牌客观测算与桌面可读性修复（[src/components/tileBreakdown.ts](../src/components/tileBreakdown.ts)、[src/components/settlementDetails.ts](../src/components/settlementDetails.ts)、[src/style.css](../src/style.css)）：扣减全桌公开牌展示有效进张、听牌余张与底算番型，支持`1向听`窄门提醒、换入三张`入`角标、暗杠背牌、完整结算/流局查叫流水与桌面/窄屏自适应。
- 已重构「换三张」与「定缺」教学启发式及人话解释（[src/game/openingAdvice.ts](../src/game/openingAdvice.ts)、[src/game/teacher.ts](../src/game/teacher.ts)、[src/components/setupAdvice.ts](../src/components/setupAdvice.ts)）：结合**主门保张、换后定缺清门成本、成组面子保留与清一色倾向**评估换牌并避开整对/整顺送出，修复`777`拆 6 张筒主门`789筒`、`108`备选整对送出`11条`以及同张数/同向听定缺按固定花色顺序拆成顺问题；统一改用“三门张数 → 换后余几张废牌可定缺 → 推荐理由”人话说明并消除桌面展开卡片底行截断。

## 下一步建议

1. **补全整局关键手时间线回看**：当前`刚这手复盘`仅保留最近一步快照，可按需扩展多步回顾。
2. **策略对照入口评估**：按 [PROJECT_PLAN.md](PROJECT_PLAN.md) 决定是否在牌局设置中提供“合理老师”与`V10`的轻量对照说明。
3. **规则与策略边界**：规则改动须先更新 [RULES_V1.md](RULES_V1.md)；策略研究维持暂停（[research/README.md](research/README.md)）。

## 阻塞项

- 无阻塞；牌局状态与复盘快照仍只存在当前页面内存，未做持久化存档。

## 完成标准

- 本轮「换三张 / 定缺」启发式与人话解释重构已通过 `npm run check`（`59` 组 `562` 条测试）与 `777` / `108` / `3` 固定种子桌面（`1280×860`）及窄屏（`390×844`）Chrome 目视复验。
