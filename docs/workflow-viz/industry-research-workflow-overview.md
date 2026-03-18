# 行业研究工作流总览

- 目标模板: `quick_industry_research`
- 当前默认实现: `QuickResearchContractLangGraph`（v3）
- 服务端入口: `src/server/api/routers/workflow.ts`
- 运行创建: `src/server/application/workflow/command-service.ts`
- worker 执行: `src/server/application/workflow/execution-service.ts`
- 图解析: `src/server/infrastructure/workflow/langgraph/graph-registry.ts`
- 图定义: `src/server/infrastructure/workflow/langgraph/quick-research-graph.ts`

## 这条链路在做什么

行业研究工作流不是一次单纯的“调用大模型返回一段文本”。它把一次研究请求拆成可持久化、可恢复、可观察的多节点工作流：先明确研究范围，再生成研究规格和研究单元，随后按能力分组执行，再做缺口分析、压缩结论与最终报告合成。

这条链路的关键价值在于三点：

1. 请求会先落库成 workflow run，而不是同步跑完整个研究流程。
2. 执行中间态会同时写入数据库节点记录和 Redis checkpoint，所以可以恢复、取消、暂停和继续。
3. 行业研究图不是单一版本，当前默认会尽量走 v3，但仍兼容早期模板版本。

## 端到端主路径

| 阶段 | 关键代码 | 说明 |
| --- | --- | --- |
| 入口接收 | `workflowRouter.startQuickResearch` | 鉴权、zod 校验、创建仓储和命令服务 |
| 创建运行 | `WorkflowCommandService.startQuickResearch` | 把行业研究请求转换成统一的 `startWorkflow` 命令 |
| 模板准备 | `startWorkflow` | 幂等去重、模板版本兜底、从 `graphConfig` 抽节点列表、创建 run |
| worker 领取 | `WorkflowExecutionService.executeNextPendingRun` | worker 抢占一个 `PENDING` 运行并开始推送事件 |
| 图解析 | `WorkflowGraphRegistry.get` | 根据模板 code/version 拿到真正的 LangGraph runner |
| 状态初始化 | `QuickResearchLangGraphBase.buildInitialState` | 归一化输入、研究偏好、task contract 和 runtime config |
| 节点执行 | `graph.execute(...)` + hooks | 每个节点开始、进度、成功、跳过都会写 DB 和 checkpoint |
| 结束收尾 | `markRunSucceeded / markRunPaused / markRunFailed / markRunCancelled` | 按结果更新运行状态并向实时订阅端推送事件 |

## 当前默认为什么是 v3

从 `command-service.ts` 可以看到，当请求 `quick_industry_research` 且没有显式指定 `templateVersion` 时，系统会优先通过 `ensureQuickResearchTemplate()` 保证模板存在且至少是较新的默认版本。再结合 `graph-registry.ts` 的“同 code 取最高版本”策略，行业研究默认会解析到 v3 图实现。

这意味着：

- 新发起的行业研究，默认阅读重点应该放在 `QuickResearchContractLangGraph`。
- 老运行记录如果数据库里写着旧版本，执行层仍会按旧图恢复，保证兼容。

## 三代行业研究图的定位

| 版本 | 入口类 | 核心特点 |
| --- | --- | --- |
| v1 | `QuickResearchLangGraph` | 五段式线性代理流程，适合快速串行概览 |
| v2 | `QuickResearchODRLangGraph` | 引入澄清、研究计划、执行单元、缺口分析和最终收敛 |
| v3 | `QuickResearchContractLangGraph` | 先抽取 task contract，再按能力拆分趋势、筛选、可信度与竞争分析，最后补反思与质量标记 |

## pause / resume 心智模型

行业研究最容易让人读晕的地方，不在节点数量，而在“暂停恢复”：

1. 图实现内部可以抛 `WorkflowPauseError`，典型场景是研究范围不清，需要用户补充信息。
2. `execution-service.ts` 捕获这个错误后，会把当前状态保存到 Redis checkpoint，并把 run 标记为 `PAUSED`。
3. 后续恢复时，不是从头重跑，而是先从 checkpoint 恢复，再根据已完成节点记录重建状态，最后从下一个节点继续执行。

这也是为什么 `execution-service.ts` 和 `quick-research-graph.ts` 需要一起读，单看其中一个文件都很难完整建立心智模型。

## 关键状态载体

| 载体 | 位置 | 用途 |
| --- | --- | --- |
| workflow run | Prisma / DB | 保存 run 总状态、模板版本、当前节点、进度 |
| node runs | Prisma / DB | 保存每个节点的开始、成功、失败、跳过和输出摘要 |
| checkpoint | Redis | 保存可恢复的完整图状态 |
| event stream | Redis pub/sub | 给前端运行详情页推实时事件 |
| graphConfig | workflow template | 决定节点顺序解析和研究 runtime 参数 |

## 推荐阅读方法

1. 先看 [workflow.ts](./src-server-api-routers-workflow-ts-40662939.md)，明确请求怎么进入系统。
2. 再看 [command-service.ts](./src-server-application-workflow-command-service-ts-b8963d50.md)，理解 run 是怎么被创建出来的。
3. 然后看 [execution-service.ts](./src-server-application-workflow-execution-service-ts-6ab9e0fc.md)，建立 worker 与状态机心智模型。
4. 接着看 [graph-registry.ts](./src-server-infrastructure-workflow-langgraph-graph-registry-ts-aab765cc.md)，搞清楚为什么会执行到哪个版本的图。
5. 最后看 [quick-research-graph.ts](./src-server-infrastructure-workflow-langgraph-quick-research-graph-ts-bab325b9.md)，把行业研究节点语义和版本演进一次读透。

## 支撑源码

- `src/server/domain/workflow/types.ts:46` 定义 `QUICK_RESEARCH_TEMPLATE_CODE`
- `src/server/domain/workflow/types.ts:66` 定义 v2 节点顺序
- `src/server/domain/workflow/types.ts:76` 定义 v3 节点顺序
- `src/server/domain/workflow/types.ts:334` 定义 `QuickResearchGraphState`
- `src/server/domain/workflow/types.ts:785` 从模板图配置提取节点
- `src/server/domain/workflow/research.ts:414` 解析研究运行时配置
