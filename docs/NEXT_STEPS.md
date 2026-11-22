# 下一步交接

## 当前状态

- 已合入默认开启的“先想后看”教学流程（[src/App.tsx](../src/App.tsx)、[src/components/AdviceCoach.tsx](../src/components/AdviceCoach.tsx)）：轮到玩家时先隐藏建议条与`荐`字角标；点击`揭晓本步建议`（或切换底栏`先想后看：开/关`）后**直接就地展开理由、备选与客观测算**，并在开局`换三张`、`选择定缺`及行牌阶段统一显示`荐`标识；未看提示直接出牌/响应后可通过底栏`刚这手复盘`（[src/components/TurnReviewDialog.tsx](../src/components/TurnReviewDialog.tsx)）回看当手建议。
- 已完成行牌/响应与试玩视觉体验修复（[src/components/tileBreakdown.ts](../src/components/tileBreakdown.ts)、[src/components/settlementDetails.ts](../src/components/settlementDetails.ts)、[src/game/acceptRonTeacher.ts](../src/game/acceptRonTeacher.ts)、[src/game/v10Response.ts](../src/game/v10Response.ts)、[src/style.css](../src/style.css)）：修复缺门未清响应`过`进张归零与老师非缺门`碰/过`排序（[src/main.tsx](../src/main.tsx) 默认运行 `V10` 策略），消除点胡/一炮多响/抢杠后弃牌区重复展示已胡牌张（[src/App.tsx](../src/App.tsx) `displayDiscardsForSeat`）、右侧玩家 `seat-1` 未摊牌向木框外溢出、桌心间距与建议展开高度问题；`本局结算`补充自摸加底及各家实付明细，点胡/抢杠确定收益整数不补 `.00`。
- 已重构并打磨「换三张」与「定缺」教学启发式及人话解释（[src/game/openingAdvice.ts](../src/game/openingAdvice.ts)、[src/game/teacher.ts](../src/game/teacher.ts)、[src/components/setupAdvice.ts](../src/components/setupAdvice.ts)）：结合**主门保张、换后定缺清门成本、成组面子保留与清一色倾向**评估换牌并避开整对/整顺送出，修正跨花色备选误称“该门内的另一组换牌思路”等措辞。

## 下一步建议

1. **继续补测未覆盖牌局场景**：后续可挑种子覆盖流局查花猪/查叫、暗杠/补杠、`V10` 偏离纯牌效提示与`已见完（余 0 张）`徽标。
2. **补全整局关键手时间线回看**：当前`刚这手复盘`仅保留最近一步快照，可按需扩展多步回顾。
3. **策略对照入口评估**：按 [PROJECT_PLAN.md](PROJECT_PLAN.md) 决定是否在牌局设置中提供“合理老师”与`V10`的切换或轻量对照说明。
4. **规则与策略边界**：规则改动须先更新 [RULES_V1.md](RULES_V1.md)；策略研究维持暂停（[research/README.md](research/README.md)）。

## 阻塞项

- 无阻塞；牌局状态与复盘快照仍只存在当前页面内存，未做持久化存档。

## 完成标准

- 种子 `101`、`777`、`2025` 与 `2026` 桌面/中等/手机端试玩暴露的问题已修复，并通过 `npm run check`（`59` 组 `573` 条测试）与 Chrome 多分辨率目视复验（`0` 控制台报错）。
