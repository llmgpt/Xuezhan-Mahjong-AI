# 下一步交接

## 当前状态

- 已合入默认开启的“先想后看”教学流程（[src/App.tsx](../src/App.tsx)、[src/components/AdviceCoach.tsx](../src/components/AdviceCoach.tsx)）：轮到玩家时先隐藏建议条与`荐`字角标；点击`揭晓本步建议`（或切换底栏`先想后看：开/关`）后**直接就地展开理由、备选与客观测算**，并在开局`换三张`、`选择定缺`及行牌阶段统一显示`荐`标识；未看提示直接出牌/响应后可通过底栏`刚这手复盘`（[src/components/TurnReviewDialog.tsx](../src/components/TurnReviewDialog.tsx)）回看当手建议。
- 已完成行牌/响应客观测算与桌面可读性修复（[src/components/tileBreakdown.ts](../src/components/tileBreakdown.ts)、[src/game/advice.ts](../src/game/advice.ts)、[src/game/actionAdvice.ts](../src/game/actionAdvice.ts)、[src/style.css](../src/style.css)）：修复手牌仍含定缺牌时响应`过`因向听封底导致有效进张归零的问题，并使“合理老师”不再因缺门张数差而把未缩短非缺门向听的`碰`排在`过`前面（网页端 [src/main.tsx](../src/main.tsx) 默认运行 `V10` 策略，遇此情形仍可能自主选`碰`）；自摸胡明细补充加底实付口径，并加大终局对家副露与弃牌区间距。
- 已重构并打磨「换三张」与「定缺」教学启发式及人话解释（[src/game/openingAdvice.ts](../src/game/openingAdvice.ts)、[src/game/teacher.ts](../src/game/teacher.ts)、[src/components/setupAdvice.ts](../src/components/setupAdvice.ts)）：结合**主门保张、换后定缺清门成本、成组面子保留与清一色倾向**评估换牌并避开整对/整顺送出；修正缺门已有 `0` 张时仍称“保留两门”以及将“预备定缺花色留对子”当作优点的措辞。

## 下一步建议

1. **补全整局关键手时间线回看**：当前`刚这手复盘`仅保留最近一步快照，可按需扩展多步回顾。
2. **策略对照入口评估**：按 [PROJECT_PLAN.md](PROJECT_PLAN.md) 决定是否在牌局设置中提供“合理老师”与`V10`的切换或轻量对照说明。
3. **规则与策略边界**：规则改动须先更新 [RULES_V1.md](RULES_V1.md)；策略研究维持暂停（[research/README.md](research/README.md)）。

## 阻塞项

- 无阻塞；牌局状态与复盘快照仍只存在当前页面内存，未做持久化存档。

## 完成标准

- 种子 `101`、`777`、`2025` 桌面端试玩暴露的缺门未清时响应`过`进张归零、自摸加底口径、开局`荐`标与单门/对子文案及对家副露间距已修复，并通过 `npm run check`（`59` 组 `570` 条测试）与 Chrome 桌面目视复验。
