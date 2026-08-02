# 首页数据清单项 Provider 结果契约

Status: accepted

首页数据清单项的 Provider 获取尝试统一返回带 `major.minor` 版本的 `HomepageDataItemResult` 信封；它以数据集类型化 payload 承载规范化观测值、来源断言、覆盖范围、数据截止点、质量状态、错误分类和重放上下文。Python Provider/适配器负责指标目录映射、单位与时间语义、来源权威选择和结果哈希，C++ Worker 只负责生命周期、重试、fencing 与结算，避免在 Worker 中复制供应商语义。

## Considered Options

- 让 Provider 返回供应商原始表格或自由 JSON：拒绝，因为单位、时间、来源权威和缺失语义会泄漏到 C++ Worker，且无法形成稳定的跨 Provider 契约。
- 让 C++ Worker 选择来源、解释错误或补齐单位：拒绝，因为这些决策属于数据集与来源适配边界，重复实现会造成 TuShare、Minishare 和测试替身之间的语义漂移。
- 只保存来源内容哈希并在重放时重新抓取：拒绝，因为哈希不能满足审计和历史重建，重建重放也不应依赖外部 Provider 的当前结果。

## Consequences

- 结果状态固定为 `success / degraded / empty / error`，质量状态独立为 `normal / degraded / isolated`；`success`、`degraded` 和合法 `empty` 都是可持久化的结算终态，只有 `error` 依据重试归类决定是否再次获取，清单门控依据结构化覆盖范围和数据截止点判断必需项是否达标。
- 规范化观测值使用显式主体、指标、维度、观测期间、类型化值、单位和缺失原因；精确数值以十进制字符串传输，来源断言保留可审计原始记录与内容哈希。
- 结果同时记录 `observationPeriod`、`upstreamAsOf`、`sourcePublishedAt`、`actualDataCutoff`、`normalizedAt` 和 `ingestedAt`，并携带获取尝试 ID、幂等键、请求指纹、Provider/规则版本和重放模式。
- TuShare、Minishare 和测试替身通过数据集能力注册表实现同一信封并共享契约测试；不支持的数据集或不兼容主版本以结构化错误拒绝，不建立长期双版本兼容层。
