# 数据库驱动的共享任务生命周期 module

C++ Worker 的共享运行时只深化任务生命周期，不吸收信号、健康检查等进程宿主职责；数据库是生命周期的唯一真实状态源，Redis 只提供至少一次唤醒。module 采用一行 `make_worker(config, repository, executor)` interface，以强类型输入、结果和 `completed`、`retryable failure`、`terminal failure`、`obsolete` 四种语义结果贯穿执行，通过 repository adapter 的 `claim`、`renew`、`settle` seam 原子提交业务结果与终态，并以 fencing 和任务级 `stop_token` 处理并发接管与协作式取消。迁移按 Screening Worker、Homepage Worker、Definitive Task Worker 的顺序进行，完成后删除 `WorkerDefinition`、`std::any`、`republish`、`mark_submitted` 和内存重试队列；重试消息保留在 Redis PEL，由数据库 `nextAttemptAt` 决定何时可再次 claim。

## 后果

共享 module 的 interface 是生命周期行为的 test surface；module 行为测试使用内部内存 adapter 与可控时钟，三个 repository adapter 使用本地 PostgreSQL 契约测试，现有 Screening 与 Definitive Task Docker 故障测试继续保留并补齐 Homepage Worker。retry 的实际唤醒精度受 PEL recovery 周期影响，若未来需要降低延迟，只能在 module 内增加非权威唤醒加速，不能把 Redis 或内存定时器提升为真实状态源。
