# 统一投研对象引用模型设计

## 背景

AlphaFlow 已经有 `自选股`、`行业研究`、`公司判断`、`Pi Agent`、`筛选` 和 `Research Space` 等投研模块。随着用户在不同页面之间沉淀更多结论，需要一个统一方式引用“正在研究什么”，避免页面之间只靠文本复制或临时参数传递。

本设计聚焦三个核心对象的定位：

- 收藏公司
- 收藏行业
- 自选股

目标不是把三者合并成同一种列表，而是明确各自职责，并提供统一引用模型，让 `Pi Agent`、`筛选`、`行业研究`、`公司判断` 等页面都能引用这些对象。

## 核心定位

### 1. 收藏公司

收藏公司不是“自选股里的某只股票”的重复概念，而是公司级长期研究档案。

它应该保存：

- 股票代码
- 公司名
- 关注理由
- 标签
- 核心假设
- 风险点
- 最近研究结论
- 关联 workflow runs
- 是否加入某些自选股

收藏公司偏知识层，重点是长期跟踪单个公司的投资逻辑、证据、风险和历史判断。

### 2. 收藏行业

收藏行业是行业或主题级长期研究档案。

它应该保存：

- 行业名
- 分类来源，例如申万、同花顺概念、自定义主题
- 关注理由
- 核心驱动
- 相关公司
- 关联行业研究 runs
- 风险
- 跟踪指标

收藏行业偏研究层，重点是跟踪行业景气、主题演化、核心驱动、代表公司和后续验证指标。

### 3. 自选股

自选股继续保留为“股票组合、候选池、择时输入”。

它偏操作层：一组股票，用来筛选、择时、组合建议。

收藏公司偏知识层：单个公司长期跟踪。

两者可以互相引用，但不要合并。例如：

- 一个收藏公司可以标记“已加入哪些自选股”；
- 一个自选股列表可以展示其中哪些股票已有收藏公司档案；
- 自选股可以作为筛选和择时输入；
- 收藏公司可以作为公司判断和 Pi Agent 上下文输入。

## 统一引用模型

建议优先引入统一的投研对象引用类型：

```ts
type ResearchTargetRef =
  | { type: "company"; id: string }
  | { type: "industry"; id: string }
  | { type: "watchlist"; id: string }
  | { type: "space"; id: string }
  | { type: "workflow_run"; id: string };
```

这个类型用于表达“当前任务引用了哪些投研对象”，而不是替代各对象自身的数据模型。

## 设计原则

### 1. 业务实体显式建模

不要一开始就把所有东西塞进通用 `FavoriteEntity` 表。

推荐显式建模：

- `SavedCompany`
- `SavedIndustry`
- `WatchList`
- `ResearchSpace`
- `WorkflowRun`

原因是这些对象的业务语义、字段结构和生命周期不同。显式建模更利于约束、权限校验、页面表达和后续扩展。

### 2. 引用模型统一，实体模型分离

`ResearchTargetRef` 只负责跨模块传递引用：

- Pi Agent 可以带着一个或多个 refs 开始对话；
- 筛选可以从 watchlist 或 industry 引用生成候选范围；
- 行业研究可以引用 SavedIndustry、相关公司和历史 workflow runs；
- 公司判断可以引用 SavedCompany、所属行业和相关历史 runs；
- Research Space 可以继续作为更高层的研究容器，聚合不同 refs。

实体本身仍由各自的 model、router 和页面维护。

### 3. 自选股不承担知识档案职责

自选股应保持轻量，主要表达“股票集合”和组合操作意图。

不建议把公司长期研究字段直接塞到自选股成员里，否则会导致：

- 同一家公司出现在多个自选股时，研究结论重复；
- 公司研究历史和组合操作历史混在一起；
- 后续公司判断、Pi Agent、Research Space 很难引用稳定的公司档案。

### 4. 收藏行业不等于筛选条件

收藏行业是研究对象，筛选条件是操作表达。

例如“人形机器人”可以是一个收藏行业或主题，但在筛选中可能展开为：

- 相关同花顺概念；
- 申万行业；
- 关键词命中的公司；
- 用户手动维护的代表公司；
- 最近研究结论中的候选公司。

因此收藏行业应保存分类来源和相关公司，但不要被降级为单一筛选字段。

## 页面接入建议

### Pi Agent

Pi Agent 应支持选择或注入 `ResearchTargetRef[]`，作为对话上下文。

示例：

- 引用某个收藏公司，让 Agent 回答“这家公司最近风险是否变化”；
- 引用某个收藏行业，让 Agent 总结行业驱动和相关公司；
- 引用某个自选股列表，让 Agent 生成组合观察或后续研究计划；
- 引用某个 workflow run，让 Agent 基于已有结论继续追问。

### 筛选

筛选页可以引用：

- `watchlist`：限制候选范围到某个自选股；
- `industry`：从收藏行业展开候选公司或行业条件；
- `company`：围绕单家公司生成同业对比或可比公司筛选。

筛选结果也应支持把公司加入收藏公司或自选股。

### 行业研究

行业研究页应优先支持 `industry` 引用。

当用户选择收藏行业后，页面可以自动带入：

- 行业名；
- 分类来源；
- 关注理由；
- 核心驱动；
- 相关公司；
- 历史行业研究 runs；
- 跟踪指标。

研究完成后，应能把新的 workflow run 关联回该收藏行业。

### 公司判断

公司判断页应优先支持 `company` 引用。

当用户选择收藏公司后，页面可以自动带入：

- 股票代码；
- 公司名；
- 关注理由；
- 核心假设；
- 风险点；
- 最近研究结论；
- 关联 workflow runs；
- 所属自选股。

判断完成后，应能把新的 workflow run 关联回该收藏公司。

## 建议的数据模型方向

第一阶段建议新增：

```prisma
model SavedCompany {
  id              String   @id @default(cuid())
  userId          String
  stockCode       String
  stockName       String
  watchReason     String?
  tags            String[] @default([])
  coreHypotheses  Json     @default("[]")
  riskPoints      Json     @default("[]")
  latestConclusion Json?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([userId, stockCode])
  @@index([userId, updatedAt])
  @@index([userId, stockName])
}

model SavedIndustry {
  id              String   @id @default(cuid())
  userId          String
  name            String
  taxonomySource  String
  watchReason     String?
  coreDrivers     Json     @default("[]")
  relatedCompanies Json    @default("[]")
  riskPoints      Json     @default("[]")
  trackingMetrics Json     @default("[]")
  latestConclusion Json?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([userId, taxonomySource, name])
  @@index([userId, updatedAt])
  @@index([userId, name])
}
```

关联 workflow runs 可以使用独立 link 表，避免在主表里堆数组：

```prisma
model SavedCompanyRunLink {
  id             String   @id @default(cuid())
  savedCompanyId String
  runId          String
  note           String?
  createdAt      DateTime @default(now())

  @@unique([savedCompanyId, runId])
  @@index([savedCompanyId, createdAt])
  @@index([runId])
}

model SavedIndustryRunLink {
  id              String   @id @default(cuid())
  savedIndustryId String
  runId           String
  note            String?
  createdAt       DateTime @default(now())

  @@unique([savedIndustryId, runId])
  @@index([savedIndustryId, createdAt])
  @@index([runId])
}
```

公司与自选股之间已有 `WatchList.stocks` 的 JSON 结构，第一阶段可以通过股票代码动态判断“是否加入某些自选股”。如果后续需要更强查询能力，再考虑把自选股成员拆成关系表。

## 分阶段实现建议

### 第一阶段：打通对象和引用

- 新增 `SavedCompany`、`SavedIndustry` 及对应 router；
- 新增 `ResearchTargetRef` contract；
- 在公司判断支持选择收藏公司；
- 在行业研究支持选择收藏行业；
- 在 Pi Agent 消息或会话启动参数中支持 `ResearchTargetRef[]`。

### 第二阶段：打通关联和回写

- 公司判断完成后，支持关联 run 到收藏公司；
- 行业研究完成后，支持关联 run 到收藏行业；
- 筛选结果支持加入收藏公司或自选股；
- 收藏公司详情展示所属自选股；
- 收藏行业详情展示相关公司和历史行业研究。

### 第三阶段：增强上下文和自动化

- Pi Agent 根据 refs 自动展开摘要上下文；
- 筛选根据收藏行业自动生成候选范围；
- 公司判断自动读取最近公司结论和相关行业结论；
- 行业研究自动带入代表公司和跟踪指标；
- Research Space 聚合 company、industry、watchlist、workflow_run 等对象。

## 非目标

第一阶段不建议做以下事情：

- 不把收藏公司、自选股、收藏行业合并成一个通用收藏表；
- 不重构现有自选股存储结构；
- 不一次性改造所有页面 UI；
- 不把收藏行业直接等同为某个单一数据源的行业分类；
- 不要求 Pi Agent 一开始就自动理解所有 refs，先能显式传入和解析即可。

## 总结

推荐方向是：实体显式、引用统一、页面按场景接入。

`收藏公司` 是公司级知识档案，`收藏行业` 是行业或主题级研究档案，`自选股` 是股票集合和操作输入。`ResearchTargetRef` 则作为跨模块的轻量引用协议，把这些对象接入 Pi Agent、筛选、行业研究、公司判断和 Research Space。
