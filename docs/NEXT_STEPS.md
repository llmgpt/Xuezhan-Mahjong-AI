# 下一步交接

## 当前状态

- 已合入默认开启的“先想后看”教学流程（[src/App.tsx](../src/App.tsx)、[src/components/AdviceCoach.tsx](../src/components/AdviceCoach.tsx)）：轮到玩家时先隐藏建议条与`荐`字角标；点击`揭晓本步建议`（或切换底栏`先想后看：开/关`）后**直接就地展开理由、备选与客观测算**；未看提示直接出牌/响应后可通过底栏`刚这手复盘`（[src/components/TurnReviewDialog.tsx](../src/components/TurnReviewDialog.tsx)）回看当手建议。
- 已完成行牌客观测算与桌面可读性修复（[src/components/tileBreakdown.ts](../src/components/tileBreakdown.ts)、[src/components/TileBreakdownPanel.tsx](../src/components/TileBreakdownPanel.tsx)、[src/components/settlementDetails.ts](../src/components/settlementDetails.ts)、[src/style.css](../src/style.css)）：扣减全桌公开牌展示完整有效进张（不再截断超过 12 种的进张牌面）、听牌余张与底算番型；将行牌与复盘顶部的动作复读替换为基于向听/听口余张的一句话人话结论（含窄口听牌对比宽进张 1 向听提示）；收紧展开建议时的桌面中心高度以防遮挡本家与对家弃牌区；支持本家胡牌张入列标`胡`、终局四家明牌摊牌及`查看牌桌 / 查看战绩`切换。
- 已重构「换三张」与「定缺」教学启发式及人话解释（[src/game/openingAdvice.ts](../src/game/openingAdvice.ts)、[src/game/teacher.ts](../src/game/teacher.ts)、[src/components/setupAdvice.ts](../src/components/setupAdvice.ts)）：结合**主门保张、换后定缺清门成本、成组面子保留与清一色倾向**评估换牌并避开整对/整顺送出；定缺解释前置向听距离并注明跨向听比较关系，防止高向听大进张数误导新手。

## 下一步建议

1. **补全整局关键手时间线回看**：当前`刚这手复盘`仅保留最近一步快照，可按需扩展多步回顾。
2. **策略对照入口评估**：按 [PROJECT_PLAN.md](PROJECT_PLAN.md) 决定是否在牌局设置中提供“合理老师”与`V10`的轻量对照说明。
3. **规则与策略边界**：规则改动须先更新 [RULES_V1.md](RULES_V1.md)；策略研究维持暂停（[research/README.md](research/README.md)）。

## 阻塞项

- 无阻塞；牌局状态与复盘快照仍只存在当前页面内存，未做持久化存档。

## 完成标准

- 本轮种子 `2026` 试玩暴露的行牌人话摘要、>12 种进张完整展示、定缺跨向听提示、弃牌区防遮挡与终局摊牌查看已通过 `npm run check`（`59` 组 `565` 条测试）与 Chrome 桌面目视复验。
