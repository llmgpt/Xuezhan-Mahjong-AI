# 独立川麻参考策略适配器

这个 Python worker 为离线策略对照提供独立于项目 TypeScript 建议实现的参考策略。缺省使用 ebony72/Mahjong 的 `strategy_initial21_7attr` 和 `daquex`，另提供删除研究用暗牌读取的高级公开信息派生版。两个参考均不代表已经达到人类高手水平。

## 运行

需要 Python 3.10 或更新版本，仅使用标准库，无需安装模型或 Python 包。从项目根目录运行：

```powershell
python -B scripts/external/worker.py
```

进程从 stdin 接收逐行 JSON，从 stdout 返回逐行 JSON，并在每行后 flush。stdin 关闭后退出。一个请求报错后仍处理后续请求。上游诊断输出写入 stderr，stdout 只承载协议。

```json
{ "id": "decision-1", "phase": "discard", "view": {} }
```

上例仅展示信封；`view` 必须是下面说明的完整公开投影。请求只允许 `id`、`phase`、`view` 和可选的 `policy`；`id` 是字符串或整数。不要发送牌局种子、完整状态、牌墙或对手暗牌。

| `policy`                           | 实现                                              | 历史要求                                                 |
| ---------------------------------- | ------------------------------------------------- | -------------------------------------------------------- |
| 缺省或 `ebony72-initial`           | 原始初级策略，算法字节不变                        | 真实有序 `publicTiles`；`publicActions` 可选，提供则校验 |
| `ebony72-advanced-public-v1`       | 保留高级路线、删除 Oracle 暗牌分支的明确派生版    | 必须有完整真实 `publicActions`，不根据分桶弃牌倒推       |
| `ebony72-advanced-cap8-discard-v1` | 仅将高级普通弃牌的两处基础牌型效用限制为至多 8 分 | 与原高级相同，必须有完整真实 `publicActions`             |

高级请求例如：

```json
{
  "id": "decision-1",
  "phase": "discard",
  "policy": "ebony72-advanced-public-v1",
  "view": {}
}
```

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

`invalid-json` 表示该行无法解析；`hidden-field` 表示出现未允许字段；`invalid-view` / `invalid-request` 表示输入不符合接口；`invalid-history` 表示事件与当前公开投影不对应；`unsupported` 表示未知策略或不支持该阶段；`illegal-action` 表示上游返回宿主未允许动作；`upstream-error` 保留上游异常类型和内容；`provenance-error` 表示来源校验失败。初级启动校验失败会中止启动；高级首次加载失败会返回明确错误。正式评估应将错误、超时和退出视为失败，不能忽略或替换动作。

## 阶段与动作

| `phase`          | 行为                                                       | 成功动作                                               |
| ---------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| `choose-missing` | 只向 `daquex` 传本家起手；允许选已没有的花色               | `{type:"missing",suit:"wan"\|"tiao"\|"tong"}`          |
| `discard`        | 合法自摸优先；有宿主允许的暗杠或补杠时按上游决策；否则出牌 | `win`、`kong` 或 `discard`                             |
| `respond`        | 合法胡优先，再按上游选择直杠/碰/过                         | `{type:"respond",choice:"hu"\|"kong"\|"pung"\|"pass"}` |
| `exchange`       | 上游没有换三张算法，显式报 `unsupported`                   | 无；评估宿主应共用合理换牌策略                         |

`kong.kind` 为 `concealed` 或 `added`；直杠是响应 `choice:"kong"`。上游拼写 `pong` 映射为项目的 `pung`。所有动作须属于宿主投影的合法动作集合，非法返回直接报错。宿主负责胡牌是否合法、何时轮到该座位、发牌、结算和血战流程。

高级策略可能拒绝点胡。原引擎会在拒胡后再询问碰杠；V1 一次收集响应，因此适配器依次询问高级胡牌、再询问仍合法的杠或碰。这是显式保留原流程语义，不是返回初级策略。高级暗杠和补杠候选也只采用宿主已经允许的牌，避免原候选方法包含缺门牌；最终输出仍检查合法性。

`cap8_policy.py` 是独立标识的实验候选，只为 `select_a_card_to_discard → discard` 创建函数和 globals 的私有副本，给两处 `compute_handScore` 注入 `min(原值,8)` 代理。其他函数保留原对象和原 globals，不对原模块或共享计分器做临时全局替换，因此原拒胡、碰杠、抢杠及其阈值保留。每次加载重新校验固定 vendor 闭包，异常直接返回。它仍有上游金钩钓、自摸和其他收益假设，不等于完整 V1 计分模型，更没有强度结论。对应宿主 ID 为 `candidate-advanced-cap8-v6`；[诊断记录](../../docs/INDEPENDENT_BENCHMARK_V6.md)说明范围。

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

高级策略还必须接收完整 `publicActions`：

```typescript
type PublicAction =
  | { seat: number; kind: "draw" }
  | { seat: number; kind: "discard"; tile: Tile }
  | { seat: number; kind: "pung"; tile: Tile; from: number }
  | {
      seat: number;
      kind: "kong";
      tile: Tile;
      kongKind: "direct" | "concealed";
      from: number | null;
    }
  | { seat: number; kind: "added-kong-offer"; tile: Tile }
  | {
      seat: number;
      kind: "win";
      tile: Tile;
      winKind: "discard" | "self" | "rob-kong";
      from: number | null;
    };
```

事件从初始牌之后开始；初始牌不另记 `draw`，所有实际摸牌和补牌都记 `draw`，并且绝不带牌值。历史保留被认领前的完整弃牌，不删除旧记录。补杠提议只记一次：V1 在抢杠响应期间仍保留原碰和暗手，重放器待同座补牌时才落成杠；若被抢，则保留原碰、扣一张暗手并增加一次公开弃牌。不可将旧抢杠事件跨回合复用。`pass` 和资格信息不属于事件。

`public_history_validation.py` 逐条重放公开牌数量变化，核对墙张数、暗手张数、赢家状态、面子与来源以及当前 `publicTiles` 顺序，不重建对手暗牌，也不把重放当作胡牌或高手策略裁判。`advanced_policy.py` 使用上游原花色估计方法处理这些真实历史；公开杠后炮标记也从该历史导出。抢杠响应期间，已公开的补杠第四张在高级库存中额外扣一次，既不加入普通弃牌，也不重复扣原来的碰。

## 来源和边界

[上游固定提交](https://github.com/ebony72/Mahjong/tree/2d46ffa0ba84f486c336935d8f3e105f4e39e5a2) 的最小依赖与 MIT 许可位于 `vendor/ebony72-mahjong/`。七个原文件通过 `git show <commit>:<path>` 逐字节复制，没有修改算法。`UPSTREAM.json` 记录逐文件 SHA-256；worker 在启动时校验文件和固定闭包摘要：

```text
ab085c0b203155dd8f9396ba01d2cf39cf92349b71d8ff6e10f18738450eabe9
```

初级路径仅导入初级策略、缺牌数计算、定缺和必要工具，不导入上游引擎或高级模块。上游初级策略默认接受合法胡牌、碰杠判断含固定剩余牌阈值；不提供精确放铳概率或高手认证。源算法异常原样报告，不修改源算法偷偷容错。

高级来源单独位于 `vendor/ebony72-advanced/`，同样锁定上述提交。`upstream/` 保留高级策略、计算依赖、MIT 许可和两个仅供抽取方法审计的引擎源文件原字节；运行时不导入引擎。`derived/ebony72_advanced_public/` 使用隔离包，保留完整清一色、七对、碰杠、拒胡等算法，只删除 `Oracle/GPhi` 研究分支并改为包内导入。公开历史方法从 `xzdealer.py:50–174` 抽取，本家结构方法从 `xzplayer.py:64–98` 抽取，方法体保持不变。`PUBLIC_ONLY.patch` 显示全部派生差异；独立 `UPSTREAM.json` 校验 24 个文件，闭包摘要为：

```text
94b96f0e3586b89975968a04f1321d29ece825633422447436db7644af8b4c20
```

原初级 vendor 与清单字节未修改。高级花色估计仍沿用原固定先验和近似更新，未用实际换三张暗牌校准；高级收益估值仍保留原自摸加倍、金钩钓及不封顶等假设，与 V1 计分不完全一致。它是额外的独立参考候选，不能据其名称认定水平高于当前老师。

使用项目 V1 环境评估，不采用上游环境不同的自摸加番、金钩钓、天地胡、花猪赔付、退税、呼叫转移和计分规则。参考策略没有换三张；开局对照必须由宿主明确统一。任何胜负成绩都只证明在该固定规则与对手环境下的相对结果。

## 开发兼容证据与已知上游边界

2026-10-18 使用真实 V1 引擎和当前公开视图驱动四家上游初级策略，换牌统一使用 `chooseStructureExchange`；开发种子 `80000..80003` 已使用，不能再作为盲测留出。这四局均三家胡牌结束，190 个 worker 请求无错误、stderr 为空；其中 83 个请求含已胡对手，3 个请求的墙张数不超过 4。每步检查 108 张牌守恒。动作覆盖包括碰、直杠和补杠；人工回归另覆盖暗杠、多杠选项、已胡者 14 张 `handCount`、四面子二张暗手和定缺尚未全部公开。此烟测仅证明这些局面可正常接入，不能推导策略强度或完整规则覆盖。

已确认一个源算法失败路径：缺筒、无副露、手牌 `1111万 2222万 123条 567条`、墙中无牌。本桌 V1 判定该手不可胡，墙空也不能开杠，所有手牌均是合法弃牌；上游 `vec_discard_val` 先排除四张同牌，余下条牌又全部被判为面子必要牌，最终在源文件 279–280 行抛出 `No preferrable discard tiles`。严格参考 worker 返回 `upstream-error`，不回退其他出牌。

[边界请求](fixtures/upstream-empty-wall.request.json) 是人工构造的完整公开库存节点：14 张本家手牌、55 张有序弃牌、39 张未公开对手手牌计数，共 108 张；不包含对手暗牌、牌墙顺序或种子。它用于复现该源算法路径，不是真实高手牌谱，也未证明某条完整历史能产生这个节点。评估宿主必须披露这类失败；若未来显式扩展源算法候选集合，应使用新的策略 ID、版本和触发计数，不能当作原版结果混报。

高级派生版另外使用 `80000..80007` 开发种子完成八局四家高级策略烟测：前七局三家胡牌结束，`80007` 墙尽、两家胡；565 次请求没有错误或回退，每步保持 108 张。209 次请求含赢家，9 次墙剩余不超过 4 张，最多 133 条公开历史；覆盖碰、过、点胡、自摸和三种杠。stderr 仅出现一次原算法的理论听牌提示。新增的[真实开发残局请求](fixtures/advanced-dev-80007-wall-empty.request.json) 来自已使用的 `80007`，用于墙空与历史对应回归，不能再当未见测试。随后同种子复验整局 84 次请求正常结束。八局通过属于开发兼容证据，不是正式强度结论。

## 验证

```powershell
python -B -m unittest discover -s scripts/external -p "test_*.py" -v
```

测试包括全部 27 种牌编码往返、公开库存去重、最近四张真实顺序、普通牌效弃牌、部分定缺、胡/抢杠/碰/三种杠/多杠选项/过、已胡者 14 张计数、二张手牌残局、墙与对手暗牌访问拒绝、输入字段和合法动作约束、源算法异常及上述墙空死路、A→B→A 请求隔离、来源篡改校验，以及常驻 JSONL 流的错误恢复。接口故障测试才使用局部替身；牌例测试实际执行上游函数。

TDD 记录：先写测试，worker 未存在时出现 `ModuleNotFoundError: No module named 'worker'`；首轮实现后 24 项通过。补写嵌套隐藏字段、非有限数值和清单重算篡改测试，观察到 3 项失败，再修复边界后 28 项全部通过。随后增补兼容性和源算法显式失败回归，初级合计 35 项通过。高级先出现 `ModuleNotFoundError: No module named 'advanced_policy'` 的 RED；接入隔离包和历史门面后，通过原 35 项与新增高级测试。后续两项 RED 暴露旧抢杠事件复用和越界输出错误分类，修复后合计 58 项全部通过。初级源算法的墙空缺陷仍明确保留；测试通过表示已正确报告失败，不表示该牌例有可用参考动作。

封顶弃牌候选的模块先出现 8 项未实现错误，接入后新增 8 项通过；JSONL 增加真实墙尽/历史/隐私 3 项，Python 合计 69 项通过。18 个已有开发公开帧以原→候选→原→候选交替重放：普通近听路径实际 14 次代理调用，其中 11 次封顶，原动作始终保持；临墙理论听牌路径另由固定手牌和受控库存的直接函数回归覆盖。18 帧里候选最终动作均与原版相同，不能从分数被截断推断实战改变或收益。
