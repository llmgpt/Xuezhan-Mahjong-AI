# 血战麻将学习项目

这是一个在浏览器里玩的四川血战到底麻将学习项目，重点解决看教学视频时“节奏太快没法先自己想、讲解跳过中间计算步骤”的问题，帮助初学者稳步练习牌理。

## 核心方向与当前状态

当前已有 TypeScript、React、Vite 的**本地可试玩 V1**：玩家与三名电脑对手可以完成一局。页面支持固定整数种子复现；包含换三张、定缺、摸打、碰、三种杠、自摸与点炮、多人胡、抢杠胡、血战结束与计分，以及自动托管和中文语音报牌。对局状态与公开动作日志暂存在当前页面内存，暂无账号、联机对战或公开线上部署。公开仓库为 [llmgpt/Xuezhan-Mahjong-AI](https://github.com/llmgpt/Xuezhan-Mahjong-AI)。

- **牌面展示**：万、条、筒采用本地 SVG 按常见实体麻将排布绘制，手牌、弃牌和碰杠都可直接辨认，不依赖外部图片服务。
- **当前策略默认**：页面默认采用经 19,200 局独立留出对照验证的 `V10` 策略（沿用“合理老师”换牌定缺与高级弃牌/响应，并在普通合法点胡时直接兑现本次确定实收），并保留显式老师模式作对照。`V10` 水平与开源启发式策略相当，不代表高手水平。
- **阶段重点切换**：策略强度对比研究已暂停并归档于 [研究归档](docs/research/README.md)；后续开发优先打磨教学体验（例如先自己想再看推荐、展开向听与有效进张明细，让每条建议都讲清取舍）。

## 本地运行与检查

需要 Node.js 22。干净检出后执行：

```bash
npm ci
npm run dev
```

打开 Vite 打印的本地地址即可试玩；牌局设置中可查看当前局种子、按指定整数种子重开、切换自动托管节奏（1 / 3 / 5 秒）以及开关和试听中文报牌语音。

常用验证命令：

- `npm run check`：依次运行格式检查、ESLint、TypeScript 类型检查、文档规范检查（`npm run check:docs`）、Vitest 单元测试与生产构建。
- 单独命令：`npm run format:check`、`npm run lint`、`npm run typecheck`、`npm run check:docs`、`npm test`、`npm run build`、`npm run format`。
- 离线对照命令：`npm run evaluate:advice` 与 `npm run evaluate:independent`（不纳入日常 `check`）。

## 项目文档

- [项目计划](docs/PROJECT_PLAN.md)：产品方向、里程碑与当前优先级。
- [第一版规则表](docs/RULES_V1.md)：本地试玩版的规则选择与可配置差异。
- [自动托管与实时建议](docs/AUTOPLAY.md)：托管、实时建议、语音与信息边界。
- [架构草图](ARCHITECTURE.md)：第一阶段技术选择、模块边界与运行时/研究文件划分。
- [开发与反馈回路](docs/ENGINEERING.md)：代码、测试、视觉确认与文档守卫规范。
- [当前交接](docs/NEXT_STEPS.md)：最新状态与下一项开发任务。
- [研究归档](docs/research/README.md)：V1–V11 策略强度实验摘要与历史文档索引。
