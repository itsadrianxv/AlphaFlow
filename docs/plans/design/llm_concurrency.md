# LLM 并发性能问题记录

## 背景

行业研究、公司判断、筛选洞察和 Pi Agent 等组件都会调用 LLM。当同时运行多个实例时，当前系统表现为任务排队，未能充分并行执行。

## 已确认的问题

### 1. workflow-worker 单进程按任务串行执行

`web/tooling/workers/workflow-worker.ts` 使用单循环处理任务：每轮先恢复一个运行中的任务，或者领取一个待执行任务；只有该任务完整结束后，才会进入下一轮领取任务。

因此，在同一个 worker 进程内，多个行业研究、公司判断或其他 workflow 实例会被串行处理。

### 2. 工作流节点的并发能力受图执行方式限制

`web/server/application/workflow/execution-service.ts` 调用 workflow graph 执行任务。当前需要进一步确认各个 graph 是否将相互独立的研究节点并行执行；如果节点按顺序执行，同一工作流内部也会产生不必要的等待。

### 3. LLM 请求本身使用异步 HTTP，但缺少统一的并发调度层

`web/server/infrastructure/intelligence/deepseek-client.ts` 使用异步 `fetch` 发起请求，没有发现全局互斥锁。因此当前主要问题不是 Node.js 线程被 LLM 请求阻塞，而是上层 worker 调度串行，以及缺少统一的并发控制、限流和排队策略。

### 4. Pi Agent 运行时尚未发现全局串行锁

`agent_runtime/src/server.ts` 接收请求后异步启动 `PiAdapter.start`；`agent_runtime/src/pi-adapter.ts` 通过异步 Agent Harness 执行模型调用。不同运行实例理论上可以并发，但同一个 `sessionId` 的多个请求可能产生会话消息顺序和 JSONL session 文件竞争问题，需要单独保证会话级顺序。

### 5. 单纯改用 C++ 预计不能解决主要瓶颈

当前 LLM 调用的主要耗时来自网络、模型排队、模型推理、外部数据接口和 Agent 工具调用，不是本地 CPU 计算。除非后续确认存在大量 CPU 密集型数据处理或本地模型推理热点，否则用 C++ 重写并行逻辑不会是首要优化方向。

## 初步判断

当前最优先的问题是 workflow worker 的执行并发度，而不是 LLM 客户端的语言实现。后续应优先评估：

1. 增加多个 workflow worker 实例或引入有界并发配置；
2. 为不同模型、用户和任务类型增加统一的 LLM 并发控制与限流；
3. 梳理 workflow graph 中可并行的独立节点；
4. 为 Pi Agent 的同一 `sessionId` 增加顺序保证；
5. 记录排队时间、LLM 请求耗时、重试次数、429 次数和活跃任务数。

以上内容是问题记录，尚未实施对应的并发改造。
