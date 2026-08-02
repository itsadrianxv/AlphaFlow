# ADR-0004 LLM 调度 Worker 与 Web 内部接口 seam

## 状态

已采用。

## 决策

后台 LLM 任务由 `cpp/workers/llm_scheduler` 负责 Redis Stream 唤醒、PostgreSQL claim/lease/heartbeat、有限并发、HTTP 调用、退避重试和终态 settlement。数据库中的 `LlmTaskExecution` 是任务生命周期唯一真实状态源；Redis 只保存至少一次唤醒，重试继续保留原 PEL 消息，不发布替代消息。

Stream schema version `1` 固定携带 `taskId`、`taskType`、`idempotencyKey`、`inputHash` 和 `createdAt`。Worker 在 claim 和 HTTP 响应两侧都校验任务类型、幂等键和候选输入哈希，避免重复裁定、重复事件修订或旧输入覆盖新结果。

Worker 调用受 `X-Alphaflow-Internal-Secret` 保护的 Web 内部接口。请求只携带任务身份、attempt 和哈希，不复制候选簇或证据正文；Web 侧按任务读取冻结候选/证据快照，调用既有 TypeScript LLM module，校验结构化输出并幂等写回。C++ 不实现提示词、模型路由或业务 JSON 语义解析。

连接错误、超时、408、429 和 5xx 默认可重试；401/403、其他 4xx 及结构化业务拒绝默认进入失败终态。Web 可用 `obsolete: true` 或 `TASK_OBSOLETE` 明确表示任务失去执行意义，Worker 将其映射为取消终态。

## 后果

该 seam 让事件候选与证据契约仍由 Web/领域模块演进，C++ 只承载长任务可靠性。真实事件裁定、首页或定时简报适配器必须创建 `LlmTaskExecution` 并发布上述消息，同时保证 `inputHash` 对应冻结输入快照；本 ADR 不提前定义 Issue #11 的事件领域规则。
