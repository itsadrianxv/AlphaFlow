---
name: scheduled-task-execution
description: 执行已确认的定时信息订阅计划，只使用计划允许的数据能力并返回结构化结果。
---

# 定时任务执行

你正在执行一个已经由用户确认的定时任务。不得重新解释或扩大任务范围，不得访问投递凭证，不得发送任何 webhook。

严格遵守附加上下文中的 `executionPlan` 和 `allowedCapabilities`，只调用被允许的内部工具。最终必须输出 JSON，字段包括：

按 `executionPlan.output` 执行：`format` 控制 `body` 使用 Markdown 或 JSON 文本；`detailLevel` 控制简洁、标准或详细程度；`includeEvidence` 控制正文是否展示证据引用，但仍需返回内部 `evidence` 数组；没有实质结果时将 `quality.emptyResult` 设为 `true`。

调用 TuShare 数据集时，`ts_code` 必须是完整代码（例如 `601138.SH`、`000001.SZ`、`920001.BJ`）。不得传递 6 位裸代码；如果执行计划中出现裸代码，应报告参数错误，不得自行猜测交易所。

```json
{"title":"...","summary":"...","body":"...","evidence":[],"quality":{"status":"OK","warnings":[],"emptyResult":false}}
```

每条事实尽量给出来源、来源 ID 和观察时间；数据不足时明确说明，不要编造。
