# 统一投研对象引用模型

## 结论

推荐模型是三层：

```text
第一层：真实业务对象
SavedCompany / SavedIndustry / WatchList / WorkflowRun

第二层：统一引用
ResearchTargetRef = { type, id }

第三层：附属内容
ResearchNote / FinancialSnapshot / ResearchArtifact
```

`ResearchTargetRef` 是“指向某个投研对象的地址”。笔记、财务快照、AI 报告等附属内容通过这个地址挂到具体对象上。

## 三类核心对象

### 收藏公司

`SavedCompany` 是公司级长期研究档案，不是自选股成员的重复字段。

它主要负责稳定身份信息和轻量元信息，例如：

- 股票代码
- 公司名
- 关注理由
- 标签

公司相关的假设、风险、结论、摘录、报告和财务快照，不做成 `SavedCompany` 的固定字段，而应沉淀为 `ResearchNote`、`FinancialSnapshot`、`ResearchArtifact`。

### 收藏行业

`SavedIndustry` 是行业或主题级长期研究档案。

它主要负责稳定身份信息和轻量元信息，例如：

- 行业名或主题名
- 分类来源，例如申万、同花顺概念、自定义主题
- 关注理由
- 标签

行业驱动、风险、跟踪指标、相关公司和研究结论也应通过灵活笔记和报告承载，不是固化为预设字段。

### 自选股

`WatchList` 继续作为股票集合、候选池和操作输入。

它偏操作层，用于：

- 筛选
- 择时
- 组合建议
- 候选池管理

`SavedCompany` 偏知识层，`WatchList` 偏操作层。两者可以互相引用，但不要合并。

## ResearchTargetRef

统一引用类型：

```ts
type ResearchTargetRef =
  | { type: "company"; id: string }
  | { type: "industry"; id: string }
  | { type: "watchlist"; id: string }
  | { type: "workflow_run"; id: string };
```

在数据库中可以落成：

```text
targetType
targetId
```

例如：

```text
targetType = company
targetId = saved_company_123
```

表示这条内容属于某个收藏公司。

```text
targetType = industry
targetId = saved_industry_456
```

表示这条内容属于某个收藏行业。

```text
targetType = watchlist
targetId = watchlist_789
```

表示这条内容属于某个自选股列表。

## 附属内容如何关联对象

`ResearchNote`、`FinancialSnapshot`、`ResearchArtifact` 不需要分别建成 `CompanyNote`、`IndustryNote`、`WatchListNote`。

它们统一保存 `targetType + targetId`：

```prisma
model ResearchNote {
  id         String   @id @default(cuid())
  userId     String
  targetType String
  targetId   String
  title      String?
  kind       String?
  content    String
  source     Json?
  tags       String[] @default([])
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([userId, targetType, targetId, updatedAt])
}
```

同一张 `ResearchNote` 表可以表达：

- 某个公司的笔记
- 某个行业的笔记
- 某个自选股列表的笔记
- 某次 Workflow Run 的笔记

`FinancialSnapshot` 和 `ResearchArtifact` 也采用同样方式关联目标对象。

## 筛选页的财务快照与比较报告

筛选页应支持保存单家公司或多家公司的财务数据快照。

更重要的是多公司场景，因为筛选页天然是在做候选池比较。单公司财务快照可以视为多公司比较能力的特例。

建议关系：

```text
FinancialSnapshot
  targetType = company | watchlist | industry | workflow_run
  targetId
  companyRefs
  metricSet
  periodRange
  rawSnapshot
```

比较报告不要只保存最终文本，应保存为基于财务快照生成的 `ResearchArtifact`：

```text
FinancialSnapshot -> ResearchArtifact
```

这样用户之后可以重新生成报告、换模板或继续让 AI 解读。

## 高亮文本加入笔记

在 `行业研究`、`公司分析`、`择时组合`、`Pi Agent` 等页面，用户可以高亮生成文本中的片段，并添加到某个对象的笔记。

目标对象通过 `ResearchTargetRef` 指定：

```text
高亮片段 -> ResearchTargetRef -> ResearchNote
```

AI 可以帮助格式化高亮内容，例如：

- 保持原文
- 整理为要点
- 整理为假设
- 整理为风险
- 整理为待验证问题
- 整理为跟踪指标

这些分类应作为弱结构化的 markdown 格式存在，不应变成强制 schema。


## 推荐关系

```text
SavedCompany
  <- ResearchTargetRef { type: "company", id }
      <- ResearchNote
      <- FinancialSnapshot
      <- ResearchArtifact

SavedIndustry
  <- ResearchTargetRef { type: "industry", id }
      <- ResearchNote
      <- FinancialSnapshot
      <- ResearchArtifact

WatchList
  <- ResearchTargetRef { type: "watchlist", id }
      <- ResearchNote
      <- FinancialSnapshot
      <- ResearchArtifact
```
