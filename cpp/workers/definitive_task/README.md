# Definitive Task Worker

该目录承载 definitive task worker 的领域 adapter。现有 stream、repository、Python executor 和环境变量协议保持不变；任务生命周期由 `task_lifecycle` module 提供，retry 保留原 Redis PEL 消息并以数据库到期时间恢复。
