# 行业研究工作流辅助理解文档

这组文档使用 `workflow-viz` 先生成图和骨架，再按源码语义补齐，聚焦项目里 `quick_industry_research` 这条行业研究链路。

## 建议阅读顺序

1. [行业研究工作流总览](./industry-research-workflow-overview.md)
2. [workflow.ts](./src-server-api-routers-workflow-ts-40662939.md)
3. [command-service.ts](./src-server-application-workflow-command-service-ts-b8963d50.md)
4. [execution-service.ts](./src-server-application-workflow-execution-service-ts-6ab9e0fc.md)
5. [graph-registry.ts](./src-server-infrastructure-workflow-langgraph-graph-registry-ts-aab765cc.md)
6. [quick-research-graph.ts](./src-server-infrastructure-workflow-langgraph-quick-research-graph-ts-bab325b9.md)

## 关键链路速记

1. `workflowRouter.startQuickResearch` 校验输入并创建 `WorkflowCommandService`。
2. `WorkflowCommandService.startQuickResearch` 把行业研究请求统一折叠到 `startWorkflow`。
3. `startWorkflow` 处理幂等键、模板版本兜底、节点列表提取，并落库为 `PENDING` 运行记录。
4. `WorkflowExecutionService` 由 worker 领取任务，选择对应图实现，执行节点并持续写入节点状态、checkpoint 和事件流。
5. `WorkflowGraphRegistry` 负责把 `templateCode + version` 解析到真正的 LangGraph runner。
6. `QuickResearchContractLangGraph` 是当前默认的行业研究主实现，负责澄清范围、抽取研究规格、分能力执行研究单元、补缺和产出最终报告。

## 文档清单

| 文件 | 角色 | 分数 | 图类型 | 文档 |
| --- | --- | ---: | --- | --- |
| `src/server/api/routers/workflow.ts` | 服务端入口，负责鉴权、参数校验和错误映射 | 56 | architecture, activity, sequence, branch-decision, async-concurrency | [打开](./src-server-api-routers-workflow-ts-40662939.md) |
| `src/server/application/workflow/command-service.ts` | 创建工作流运行、模板兜底、暂停恢复和事件推送 | 81 | architecture, activity, sequence, branch-decision, state, async-concurrency | [打开](./src-server-application-workflow-command-service-ts-b8963d50.md) |
| `src/server/application/workflow/execution-service.ts` | worker 执行器，处理领取、恢复、取消、暂停、失败和成功收尾 | 76 | architecture, activity, sequence, branch-decision, state, data-flow | [打开](./src-server-application-workflow-execution-service-ts-6ab9e0fc.md) |
| `src/server/infrastructure/workflow/langgraph/graph-registry.ts` | 模板版本到图实现的路由表 | 55 | architecture, activity, sequence, branch-decision, data-flow | [打开](./src-server-infrastructure-workflow-langgraph-graph-registry-ts-aab765cc.md) |
| `src/server/infrastructure/workflow/langgraph/quick-research-graph.ts` | 行业研究 LangGraph 定义，包含 v1 / v2 / v3 三代实现 | 77 | architecture, activity, sequence, branch-decision, state, async-concurrency, data-flow | [打开](./src-server-infrastructure-workflow-langgraph-quick-research-graph-ts-bab325b9.md) |

## 支撑定义

- `src/server/domain/workflow/types.ts` 定义了 `QUICK_RESEARCH_TEMPLATE_CODE`、v2/v3 节点顺序、`QuickResearchGraphState` 和 `getWorkflowNodeKeysFromGraphConfig`。
- `src/server/domain/workflow/research.ts` 的 `resolveResearchRuntimeConfig` 会把模板里的图配置转成运行时并发、轮次和证据上限。

## 状态标签

- `hotspot`: 已达到默认可视化阈值，是当前任务最值得先读的文件。
- `explicit`: 分数不一定最高，但和本次“行业研究工作流理解”直接相关。
