# 其他独立策略候选核查

> 核查日期：2026-10-18 至 19。早期两轮只查阅作者仓库、源码、发布清单和论文入口；新增 Fanfou 已接入独立弃牌核心和明确 V1 外壳，96局旧种子完整烟测已完成，另行标明运行范围。没有新的正式强度成绩，不能用作者自述或原规则比赛成绩替代 V1 验证。

早期两轮共检查五项不同作者的候选，没有新增同时满足“V1 同规则、完整策略、许可清楚、有高手实力依据”的标尺。不能由此推断其他可用项目不存在。当前不推荐直接迁移日麻权重，也不据 README 自述授予高手水平。

| 优先级          | 候选                                                              | 当前建议                                                                         |
| --------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1，后续训练研究 | [Agony5757/mahjong](https://github.com/Agony5757/mahjong)         | 保留公共观测、模仿学习和 Oracle 辅助训练方法参考；现成日麻模型不加入 V1 强度验收 |
| 2，低优先级     | [sceneun1ty/mahjong-ai](https://github.com/sceneun1ty/mahjong-ai) | 可参考独立结构启发式；功能、许可材料和实力证据不足，不优先接入                   |

## Agony5757/mahjong：有公开决策模型，规则差距较大

固定研究版本为 `v1.0.2`，提交 `242aa3f39237b3b298620b5725f807a87dbc4049`。以下推理路径结论对应此版本；当前主分支另有变化。

**已核实事实：**

- [发布页](https://github.com/Agony5757/mahjong/releases/tag/v1.0.2)的官方资源清单有 `mahjong_VLOG_BC.pth`、`mahjong_VLOG_CQL.pth`，各约 48.5 MB，以及约 870 MB 的离线数据。README 指向 `v1.0.4` 的下载说明与实际权重所在版本不同；本次未验证权重内容。
- [环境源码](https://github.com/Agony5757/mahjong/blob/242aa3f39237b3b298620b5725f807a87dbc4049/pymahjong/env_pymahjong.py#L351-L360)将本家 `get_obs()` 和合法动作 mask 交给模型。[模型源码](https://github.com/Agony5757/mahjong/blob/242aa3f39237b3b298620b5725f807a87dbc4049/pymahjong/models.py#L18-L37)默认 `vlog` 使用 `93×34` 公共观测，Oracle 类型另用 `111×34`。模型覆盖出牌、碰杠、胡与过等决策，并非仅胡牌器；训练用 Oracle 不代表这个推理入口必须读对手暗牌。
- 当前仓库有 [Apache-2.0 LICENSE](https://github.com/Agony5757/mahjong/blob/master/LICENSE)；但本次访问 `v1.0.2/LICENSE` 返回 404，发布资源未核到独立的权重和数据授权。因此不能将当前代码许可直接当作历史发布资源授权已完整解决的证明。
- [作者说明](https://github.com/Agony5757/mahjong/blob/master/pymahjong/README.md)引用 [ICLR 2022 论文](https://openreview.net/forum?id=pjqqxepwoMy)，并说明天凤六段以上示范数据来源。本次论文入口被访问验证拦截，未独立核对正文的性能结果；这些也不是川麻高手成绩。

**适配判断：**日麻模型包含字牌、吃、立直、宝牌、役和日麻结算，没有 V1 的换三张、定缺和胡后退出继续血战。合法动作过滤可以约束动作合法性，不能保证其收益估值适合川麻。将不存在的日麻特征清零不能保留原有水平保证；若采用其学习方法，应在真实 V1 公共观测和结算下重新训练、独立评估。

**待核实：**历史代码与权重、数据的许可覆盖；配套版本运行和公共观测编码；论文中的实际水平及适用范围。当前主分支环境为 54 动作，旧 VLOG 模型为 47 动作，不能混用版本后宣称已经可运行。

## sceneun1ty/mahjong-ai：轻量川麻建议脚本

固定提交为 `bab84684be6c09ac0876dd8682420d47a3c7f0cd`，读取于 2026-10-18。

**已核实事实：**

- [README](https://github.com/sceneun1ty/mahjong-ai/blob/bab84684be6c09ac0876dd8682420d47a3c7f0cd/README.md)标注 MIT；[固定版本根目录](https://github.com/sceneun1ty/mahjong-ai/tree/bab84684be6c09ac0876dd8682420d47a3c7f0cd)清单未见完整 LICENSE。本次未获得补充授权材料。
- [核心脚本](https://github.com/sceneun1ty/mahjong-ai/blob/bab84684be6c09ac0876dd8682420d47a3c7f0cd/scripts/mahjong_analyze.py)有定缺（161 行）、换三张（233 行）、弃牌分析（414 行），输入为手牌、公开弃牌和副露，不要求对手暗牌；没有完整碰杠决策接口，也没有需下载的训练模型。
- 同一脚本的胡牌器要求隐藏手牌固定为 14 张（38–42 行），主分析仅处理 13/14 张（489、504 行）；副露后的短手牌没有完整支持。弃牌排序不接收已定缺花色。README 描述先定缺再换三张，也与 V1 流程不同。
- README 的少量自测为作者自述，未查到可复核的同规则强手对战成绩；不能作为高手标尺。

**适配判断：**可借鉴独立的开局与结构启发式，但补齐定缺约束、副露手牌、碰杠和完整血战流程后，已需要显著开发。当前不优先引入，尤其不能将补写的宿主策略计作原项目已具备的能力。

**待核实：**完整 MIT 授权材料、代表性牌例正确性、完整策略与实战强度。上述源码缺口来自静态检查，未运行候选。

## 对当前验证路线的影响

五项均未进入正式对照名单。本页不改变现有独立参考的证据边界；相关验收原则见[策略强度的独立验证](TEACHER_INDEPENDENT_VALIDATION.md)。较高水平仍需要公认的同规则强标尺，或有实力依据的真人独立复核；源码独立、训练方法先进和可下载权重均不能单独替代这些证据。

## 2026-10-19 补充核查

此次有界搜索只深入以下三项；原始固定版本、22 份所读文本的哈希、完整文件树和公开资源入口证据在忽略的 `local/strength-goal-20261018/additional-reference-research/`。尚无新的可直接使用强标尺。

| 候选                                                                | 固定提交                                   | 判断                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| [jaysonph/sichuan-mj-AI](https://github.com/jaysonph/sichuan-mj-AI) | `eead5e644239204f9afded4d5f210634c4c23b01` | 有川麻完整决策骨架和公开权重入口，但默认网络历史有别家摸牌泄漏，不能直接使用其强度宣称 |
| [Djttt/mahjong](https://github.com/Djttt/mahjong)                   | `cb3491126e5b424e66329e74a3e06f56b8995a18` | 公共观测和轻量规则策略有参考价值，未发布预训练模型，规则与结算仍须审计                 |
| [Matrixchung/MahjongAI](https://github.com/Matrixchung/MahjongAI)   | `8323e07fe5a863f14dc06e27b73061de279ab443` | 项目明确未完成，没有可调用的完整血战策略，不推荐适配                                   |

**jaysonph** 提供 108 张、定缺、胡后继续的环境和出牌/碰/杠网络，代码许可为 [GPL-3.0](https://github.com/jaysonph/sichuan-mj-AI/blob/eead5e644239204f9afded4d5f210634c4c23b01/LICENSE)。但实际 [FeatureTracer](https://github.com/jaysonph/sichuan-mj-AI/blob/eead5e644239204f9afded4d5f210634c4c23b01/MajhongAI/mahjong/settings.py#L72-L99) 在任何玩家 DRAW 时把具体牌写入四座位各自的五帧历史，随后交给网络；不是单纯环境对象有暗牌字段的理论风险。去掉泄漏或将其清零会改变模型输入，必须重新确认或训练，不能沿用原实力。

[作者 README](https://github.com/jaysonph/sichuan-mj-AI/blob/eead5e644239204f9afded4d5f210634c4c23b01/README.md) 有可访问的 Google Drive 权重目录；只核到文件名，未下载内容、验证运行或完整权重授权。它指向的 [IJCAI 2020 官方比赛](https://www.botzone.org.cn/static/gamecontest2020a_cn.html)是国标麻将，不能据此给川麻版本授予比赛水平。原环境还采用自摸加番、4 番封顶及呼叫转移，与 V1 不同；未找到可复核的本规则强手成绩。

**Djttt** 的 [RuleAgent](https://github.com/Djttt/mahjong/blob/cb3491126e5b424e66329e74a3e06f56b8995a18/agents/rule_agent.py) 接收本家计数、副露、合法 mask 等公共输入，另有 MaskablePPO 训练入口；固定文件树、tags 和 releases 没有发布预训练模型。[环境源码](https://github.com/Djttt/mahjong/blob/cb3491126e5b424e66329e74a3e06f56b8995a18/env/sichuan_env.py)存在自摸给赢家三份收入、仅向未胡者扣款的静态非零和路径，且原动作 mask 不强制清缺；这些是源码判断，未运行该环境。README 标注 MIT，但固定树没有完整 LICENSE。可以参考训练接口，暂不替换已验证的 V1 引擎，也不将轻量基线当高手。

**Matrixchung** 的 [README](https://github.com/Matrixchung/MahjongAI/blob/8323e07fe5a863f14dc06e27b73061de279ab443/README.md)明确标为 Incomplete，许可为 GPL-3.0；牌价值函数仍有被多行字符串包住的实验主体，未见完整四家流程、碰杠响应、权重或净分评估。

## 第三种实现线索：Fanfou BA

新调查的首选来源是 [xingdream/mahjong 固定提交](https://github.com/xingdream/mahjong/tree/02e3373649699bc73af87db46ee144bba65ae830) `02e3373649699bc73af87db46ee144bba65ae830`，根目录有完整 [MIT 许可](https://raw.githubusercontent.com/xingdream/mahjong/02e3373649699bc73af87db46ee144bba65ae830/LICENSE)。作者[论文](https://html.rhhz.net/tis/html/20210730.htm)将 BA 描述为基于结构优先级的算法，并报告原规则比赛成绩；其允许吃、报听，评价重点是胜局和点炮，不能把冠军称号移用于 V1 血战长期净分。

优先审查 `完整实验2.1/ai-demo/src/dazhong_mahjong_1.py` 的 `Fan_Fou_basic.del_ourself_drw()`，与另一 JSON/MC 版本分开。已核到原类弃牌路径主要读取本家手牌、副露及公开 `ShowCount`，不需要训练权重；但硬编码 13 张的构造器、共享 class globals 和随机兜底都需要明确隔离。不能伪造短手牌、给对手注入真实听牌状态或把自家 fallback 算作外部策略。

此前忽略的 `local/strength-goal-20261018/fanfou-ba-prototype/` 已完成 125 个公开弃牌帧兼容；现以 `fanfou-ba-composite-v1` 将原核心和明确的 V1 外壳接入离线评测，保留原字节、逐方法比对、真实 14/11/8/5/2 暗手和公开计数，不把实验器的四手暗牌传入。接入与重放阶段329项 TypeScript、95项 Python检查通过；96局旧种子烟测和全部动作重放完成，页面接入和强度尚待验证。详情见[组合参考记录](INDEPENDENT_REFERENCE_FANFOU.md)。完整只读研究与适配边界在 `strength-anchor-research/report.md`、`fanfou-adapter-review.md`，没有据此授予高手水平。

另查 [lauyikfung/SichuaMahjongAI](https://github.com/lauyikfung/SichuaMahjongAI/tree/f0862eff2430862027f30a3fc50a19a739be417f)：可见川麻桌面与另一套 RLCard 训练路径，不能把其中模型目录直接当川麻高手；[zengyangjie/AI-Mahjong](https://github.com/zengyangjie/AI-Mahjong/tree/ffa86fb6257bfa0040a7771708f62849fb37ae01)未核到可调用策略和有效根许可，`.pt` 是视觉检测资源。明确川麻的 [CCDC 2022 论文入口](https://ieeexplore.ieee.org/document/10033614)值得后续核查，但本轮尚未确认可取得的代码、权重及复现成绩。以上均只界定本次实际核查，不能推成不存在其他强标尺。

## 2026-10-21 同规则高水平标尺补查

本轮没有新增可确认的同规则高水平外部锚点。以下区分出版元数据、静态源码事实与作者声明；新仓库、神经网络或训练接口均不等同于高手实力。

仅只读查阅公开一手资料，未运行候选代码、训练或对局，未调用远程决策端点；没有据部分 V7 结果选择来源或解释强弱。两个仓库的官方完整文件树均返回 `truncated=false`，文件存在不表示已验证可运行，未见文件也不表示其永不存在。

### CCDC 2022 血战论文：身份已确认，复现与实力仍未确认

[IEEE 注册的 Crossref 元数据](https://api.crossref.org/works/10.1109%2FCCDC55256.2022.10033614)确认题名为 _Design and implementation of a deep learning-based decision system for Xuezhan Mahjong_，作者 Yajun Zheng、Shuqin Li、Lanzhou Zheng，发表于 CCDC 2022，DOI 为 `10.1109/CCDC55256.2022.10033614`。

[IEEE 正文入口](https://ieeexplore.ieee.org/document/10033614)本次显示访问验证，备用摘要入口返回 418；未取得正文。不能由题名确认与 V1 的换牌、定缺、胡后退出、计分和流局结算完全一致，也未核实公共信息边界、对手、局数及统计方法。

本轮未确认作者关联的代码、权重、公开对局接口及对应许可，亦未确认可复核的高水平成绩；这是本次未取得的材料，不是断言它们不存在。出版元数据中的 IEEE 政策链接不能替代代码或模型授权。

若继续查资料，需先补公开正文、作者明确关联的实物与评估条件，再审查同规则复现价值；本轮不将其选为正式标尺。

### Dsixy/mahjong-sandbox：有血战源码，规则与许可仍有缺口

观察提交为 `1063fb6884bc57b7af308036d686f63529c52c9b`：[固定仓库树](https://github.com/Dsixy/mahjong-sandbox/tree/1063fb6884bc57b7af308036d686f63529c52c9b)、[官方完整树 API](https://api.github.com/repos/Dsixy/mahjong-sandbox/git/trees/1063fb6884bc57b7af308036d686f63529c52c9b?recursive=1)。固定版本仅标识观察对象。

- **实物与许可：**树中有引擎、bot、训练和评测接口，但未见 `LICENSE`/`COPYING`；[项目元数据](https://github.com/Dsixy/mahjong-sandbox/blob/1063fb6884bc57b7af308036d686f63529c52c9b/pyproject.toml)也无许可字段。本轮未确认明确重用许可，没有下载模型或运行这些接口。
- **规则事实：**[规则文档](https://github.com/Dsixy/mahjong-sandbox/blob/1063fb6884bc57b7af308036d686f63529c52c9b/docs/RULES.md)明确为 108 张、换三张、定缺、多人胡与胡后继续，但默认随机换牌方向、5 番封顶、过胡锁和退杠分；未清缺时禁止全部碰杠，另有 V1 不计的金钩钓、带幺九、将对，花猪结算也涉及已胡者。不能直接视为 V1 同规则。
- **作者声明：**[README](https://github.com/Dsixy/mahjong-sandbox/blob/1063fb6884bc57b7af308036d686f63529c52c9b/README.md#L17)明说牌效基线尚未 RL 训练；短程 REINFORCE 用于验证训练接口，优秀 agent 与大规模自博弈仍是后续阶段。这些是作者描述，本轮未运行核实。
- **实力边界：**README 的策略比较使用同仓库牌效 bot；未确认同规则人类高手或独立强标尺成绩，也未完成其代码来源与公开信息隔离审计。

即使将来补齐许可、规则与隔离，它仍只是待测基线，不能因工程接口齐全授予高手标签；本轮不接入或指定其为正式候选。

### daydream-wjh/rlcode：实际主环境是上饶规则，排除直接使用

原 `daydream2002/rlcode` 重定向至作者仓库；观察提交为 `487806eedac57e509c91e1a9105ac477821c271d`：[固定仓库树](https://github.com/daydream-wjh/rlcode/tree/487806eedac57e509c91e1a9105ac477821c271d)、[官方完整树 API](https://api.github.com/repos/daydream-wjh/rlcode/git/trees/487806eedac57e509c91e1a9105ac477821c271d?recursive=1)。

- **实物与许可：**固定树含源码及旧 TensorFlow checkpoint，但未见 README、`LICENSE`/`COPYING`，本轮未确认权重许可、加载兼容或对应强度。
- **静态规则事实：**[主环境](https://github.com/daydream-wjh/rlcode/blob/487806eedac57e509c91e1a9105ac477821c271d/mahjong.py#L39)明确标为上饶带宝；[首个自摸后直接返回](https://github.com/daydream-wjh/rlcode/blob/487806eedac57e509c91e1a9105ac477821c271d/mahjong.py#L387)，[行牌代码启用吃且取消点炮胡](https://github.com/daydream-wjh/rlcode/blob/487806eedac57e509c91e1a9105ac477821c271d/mahjong.py#L485)。这足以排除其作为 V1 完整血战策略的直接候选，不能以路径里的 `scmj` 字样代替流程核对。
- **接口与实力边界：**部分[动作推荐](https://github.com/daydream-wjh/rlcode/blob/487806eedac57e509c91e1a9105ac477821c271d/mah_player.py#L161)依赖源码写定的远程端点；本轮没有请求，也未确认对外服务许可。模型名、checkpoint 文件名与历史训练日志不构成 V1 高水平证据，模型还有需审计的全局状态特征分支。

除非取得独立血战版本、明确许可与同规则可核查成绩，否则不继续将其当作同规则强标尺；大幅改写后的宿主策略不能继承原模型的水平标签。

### 当前结论与边界

仍缺同时具备完整 V1 可调用实现、明确许可、公开信息隔离、独立来源与较高水平依据的外部标尺。本轮也未确认上述新线索完全不共享 ebony72/Fanfou 的实现来源。

没有据此改变策略、正式候选、阵容、通过门槛或正式种子。后续若依赖真人复核或对局，也需先核实其同规则经验与实力依据；单次真人选择或另一模型回答不能直接作为正确标签。
