# 下一步交接

## 当前状态

- 已合入默认开启的“先想后看”教学流程（[src/App.tsx](../src/App.tsx)、[src/components/AdviceCoach.tsx](../src/components/AdviceCoach.tsx)）：轮到玩家时先隐藏建议条与`荐`字角标；点击`揭晓本步建议`（或切换底栏`先想后看：开/关`）后**直接就地展开理由、备选与客观测算**，去掉`查看依据`二次点击与遮罩弹窗；未看提示直接出牌/响应后可通过底栏`刚这手复盘`（[src/components/TurnReviewDialog.tsx](../src/components/TurnReviewDialog.tsx)）回看当手建议。
- 已新增独立于`src/game/`算分指纹的客观测算明细（[src/components/tileBreakdown.ts](../src/components/tileBreakdown.ts)、[src/components/TileBreakdownPanel.tsx](../src/components/TileBreakdownPanel.tsx)）：按当前手牌与全桌已见公开牌扣减余张，展示定缺未清提醒、候选向听数、有效进张/听牌余张与基础番型，并在`V10`推荐偏离纯牌效时标出分歧说明。
- 已完成牌桌排版与实机自适应修复（[src/style.css](../src/style.css)）：对家`小满`桌面横排、窄屏多碰展开不裁剪；自家新摸牌放最右加`摸`角标；`对局记录`映射玩家昵称；展开就地建议时自适应桌心高度，消除`换三张`与`行牌`阶段桌心`余牌`重叠。

- 已完成桌面可读性与客观测算纠错修复（[src/components/tileBreakdown.ts](../src/components/tileBreakdown.ts)、[src/components/settlementDetails.ts](../src/components/settlementDetails.ts)、[src/App.tsx](../src/App.tsx)）：修复可胡窗口错标`过`为`纯牌效最优`、同进张漏比底算与失实分歧说明，增加`1向听`窄门提醒、换入三张`入`角标、暗杠背牌、`碰`后清除桌心残留、完整结算/流局查叫与收支流水、逆时针与番型速查说明，以及`390×844`排版微调。

## 下一步建议

1. **重构「换三张」与「定缺」教学启发式及解释文案**（高优先）：目前 [openingAdvice.ts](../src/game/openingAdvice.ts) 仅比较单门局部连接分，已在`777`、`108`等实玩中暴露出拆 6 张主门完整顺子`789筒`、备选强拆`11条`对子以及`定缺`按固定花色顺序拆成顺等问题；[teacher.ts](../src/game/teacher.ts) 与 [setupAdvice.ts](../src/components/setupAdvice.ts) 仍暴露“同张计 4 / 固定牌序”等算法话术。下一步改为结合**主门保张、后续定缺清门成本与两门/清一色倾向**评估换牌，并用玩家可读语言展示“三门张数 → 换后余几张废牌可定缺 → 推荐理由”。
2. **补全整局关键手时间线回看**：当前`刚这手复盘`仅保留最近一步快照，可按需扩展多步回顾。
3. **规则与策略边界**：规则改动须先更新 [RULES_V1.md](RULES_V1.md)；策略研究维持暂停（[research/README.md](research/README.md)）。

## 阻塞项

- 无阻塞；牌局状态与复盘快照仍只存在当前页面内存，未做持久化存档。

## 完成标准

- 本轮客观测算与牌桌明细修复已通过 `npm run check`（`59` 组 `551` 条测试）与 `42` / `777` / `108` 三局 Chrome 实机目视复验。
