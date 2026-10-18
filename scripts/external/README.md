# 独立川麻初级策略适配器

这个 Python worker 为离线策略对照提供独立于项目 TypeScript 建议实现的参考策略。它使用 ebony72/Mahjong 的 `strategy_initial21_7attr` 和 `daquex`，不代表已经达到人类高手水平。

## 运行

需要 Python 3.10 或更新版本，仅使用标准库，无需安装模型或 Python 包。从项目根目录运行：

```powershell
python -B scripts/external/worker.py
```

进程从 stdin 接收逐行 JSON，从 stdout 返回逐行 JSON，并在每行后 flush。stdin 关闭后退出。一个请求报错后仍处理后续请求。上游诊断输出写入 stderr，stdout 只承载协议。

```json
{ "id": "decision-1", "phase": "discard", "view": {} }
```

上例仅展示信封；`view` 必须是下面说明的完整公开投影。请求只允许 `id`、`phase`、`view`；`id` 是字符串或整数。不要发送牌局种子、完整状态、牌墙或对手暗牌。

成功返回项目已有的 `DecisionAction`：

```json
{ "id": "decision-1", "action": { "type": "discard", "tile": 17 } }
```

错误显式返回，不回退其他策略：

```json
{
  "id": "decision-1",
  "error": {
    "code": "invalid-view",
    "message": "Missing view fields: publicTiles"
  }
}
```

`invalid-json` 表示该行无法解析；`hidden-field` 表示出现未允许字段；`invalid-view` / `invalid-request` 表示输入不符合接口；`unsupported` 表示不支持该阶段；`illegal-action` 表示上游返回宿主未允许动作；`upstream-error` 保留上游异常类型和内容。启动时来源校验失败会中止启动。正式评估应将错误、超时和退出视为失败，不能忽略或替换动作。

## 阶段与动作

| `phase`          | 行为                                                       | 成功动作                                               |
| ---------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| `choose-missing` | 只向 `daquex` 传本家起手；允许选已没有的花色               | `{type:"missing",suit:"wan"\|"tiao"\|"tong"}`          |
| `discard`        | 合法自摸优先；有宿主允许的暗杠或补杠时按上游决策；否则出牌 | `win`、`kong` 或 `discard`                             |
| `respond`        | 合法胡优先，再按上游选择直杠/碰/过                         | `{type:"respond",choice:"hu"\|"kong"\|"pung"\|"pass"}` |
| `exchange`       | 上游没有换三张算法，显式报 `unsupported`                   | 无；评估宿主应共用合理换牌策略                         |

`kong.kind` 为 `concealed` 或 `added`；直杠是响应 `choice:"kong"`。上游拼写 `pong` 映射为项目的 `pung`。所有动作须属于宿主投影的合法动作集合，非法返回直接报错。宿主负责胡牌是否合法、何时轮到该座位、发牌、结算和血战流程。

## 必需的公开投影

接受当前 `PlayerView` 的 `seat`、`hand`、`melds`、`missing`、`legalDiscards`、`ownDiscards`、`opponents`、`wallRemaining`、`decision`，以及额外必需字段：

```typescript
publicTiles: {
  seat: number;
  tile: number;
  kind: "discard" | "self-win";
}
[];
```

`publicTiles` 必须保持实际发生顺序，包括当前未被碰/杠认领的弃牌和已公开的自摸胡张。被认领的弃牌移出该序列；弃牌胡的胡张本来就在弃牌中，不再增加；抢杠成功的被抢牌作为弃牌记录一次。只公开胡张本身，不能加入赢家其余手牌。`kind:"discard"` 的逐座计数必须与 `ownDiscards` / 对手 `discards` 完全一致。普通响应的待认领弃牌必须是最后一项；待抢补杠牌在抢杠成功前不加入该序列。

上游弃牌策略会读取桌面最近四张，缺少这个字段时必须拒绝；不能把各座弃牌拼接为伪造时序。若历史无法从旧牌局可靠恢复，应新开局或标记不可评估。

知识库按每种牌四张，扣除本家手牌、每座公开面子、`publicTiles`，每张只扣一次；不再单独扣各座的 `discards`。面子按碰三张、杠四张展开。抢杠响应只调用上游始终接受合法抢杠的入口，不将待抢牌假装成普通弃牌。已公开自摸胡张仍包含在赢家 `handCount` 中，但该计数不会用于反推或读取其余暗牌。

宿主编码为万/条/筒 `0..8 / 9..17 / 18..26`；上游为 `[花色,点数]`，花色顺序条/万/筒 `0/1/2`，点数 `1..9`，适配器显式双向映射。门面仅有本家手牌；对手 `.hand` 以及墙的索引/迭代访问会抛错，墙只提供长度。每个请求重新构造门面，跨请求只保留上游纯计算缓存。

## 来源和边界

[上游固定提交](https://github.com/ebony72/Mahjong/tree/2d46ffa0ba84f486c336935d8f3e105f4e39e5a2) 的最小依赖与 MIT 许可位于 `vendor/ebony72-mahjong/`。七个原文件通过 `git show <commit>:<path>` 逐字节复制，没有修改算法。`UPSTREAM.json` 记录逐文件 SHA-256；worker 在启动时校验文件和固定闭包摘要：

```text
ab085c0b203155dd8f9396ba01d2cf39cf92349b71d8ff6e10f18738450eabe9
```

仅导入初级策略、缺牌数计算、定缺和必要工具，不导入上游引擎、计分环境或 advanced。上游初级策略默认接受合法胡牌、碰杠判断含固定剩余牌阈值；不提供精确放铳概率或高手认证。源算法异常原样报告，不修改源算法偷偷容错。

使用项目 V1 环境评估，不采用上游环境不同的自摸加番、金钩钓、天地胡、花猪赔付、退税、呼叫转移和计分规则。参考策略没有换三张；开局对照必须由宿主明确统一。任何胜负成绩都只证明在该固定规则与对手环境下的相对结果。

## 开发兼容证据与已知上游边界

2026-10-18 使用真实 V1 引擎和当前公开视图驱动四家上游初级策略，换牌统一使用 `chooseStructureExchange`；开发种子 `80000..80003` 已使用，不能再作为盲测留出。这四局均三家胡牌结束，190 个 worker 请求无错误、stderr 为空；其中 83 个请求含已胡对手，3 个请求的墙张数不超过 4。每步检查 108 张牌守恒。动作覆盖包括碰、直杠和补杠；人工回归另覆盖暗杠、多杠选项、已胡者 14 张 `handCount`、四面子二张暗手和定缺尚未全部公开。此烟测仅证明这些局面可正常接入，不能推导策略强度或完整规则覆盖。

已确认一个源算法失败路径：缺筒、无副露、手牌 `1111万 2222万 123条 567条`、墙中无牌。本桌 V1 判定该手不可胡，墙空也不能开杠，所有手牌均是合法弃牌；上游 `vec_discard_val` 先排除四张同牌，余下条牌又全部被判为面子必要牌，最终在源文件 279–280 行抛出 `No preferrable discard tiles`。严格参考 worker 返回 `upstream-error`，不回退其他出牌。

[边界请求](fixtures/upstream-empty-wall.request.json) 是人工构造的完整公开库存节点：14 张本家手牌、55 张有序弃牌、39 张未公开对手手牌计数，共 108 张；不包含对手暗牌、牌墙顺序或种子。它用于复现该源算法路径，不是真实高手牌谱，也未证明某条完整历史能产生这个节点。评估宿主必须披露这类失败；若未来显式扩展源算法候选集合，应使用新的策略 ID、版本和触发计数，不能当作原版结果混报。

## 验证

```powershell
python -B -m unittest discover -s scripts/external -p test_worker.py -v
```

测试包括全部 27 种牌编码往返、公开库存去重、最近四张真实顺序、普通牌效弃牌、部分定缺、胡/抢杠/碰/三种杠/多杠选项/过、已胡者 14 张计数、二张手牌残局、墙与对手暗牌访问拒绝、输入字段和合法动作约束、源算法异常及上述墙空死路、A→B→A 请求隔离、来源篡改校验，以及常驻 JSONL 流的错误恢复。接口故障测试才使用局部替身；牌例测试实际执行上游函数。

TDD 记录：先写测试，worker 未存在时出现 `ModuleNotFoundError: No module named 'worker'`；首轮实现后 24 项通过。补写嵌套隐藏字段、非有限数值和清单重算篡改测试，观察到 3 项失败，再修复边界后 28 项全部通过。随后增补兼容性和源算法显式失败回归，合计 35 项通过。源算法的墙空缺陷仍明确保留；测试通过表示已正确报告失败，不表示该牌例有可用参考动作。
