# 首页快照 Worker

`homepage-worker` 是首页生成任务的可靠运行 adapter，复用 `cpp/libs/task_lifecycle` 与 Redis Stream transport。它负责领取 PostgreSQL 中的生成任务、维持租约和心跳、调用 Web 内部生成接口，并使用 fencing token 在同一事务中插入不可变快照和完成任务。

业务 payload 的生成位于 Web 的固定输入生成深模块。Worker 不理解热力图、资金流或事件影响映射的内部结构，只解析版本化结果信封、payload/dataCoverage 哈希字段和可重试/终态错误码。

关键环境变量包括 `DATABASE_URL`、`REDIS_URL`、`ALPHAFLOW_WEB_INTERNAL_URL`、`ALPHAFLOW_INTERNAL_API_SECRET`，以及以 `HOMEPAGE_WORKER_` 开头的并发、租约、超时和健康端口配置。
