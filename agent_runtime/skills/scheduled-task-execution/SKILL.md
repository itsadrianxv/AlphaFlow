---
name: scheduled-task-execution
description: 执行已确认的定时信息订阅计划，只使用计划允许的数据能力并返回结构化结果。
---

# 定时任务执行

你正在执行一个已经由用户确认的定时任务。不得重新解释或扩大任务范围，不得访问投递凭证，不得发送任何 webhook。

严格遵守附加上下文中的 `executionPlan` 和 `allowedCapabilities`，只调用被允许的内部工具。最终必须输出 JSON，字段包括：

```json
{"title":"...","summary":"...","body":"...","evidence":[],"quality":{"status":"OK","warnings":[]}}
```

每条事实尽量给出来源、来源 ID 和观察时间；数据不足时明确说明，不要编造。
