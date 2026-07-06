# 热点洞察: research-tool-registry.ts

- 源文件: `web/server/application/intelligence/research-tool-registry.ts`
- 热点分数: `68`
- 主入口: `searchWeb()`、`fetchPage()`、`getFinancialPack()`
- 为什么难: 这个文件把“调用外部工具”和“清洗成内部可用证据”绑在一起了

行业研究里你看到的网页证据，并不是 Firecrawl 原样返回的对象，而是先经过这个 registry 做规范化、去重、摘要和 provider 选择。

## 这页怎么读

- 第一次阅读优先看 `canonicalizeUrl()`、`summarizeWebContent()`、`searchWeb()`。
- 如果你只关心行业采集，`searchWeb()` 是最关键的方法；`fetchPage()` 更多服务于 first-party 页面抓取。
- 这个文件的理解重点不是业务结论，而是“边界条件和数据清洗”。

## 架构图组

### 架构总览图

这张图回答“它在工作流里到底算工具还是业务层”。

![架构总览图](./charts/src-server-application-intelligence-research-tool-registry-ts-ef9a2c67-architecture-context.svg)

图后解读: 它位于应用层边界位置，上游接工作流 service，下游接 Firecrawl、Python intelligence service 和 DeepSeek。它本身不做研究判断，只做工具统一出口。

### 模块拆解图

先看它内部有哪些能力簇。

![模块拆解图](./charts/src-server-application-intelligence-research-tool-registry-ts-ef9a2c67-architecture-modules.svg)

图后解读: 对公司/行业研究最关键的是三件事:
网页搜索，
页面抓取，
金融 research pack 获取。
其余 theme news、candidate screening、credibility lookup 更偏快速研究链路。

### 依赖职责图

这张图帮助你判断“哪层负责做摘要、哪层负责做抓取”。

![依赖职责图](./charts/src-server-application-intelligence-research-tool-registry-ts-ef9a2c67-architecture-dependencies.svg)

图后解读: Firecrawl 负责搜索和抓取，DeepSeek 负责把过长网页压缩成投资者可读摘要，Python service 负责结构化金融包。registry 负责把这些接口拼成统一的内部文档格式。

## 主流程活动图

这张图最适合理解 `searchWeb()` 的完整行为。

![主流程活动图](./charts/src-server-application-intelligence-research-tool-registry-ts-ef9a2c67-activity.svg)

图后解读: 它不是“搜一下就返回”，而是:
按 query 并发搜索，
按 canonical URL 去重，
截断原始内容，
必要时调用模型摘要，
最后映射成 `ResearchWebDocument`。

## 协作顺序图

这张图重点看两个外部依赖如何协同。

![协作顺序图](./charts/src-server-application-intelligence-research-tool-registry-ts-ef9a2c67-sequence.svg)

图后解读: 对行业研究来说，真正值得注意的是“搜索结果摘要”这一步。进入 evidence pool 的 `summary` 并不是网页全文，而是压缩后的高密度表述，这会影响后续 `curateEvidence()` 的打分与排序。

## 分支判定图

这张图专门看 provider 开关。

![分支判定图](./charts/src-server-application-intelligence-research-tool-registry-ts-ef9a2c67-branch-decision.svg)

图后解读: 很多“为什么没有结果”的问题，根本原因不是查询词，而是 runtimeConfig 里的 `toolProviders`。如果 `webSearch` 不是 `firecrawl`，`searchWeb()` 会直接返回空数组。

## 异步/并发图

`searchWeb()` 的复杂度主要来自这里。

![异步/并发图](./charts/src-server-application-intelligence-research-tool-registry-ts-ef9a2c67-async-concurrency.svg)

图后解读: query 是并发发出去的，文档摘要也是并发做的。理解这一点后，你会明白为什么工作流 service 里又要额外控制 batch 大小，避免一层并发叠一层并发。

## 数据/依赖流图

这张图看“外部原始对象”是怎么被压成内部文档的。

![数据/依赖流图](./charts/src-server-application-intelligence-research-tool-registry-ts-ef9a2c67-data-flow.svg)

图后解读: 对行业研究最关键的内部产物是 `ResearchWebDocument`。从这一层往上，工作流不再关心 Firecrawl 的原始返回格式。

## 结论

如果你在调试行业采集质量，先查这三个点:

- URL 去重是不是把你想要的结果折叠掉了。
- 摘要是否把有用细节压得太短。
- runtimeConfig 的 provider 开关是否允许当前工具真正执行。
