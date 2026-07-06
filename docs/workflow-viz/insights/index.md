# 公司研究 Workflow Viz 入口

这组文档聚焦“公司研究”主链里最容易读乱的 7 个热点文件。建议先从阅读导览建立心智模型，再按问题跳到对应热点页看图。

## 推荐起点

- [公司研究代码阅读导览](./company-research-reading-guide.md)：先建立 V4 主路径、阅读顺序和术语对齐。
- [公司研究热点地图](./intelligence/analysis.md)：先看这 7 个热点分别回答什么问题。

## 7 个热点怎么分工

| 页面 | 主要回答的问题 | 对应源码 |
| --- | --- | --- |
| [公司研究前端入口](./company-research-client/company-research-client.md) | 页面把哪些输入送进工作流？ | `app/company-research/company-research-client.tsx` |
| [工作流启动入口](./workflow-command-service/workflow-command-service.md) | run 是怎么创建并绑定到 V4 模板的？ | `web/server/application/workflow/command-service.ts` |
| [LangGraph 总控页](./langgraph-company-research-graph/langgraph-company-research-graph.md) | 节点顺序、fan-out、pause/resume、gap loop 在哪？ | `web/server/infrastructure/workflow/langgraph/company-research-graph.ts` |
| [workflow service 核心](./intelligence/company-research-workflow-service.md) | `researchUnits` 是如何规划、执行、补洞、收束的？ | `web/server/application/intelligence/company-research-workflow-service.ts` |
| [kernel 规则内核](./intelligence/research-workflow-kernel.md) | brief、task contract、unit plan、gap analysis 是怎么被规划出来的？ | `web/server/application/intelligence/research-workflow-kernel.ts` |
| [tool registry 工具门面](./intelligence/research-tool-registry.md) | Web 搜索、页面抓取、财务 pack 是如何统一封装的？ | `web/server/application/intelligence/research-tool-registry.ts` |
| [agent service 后处理](./intelligence/company-research-agent-service.md) | 证据如何去重、补引用、回答问题并变成 verdict？ | `web/server/application/intelligence/company-research-agent-service.ts` |

## 最省时间的阅读路径

1. 先看 [公司研究代码阅读导览](./company-research-reading-guide.md)。
2. 再看 [LangGraph 总控页](./langgraph-company-research-graph/langgraph-company-research-graph.md)，确认当前主路径是 V4。
3. 接着看 [workflow service 核心](./intelligence/company-research-workflow-service.md)，理解研究单元如何真正执行。
4. 遇到“这一步是谁规划的”时回到 [kernel 规则内核](./intelligence/research-workflow-kernel.md)。
5. 遇到“数据到底从哪来”时看 [tool registry 工具门面](./intelligence/research-tool-registry.md)。
6. 遇到“证据怎么变结论”时看 [agent service 后处理](./intelligence/company-research-agent-service.md)。

## 如果你只追一个问题

- 想看“点按钮之后发生什么”：先看前端入口，再看工作流启动入口。
- 想看“`industry_search` 怎么跑”：先看 LangGraph，再看 workflow service，再看 kernel。
- 想看“为什么会补洞重跑”：先看 workflow service 的 `runGapLoop`，再回 kernel 的 `analyzeResearchGaps`。
- 想看“为什么引用会被裁掉或补全”：直接看 agent service 的 `curateEvidence` 和 `enrichReferences`。
