# 血战麻将学习项目

目标是做一个可以在浏览器里玩的四川血战到底麻将项目，重点是帮助玩家提升技术。

## 想做的功能

- 自己打牌时获得出牌建议，并看到建议依据。
- 观看 AI 对战，按回合暂停、查看选择和理由。
- 对局结束后复盘关键决策。

规则目标见 [第一版规则表](docs/RULES_V1.md)。各地与平台差异在规则表中列为本版选择和可配置方向。

## 当前状态

现有 TypeScript、React、Vite 的**规则切片演示**：固定种子发牌、顺时针换三张、定缺、强制先打缺门、摸打轮转，以及独立的标准型/七对胡牌判定与血战结束条件判定。页面中的电脑只按固定顺序选择合法动作。碰、杠、胡的对局响应、计分、查叫/查花猪、可解释建议和完整可玩对局仍未实现。公开仓库是 [llmgpt/Xuezhan-Mahjong-AI](https://github.com/llmgpt/Xuezhan-Mahjong-AI)；模块边界与后续服务端条件见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 本地运行与检查

需要 Node.js 22。干净检出后执行：

```bash
npm ci
npm run dev
```

打开 Vite 打印的本地地址。使用 `npm run check` 一次运行格式、ESLint、TypeScript、固定牌例测试与生产构建；单独命令为 `npm run format:check`、`npm run lint`、`npm run typecheck`、`npm test`、`npm run build`。本地格式化可运行 `npm run format`。

本地开发环境已准备 `git-workflow-and-versioning`、`test-driven-development` 和 Serena MCP。它们用于辅助开发，不是游戏运行依赖；其他贡献者无需安装这些工具即可参与项目。

## 项目文档

- [项目计划](docs/PROJECT_PLAN.md)：里程碑、待定规则与建议评价。
- [第一版规则表](docs/RULES_V1.md)：明确的规则目标、差异与当前实现边界。
- [架构草图](ARCHITECTURE.md)：第一阶段技术选择及后续扩展条件。
- [开发与反馈回路](docs/ENGINEERING.md)：代码、测试、页面检查和 CI 的建立方式。
- [新对话开发交接](docs/NEXT_STEPS.md)：当前状态与下一项开发任务。
