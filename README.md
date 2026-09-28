# 血战麻将学习项目（筹备中）

目标是做一个可以在浏览器里玩的四川血战到底麻将项目，重点是帮助玩家提升技术。

## 想做的功能

- 自己打牌时获得出牌建议，并看到建议依据。
- 观看 AI 对战，按回合暂停、查看选择和理由。
- 对局结束后复盘关键决策。

规则暂按常见的四川血战到底玩法设计。换三张、定缺、碰杠、胡牌和计分等细节会在开发前明确，避免建议系统建立在错误规则上。

## 当前状态

目前只记录了项目方向，尚未开发游戏。公开仓库是 [llmgpt/Xuezhan-Mahjong-AI](https://github.com/llmgpt/Xuezhan-Mahjong-AI)。首个可玩版本计划采用 TypeScript、React 和 Vite，在浏览器内运行并部署为静态网页；模块边界与后续服务端条件见 [ARCHITECTURE.md](ARCHITECTURE.md)。

本地开发环境已准备 `git-workflow-and-versioning`、`test-driven-development` 和 Serena MCP。它们用于辅助开发，不是游戏运行依赖；其他贡献者无需安装这些工具即可参与项目。

## 项目文档

- [项目计划](docs/PROJECT_PLAN.md)：里程碑、待定规则与建议评价。
- [架构草图](ARCHITECTURE.md)：第一阶段技术选择及后续扩展条件。
- [开发与反馈回路](docs/ENGINEERING.md)：代码、测试、页面检查和 CI 的建立方式。
