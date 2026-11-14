# 策略强度研究归档

> 本文是 V1～V11 策略强度实验的总览索引。**当前研究已暂停**：页面已接入并通过 19,200 局独立留出验证的 V10（水平与开源启发式策略相当，不代表高手水平），项目现转向打磨面向初学者的“先想后看 + 摊开计算步骤”教学体验。

## 结论摘要

- **从 V1 到 V10**：2026 年 10 月围绕“同一 V1 规则下的长期平均净分”进行了系列对照与审计。最终 V10（在 `V8` 基础上，本家普通合法点胡时直接兑现本次确定实收）在 400 个未使用种子、19,200 局独立正式对照中相对原“合理老师”平均每局提升 +0.508 分，满足预定三项条件，并接入页面默认模式（[V10 验收记录](INDEPENDENT_BENCHMARK_V10.md)）。
- **为什么暂停研究**：V10 对外部开源高级启发式策略没有稳定优势，但对学习项目来说“不明显乱打”已经够用；继续追求更高分数对帮助玩家看懂牌理收益有限，且 V11（结合公开赔付预测的弃牌实验）在 20 个新开发种子上相对 V10 明显退步（[V11 记录](INDEPENDENT_BENCHMARK_V11.md)）。
- **原始机器记录**：所有冻结协议、统计摘要与哈希清单保存在 [benchmarks/](benchmarks/independent-v10-complete.json) 目录。

## 归档文档索引

状态说明：`active-reference` 当前默认版本仍在引用的协议或接入记录；`reference` 外部参考或基线对照；`diagnostic` 单项审计/诊断；`rejected` 已否定未接入；`superseded` 已被后续版本取代。

| 文档                                                                   | 状态               | 内容摘要                                      |
| ---------------------------------------------------------------------- | ------------------ | --------------------------------------------- |
| [INDEPENDENT_BENCHMARK_V10.md](INDEPENDENT_BENCHMARK_V10.md)           | `active-reference` | V10 正式 19,200 局验收与页面默认晋升记录      |
| [INDEPENDENT_FORMAL_PROTOCOL.md](INDEPENDENT_FORMAL_PROTOCOL.md)       | `active-reference` | 独立留出评测、冻结源码与审计流程协议          |
| [BROWSER_STRATEGY_INTEGRATION.md](BROWSER_STRATEGY_INTEGRATION.md)     | `active-reference` | 浏览器端 Pyodide / V10 策略接入与构建资产范围 |
| [INDEPENDENT_BENCHMARK_V11.md](INDEPENDENT_BENCHMARK_V11.md)           | `rejected`         | V11 公开赔付弃牌实验（相对 V10 退步，未接入） |
| [PUBLIC_LIABILITY_MODEL.md](PUBLIC_LIABILITY_MODEL.md)                 | `rejected`         | V11 使用的公开信息基础点胡赔付预测原型        |
| [ADVICE_CASE_AUDIT.md](ADVICE_CASE_AUDIT.md)                           | `reference`        | 外部公开教学牌例局部事实核对                  |
| [EXTERNAL_STRATEGY_OPTIONS.md](EXTERNAL_STRATEGY_OPTIONS.md)           | `reference`        | 外部川麻开源策略、论文与规则差异核查          |
| [INDEPENDENT_REFERENCE_FANFOU.md](INDEPENDENT_REFERENCE_FANFOU.md)     | `reference`        | Fanfou BA 不同作者组合参考的接入与对照        |
| [INDEPENDENT_UI_OPPONENT.md](INDEPENDENT_UI_OPPONENT.md)               | `reference`        | 牌桌原三电脑对手与独立引擎一致性对照          |
| [ADVANCED_DECISION_DIAGNOSTICS.md](ADVANCED_DECISION_DIAGNOSTICS.md)   | `diagnostic`       | 浏览器端 E/V10 胡牌分支与阈值解释诊断         |
| [ADVANCED_FUTURE_INCOME_AUDIT.md](ADVANCED_FUTURE_INCOME_AUDIT.md)     | `diagnostic`       | V7 未来收益量纲与宿主计分算术审计             |
| [ADVICE_EVALUATION.md](ADVICE_EVALUATION.md)                           | `superseded`       | 早期启发式出牌 100 种子与两摸前瞻历史评估     |
| [TEACHER_ACCEPTANCE.md](TEACHER_ACCEPTANCE.md)                         | `superseded`       | 早期“合理老师”V1 内部验收协议                 |
| [TEACHER_REPORT.md](TEACHER_REPORT.md)                                 | `superseded`       | “合理老师”V1 6,400 局内部对照报告             |
| [TEACHER_INDEPENDENT_VALIDATION.md](TEACHER_INDEPENDENT_VALIDATION.md) | `superseded`       | 早期独立验证路线（已由 V10 正式流程取代）     |
| [INDEPENDENT_E_FOLLOWUP.md](INDEPENDENT_E_FOLLOWUP.md)                 | `superseded`       | 早期高级候选 E 补测跟进                       |
| [INDEPENDENT_BENCHMARK_V2.md](INDEPENDENT_BENCHMARK_V2.md)             | `superseded`       | V2 初始独立评测与暗杠干预诊断                 |
| [INDEPENDENT_BENCHMARK_V3.md](INDEPENDENT_BENCHMARK_V3.md)             | `superseded`       | V3 高级公有参考与公开采样续局实验             |
| [INDEPENDENT_BENCHMARK_V4.md](INDEPENDENT_BENCHMARK_V4.md)             | `superseded`       | V4 优先收合法胡开发对照                       |
| [INDEPENDENT_BENCHMARK_V5.md](INDEPENDENT_BENCHMARK_V5.md)             | `superseded`       | V5 模块拆分与扩大开发集对照                   |
| [INDEPENDENT_BENCHMARK_V6.md](INDEPENDENT_BENCHMARK_V6.md)             | `superseded`       | V6 效用封顶局部诊断                           |
| [INDEPENDENT_BENCHMARK_V7.md](INDEPENDENT_BENCHMARK_V7.md)             | `superseded`       | V7 杠后炮/抢杠 V1 收益单位修正                |
| [INDEPENDENT_BENCHMARK_V8.md](INDEPENDENT_BENCHMARK_V8.md)             | `superseded`       | V8 当前等待牌金额模型开发对照                 |
| [INDEPENDENT_BENCHMARK_V9.md](INDEPENDENT_BENCHMARK_V9.md)             | `superseded`       | V9 普通点胡生成续局模型对照                   |
