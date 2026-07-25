# EvidenceContext 设计调研

## 1. AnalysisContextPack 是什么

`daily_stock_analysis` 的 `AnalysisContextPack` 是一个统一的数据上下文，不负责抓取数据，只负责把已经获取的数据按统一格式组织起来。

它主要解决三个问题：

- 每个数据来自哪里、是什么时间的数据？
- 数据是否缺失、过期或经过降级？
- 不同使用方应该看到哪些内容？

顶层结构大致如下：

```text
AnalysisContextPack
  subject       标的、名称、市场
  phase         市场阶段
  blocks        行情、日线、技术面、新闻、基本面等数据块
  data_quality  整体质量和限制
  metadata      触发来源等元数据
  pack_version  契约版本
```

## 2. 数据块和状态

每个数据块都有状态、来源、时间、警告和具体数据项。数据项还可以记录降级来源和缺失原因。

目前使用的状态包括：

| 状态 | 含义 |
| --- | --- |
| `available` | 数据可用 |
| `missing` | 没有拿到数据 |
| `not_supported` | 当前数据源不支持 |
| `fallback` | 使用了替代来源 |
| `stale` | 数据已过期 |
| `estimated` | 数据为估算值 |
| `partial` | 数据不完整 |
| `fetch_failed` | 本次抓取失败 |

关键规则是：数据缺失不能直接被解释成利好或利空。它只能限制相关分析的可靠程度。

## 3. 三种使用方式

同一个 pack 会生成不同的投影：

1. **内部完整数据**：供运行流程使用，可以包含原始值。
2. **Prompt 摘要**：只告诉模型数据块状态、来源、警告、缺失原因和质量限制，不直接塞入所有原始数据。
3. **公开 overview**：给历史记录、API 和 Web 页面使用，只展示状态、来源、质量分数和限制，不展示新闻正文、原始行情或敏感信息。

这比让每个 Agent 自己解析不同工具返回的数据更稳定。

## 4. 数据质量和模型约束

它会为主要数据块计算质量摘要，例如：

```text
overall_score
level: good / usable / limited / poor
block_scores
limitations
warnings
```

质量信息不只是展示用，还会限制模型输出。例如实时行情、日线或技术面数据处于过期、降级、缺失、失败或不完整状态时，不允许模型输出高置信度结论。

## 5. 对本项目的借鉴

本项目可以设计一个统一的 `EvidenceContext`，供行业研究、公司研究和 Pi Agent 共用：

```text
EvidenceContext
  subject
  phase
  blocks
    items
  quality
  metadata
```

每条证据至少记录：

```text
evidenceId
内容或结构化事实
来源
发布时间 / 数据时间
抓取时间
status
freshness
limitations
```

调研依据：`temp/daily_stock_analysis/src/schemas/analysis_context_pack.py`、`analysis_context_pack_prompt.py`、`analysis_context_pack_overview.py`、`services/analysis_context_builder.py` 及 `docs/analysis-context-pack.md`。
