# LLM Scheduler Worker

`llm-scheduler` 只负责后台 LLM 任务的可靠执行，不负责提示词、候选簇聚合或结构化业务结果的语义判断。

## 生命周期

Redis Stream 只提供至少一次唤醒。消息必须使用 schema version `1`，并包含：

- `taskId`：对应 PostgreSQL `LlmTaskExecution.id`；
- `taskType`：例如 `EVENT_ADJUDICATION`、`HOMEPAGE_GENERATION` 或 `SCHEDULED_BRIEF`；
- `idempotencyKey`：一次逻辑任务的稳定幂等键；
- `inputHash`：候选输入/证据快照的规范化哈希；
- `createdAt`：入队时间。

Worker 领取任务时会同时校验任务类型、幂等键和输入哈希。PostgreSQL 的 `RUNNING`、lease、heartbeat、attempt 和 fencing token 是唯一生命周期状态源；retry 只写入 `RETRY_WAIT` 与 `nextAttemptAt`，原消息保留在 Redis PEL，不能发布替代消息。

## Web 内部接口

Worker 调用：

```text
POST /api/internal/llm/tasks/{taskId}/execute
```

请求带有 `X-Alphaflow-Internal-Secret`、`Idempotency-Key`、`X-Alphaflow-Task-Type` 和 `X-Alphaflow-Input-Hash`。请求体只包含任务身份、attempt 和 schema version，不复制候选簇或证据正文；Web 侧按 `taskId` 读取冻结快照，调用既有 TypeScript LLM module，校验结构化输出后幂等写回。

成功响应必须是：

```json
{
  "status": "COMPLETED",
  "taskId": "...",
  "taskType": "EVENT_ADJUDICATION",
  "idempotencyKey": "...",
  "inputHash": "sha256:...",
  "result": {},
  "metadata": {}
}
```

408、429、5xx、连接错误和超时可重试；401/403、4xx 以及结构化业务拒绝进入终态。Web 如果明确返回 `{"obsolete":true,"code":"TASK_OBSOLETE"}`，Worker 将任务映射为 obsolete/cancelled。

## 配置

必填：`DATABASE_URL`、`REDIS_URL`、`ALPHAFLOW_WEB_INTERNAL_URL`、`ALPHAFLOW_INTERNAL_API_SECRET`。

可选配置：`LLM_WORKER_THREADS`、`LLM_WORKER_QUEUE_CAPACITY`、`LLM_WORKER_LEASE_SECONDS`、`LLM_WORKER_HEARTBEAT_SECONDS`、`LLM_WORKER_CLAIM_IDLE_MS`、`LLM_WORKER_REQUEST_TIMEOUT_MS`、`LLM_WORKER_CONNECT_TIMEOUT_MS`、`LLM_WORKER_MAX_ATTEMPTS`、`LLM_WORKER_RETRY_DELAYS_SECONDS`、`LLM_TASK_STREAM`、`LLM_TASK_GROUP` 和 `LLM_WORKER_HEALTH_PORT`。
