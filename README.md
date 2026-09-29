# 血战麻将学习项目

目标是做一个可以在浏览器里玩的四川血战到底麻将项目，重点是帮助玩家提升技术。

## 想做的功能

- 自己打牌时获得出牌建议，并看到建议依据。
- 观看 AI 对战，按回合暂停、查看选择和理由。
- 对局结束后复盘关键决策。

规则目标见 [第一版规则表](docs/RULES_V1.md)。各地与平台差异在规则表中列为本版选择和可配置方向。

## 当前状态

现有 TypeScript、React、Vite 的**本地可试玩 V1**：玩家与三名电脑对手可以完成一局。页面支持固定种子、换三张、定缺、摸打、碰、三种杠、自摸与点炮、多人胡、抢杠胡、血战结束和计分；出牌时展示推荐与备选、牌效率粗估、收益倾向、风险提示及局限。对局结束显示积分与胡牌记录。电脑与建议使用启发式策略，未经过模型训练；目前没有复盘、AI 观战、账号或在线多人模式。公开仓库是 [llmgpt/Xuezhan-Mahjong-AI](https://github.com/llmgpt/Xuezhan-Mahjong-AI)；具体规则见[规则表](docs/RULES_V1.md)，模块边界见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 本地运行与检查

需要 Node.js 22。干净检出后执行：

```bash
npm ci
npm run dev
```

打开 Vite 打印的本地地址，按页面提示换牌、定缺、打牌；在开局输入同一个整数种子可以重现发牌及电脑决策。使用 `npm run check` 一次运行格式、ESLint、TypeScript、固定牌例测试与生产构建；单独命令为 `npm run format:check`、`npm run lint`、`npm run typecheck`、`npm test`、`npm run build`。本地格式化可运行 `npm run format`。

本地开发环境已准备 `git-workflow-and-versioning`、`test-driven-development` 和 Serena MCP。它们用于辅助开发，不是游戏运行依赖；其他贡献者无需安装这些工具即可参与项目。

## 项目文档

- [项目计划](docs/PROJECT_PLAN.md)：里程碑、待定规则与建议评价。
- [第一版规则表](docs/RULES_V1.md)：本地试玩版的规则选择与差异。
- [架构草图](ARCHITECTURE.md)：第一阶段技术选择及后续扩展条件。
- [开发与反馈回路](docs/ENGINEERING.md)：代码、测试、页面检查和 CI 的建立方式。
- [新对话开发交接](docs/NEXT_STEPS.md)：当前状态与下一项开发任务。
