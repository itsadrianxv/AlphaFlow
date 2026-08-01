# Definitive Task Worker

该目录承载 definitive task worker 的领域 adapter。迁移时保留现有 stream、repository、Python executor 和环境变量协议；公共线程生命周期由 `task_runtime::WorkerRuntime` 提供。
