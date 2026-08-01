# 首页快照 Worker

`homepage-worker` 是首页生成任务的可靠运行 adapter，复用 `cpp/libs/task_runtime` 与 Redis Stream transport。它负责领取 PostgreSQL 中的生成任务、维持租约和心跳、调用 Web 内部生成接口，并使用 fencing token 在同一事务中插入不可变快照和完成任务。

业务 payload 的生成位于 Web 的 `HomePagePayloadGenerator` 深模块。Worker 不理解热力图、资金流或事件影响映射的内部结构，只校验内部接口返回了对象型 `payload` 和非空 `dataAsOf`。

关键环境变量包括 `DATABASE_URL`、`REDIS_URL`、`ALPHAFLOW_WEB_INTERNAL_URL`、`ALPHAFLOW_INTERNAL_API_SECRET`，以及以 `HOMEPAGE_WORKER_` 开头的并发、租约、超时和健康端口配置。
