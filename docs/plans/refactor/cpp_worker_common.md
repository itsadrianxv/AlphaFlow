目前项目的 definitive_task_worker 和 screening_worker 架构类似，都是 C++ 线程池 + BlockingQueue 且都依赖 Redis Stream，因此存在不少代码重复，并且以后可能扩展/重构出其它类似的 C++ worker。我想进行一次重构来消除代码坏味道。

新增一个 C++ 子系统目录：

```text
cpp/
├── CMakeLists.txt
├── libs/                         # 可复用 C++ 库
│   ├── task_runtime/             # 线程生命周期、停止、任务运行时
│   ├── concurrency/              # blocking_queue、thread_pool
│   ├── messaging/                # Redis Stream 等消息适配器
│   ├── coordination/             # lease、heartbeat、fencing
│   ├── observability/            # health、metrics、logging
│   └── postgres/                 # 通用数据库连接基础设施
└── workers/                      # 可部署 worker 应用
    ├── definitive_task/
    ├── screening/
    ├── market_data/
    └── ...
```

每个 worker 保留自己的领域代码：

```text
cpp/workers/definitive_task/
├── src/
│   ├── main.cpp
│   ├── repository.cpp
│   ├── executor.cpp
│   └── protocol.cpp
├── tests/
└── CMakeLists.txt
```

依赖关系应是：

```text
具体 Worker
  → task_runtime / messaging / coordination / concurrency
  → hiredis、libpqxx 等第三方库
```
