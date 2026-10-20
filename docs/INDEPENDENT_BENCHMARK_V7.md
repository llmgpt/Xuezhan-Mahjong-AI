# V7：按本桌规则校准当前胡牌收益

**收益算术与接入已验证，长期净分尚未验证。** `candidate-advanced-income-v7`沿用E的老师换牌/定缺与完整高级行牌，只改杠后炮当前收益的比较分母，以及抢杠当前收益应包含事件番两处语义。原T/A/E/D/K/F策略、对手和页面默认老师保留。

## 具体改动

`v1_income.py`只接已完成的本家手牌、明副露、定缺和已知事件，精确复现默认V1的基础番、事件番、3番封顶与付款单位。四明副露没有额外金钩番；自摸每个仍未胡对手付`points+1`。它不推断对手暗手、牌墙或未来概率，也不代替宿主合法操作判定。495个固定真实公开调用及12个边界牌例，基础/当前计分共1014次与宿主评分调用逐项一致。

`v1_income_policy.py`核对固定原高级源码和函数摘要，在私有globals中派生两个函数；AST和代码核对仅两条赋值变化。杠后炮把原有含呼叫转移假设的倍率改为已知V1基础收益/当前事件收益之比，封顶时不强行翻倍；抢杠改用含抢杠番的当前分值。未来概率、折扣、普通自摸乘2、金钩及其他未来收益启发式、碰杠门槛和弃牌逻辑保持原样，因此这版还没有解决全部量纲偏差。

263个已有公开帧逐一A→V7→A：14次杠后炮和2次抢杠由拒胡改为合法胡，7个目标帧不变，240个非目标帧全部保持原动作且不调用新增计分helper。输入、原策略全局绑定与普通状态未改；独立审核的23次计分调用全部与宿主相同。额外20个边界和8个异常探针通过。真实263帧没有末张杠后炮，该边界由合成公开helper探针覆盖；V1抢杠最少2点高于原`>1`门槛，使该候选接受所有合法抢杠，这不是最优性证明。

测试先观察到新模块缺失。为避免把导入失败当策略行为覆盖，又在独占副本只还原原A的两函数，保持测试/API/fixture不变：代表杠后炮`pung≠hu`与抢杠`pass≠hu`真实2失败、exit1；当前实现真实2通过、exit0。这是实现后的行为反证，未冒称最初时序RED。注册切片另先观察到TS3失败与Python2个真实响应失败，再加入新wire和同E组合，目标检查转GREEN。

真实Node→注册器→JSONL→Python四个既有公开帧联调通过，E→V7→E动作符合固定结果；9个worker全部正常退出，隐藏字段或缺公开历史在发送前拒绝。完整项目`npm run check`实际通过48文件431项TypeScript测试、格式/静态/类型检查与生产构建；Python131项通过。源码提交`595aae2`，资产提交`307b25c`；原高级适配入口另将既存CRLF原字节保真入Git，仅为固定摘要跨checkout不失配。

## 已冻结的完整开发组

2026-10-20已从`307b25c`复制113项执行源，esbuild真实metafile的28项构建输入全部来自快照，独立Node执行文件摘要为`d4f44ca70bba6857dabb622120d2455c0c000b27306358cfc99394f0c6909ded`。原始路径和全部配置见[开发冻结协议](benchmarks/independent-v7-development-protocol.json)。

- 只用已排除的60000..60039；四座位、ui-bots/ebony-advanced/fanfou-ba三阵容、共同/组合两开局、T/E/V7三策略，共2880局；每比较960配对，独立seed单位仍为40。
- 三个完整比较固定为V7−T、V7−E、E−T。先在seed内等权合成，再以40个seed计算均值、样本SE及±1.96SE近似区间，保留全部开局/阵容、四座位敏感性、七项收入和同前史首分歧。没有正式通过阈值，不读取局部强度成绩挑子集。
- 重新执行T/E全部配置，完成后才比对其与既存UI/外部E跟进的全结果及轨迹；这些控制重复不会增加独立样本。不同开局或阵容不得被总体正均值掩盖。
- 六个逻辑分片按seed取模分组，前四片各504局、末两片各432局。冻结前可用物理内存约1.4GiB，先运行一片，最多两片；只有稳定运行后新测仍有至少2GiB空闲，才增加到两并发。调度不依赖部分成绩。
- 只从复制的独立执行文件和Python闭包运行，保留完整manifest与原始行；策略/依赖/非法动作/源码/超时等错误须终止，不换seed或暗中回退。当前只记录Node22.22.1/Python3.13.5/NumPy2.1.3版本，不冒称完整OS或新正式运行时封存。

2026-10-21恢复核对时，原第1–3片各7个seed、504局已提交且complete=true，113源、28构建输入及原Node22.22.1/Python3.13.5/NumPy2.1.3匹配。旧第2/3片工具句柄缺失，不能确认其历史进程exit0；后续冻结CLI无操作续验与完整重放须单独记证。本轮工具会话中的第4/5片也中断，各10条完成轨迹保留原位且无已提交seed/失败行；改用隐藏独立后台协调器，在新目录运行相同原配置，最多两并发、第二并发新测至少2GiB空闲。全部20条旧轨迹共4670827字节现已逐字节复现，原文件哈希未变；完整接纳前仍须重验。第6片继续排队，没有替换seed、源码或策略。恢复方法见[恢复协议](benchmarks/independent-v7-recovery-protocol.json)，实际PID、运行日志和逐片终态在`local/strength-goal-20261018/v7-resume-20261021/`。当前完整网格与重放尚未收齐，未读取部分强度成绩，没有V7强度结论。状态入口保留为`local/strength-goal-20261018/development-v7-execution.json`。这仍是旧开发数据，正式候选、通过条件及新留出必须另行冻结。前一轮E在两作者对手下没有稳定提升，完整负面结果见[E跟进报告](INDEPENDENT_E_FOLLOWUP.md)。

当前浏览器E/D整局接入验证及真实错误处理已完成，见[浏览器记录](BROWSER_STRATEGY_INTEGRATION.md)；V7暂只用于离线评测。详细内部理由与可信较高水平标尺仍待补齐，Goal未完成。

本地审计：`local/v1-income-implementation/`；`local/strength-goal-20261018/{v1-utility-mismatch-review,v1-current-income-policy-red-green,v1-income-policy-independent-review,v1-income-integration}/`。完整开发数据使用`development-v7-source/`、`development-v7-plan/`及`development-v7-shard-1..6/`，未推送、合并或公开发布。

## 后续恢复的当前入口

上轮结束边界后原后台PID均已不存在，未留下实际终态；不把旧JSON心跳当作继续运行。第4/5片已提交5/4个seed的648局，其seed envelope及全部已提交trace行原字节复制到recovery-2目录，原目录和未提交行保持原位；与1..3片合计2160局。四个中断输出共742条完成轨迹均需在最终新trace中逐字节复现，仍只有40个独立seed单位。

第二次恢复只续未提交seed，当前工具入口为`local/strength-goal-20261018/v7-resume-20261021-r2/`；原协调器35208及原后处理35784已停止；当前接管入口见下段。元数据默认cp936读取曾使UTF-8清单五个中文路径错位，校验先失败；显式UTF-8读取后与实际manifest逐项相同，失败与修正证据保留，策略实现未变。

Root沿版本化E跟进报告及其锁定的两份manifest重新核验98项历史产物SHA，两个派生T/E控制目录的games/traces/summary均有原发布锚点；完整对比后还需再次核对。恢复条件、全部原始哈希和当前目录见[恢复协议](benchmarks/independent-v7-recovery-protocol.json)的`continuation2`，没有读取部分V7成绩或改动原科学比较。

## 状态发布失败后的原进程接管

R2协调器在2026-10-20T20:16:48Z因发布心跳的`os.replace`两次WinError5停止，原stdout/stderr及状态均保留；原后处理明确失败，没有进入合并或读分。真实Windows无删除共享锁已复现同一错误，再验证仅重试同一已fsync元数据的发布成功，既不重试对局也不改冻结源。

第4片原进程在观察器建立前已结束，原退出码未知。其7seed/504局complete=true，后续冻结CLI无操作续验真实exit0，games/traces/summary三文件字节不变；首个验证命令误要求逐seed打印而未写收据，日志保留，第二次按实际完整输出JSON契约通过。这些不替代原历史退出码。第5片已有真实exit0；第6片仍为原Node31108，观察器31336核对实体镜像及creationtime后持续持有内核句柄，等待GetExitCodeProcess的真实终态。没有启动或重试任何对局。

新后处理35448使用`postprocess-adopted-state.json`，原失败状态保留。独立审核确认派生diff只改变完成门禁和元数据发布，完整合并/逐动作重放/1920控制/统计尾段与原件一致；第4片必须明确原退出码未知且无操作续验通过，5和6必须有真实终态。当前仍未读取V7部分成绩，最终须验收全部2880局后才判读。新入口、源码摘要和收据见[恢复协议](benchmarks/independent-v7-recovery-protocol.json)的`observerAdoption`。

另外已完成[未来收益量纲静态审计](ADVANCED_FUTURE_INCOME_AUDIT.md)与[外部标尺补查](EXTERNAL_STRATEGY_OPTIONS.md)。它们分别核对确定金额和外部来源，未运行策略、对局或新seed，也没有据此选择新候选。

当前工作树的`npm run check`实际返回1，停在两个未跟踪`.workbuddy`本地笔记的Prettier格式，不是本轮源码或文档告警；未查看/改写这些笔记。其余lint、类型检查、49文件462项测试和生产构建另行实际exit0。历史85e0874的完整check0与当前check1分开保留；逐项收据和日志摘要见[恢复协议](benchmarks/independent-v7-recovery-protocol.json)的`currentWorktreeChecks`。
