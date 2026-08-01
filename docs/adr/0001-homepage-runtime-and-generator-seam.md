# C++ 可靠运行时与 TypeScript 首页生成模块

首页快照采用 C++ Worker 承担任务消费、租约、心跳、重试与带 fencing token 的原子提交，TypeScript 深模块承担完整 payload 的业务生成。该职责 seam 保留了 C++ 运行时在长任务可靠性上的复用价值，也避免把频繁变化且依赖现有 Python、事件影响映射与 Web 领域模型的生成逻辑移植到 C++；代价是 Worker 与 Web 之间需要一个受内部密钥保护的粗粒度同步接口。
