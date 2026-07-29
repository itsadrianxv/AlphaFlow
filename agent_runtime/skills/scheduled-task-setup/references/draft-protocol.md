# 草稿协议

`validate_schedule` 的规范化草稿必须包含：`name`、`userPrompt`、`schedule`、`dataSources`、`executionPlan`、`output`、`delivery`、`feasibility` 和 `nextRunAt`。

可行性状态：

- `SUPPORTED`：可确认。
- `SUPPORTED_WITH_LIMITS`：没有阻塞项时可确认，必须展示警告。
- `NEEDS_CLARIFICATION`：信息缺失，不得保存可确认草稿。
- `UNSUPPORTED`：当前能力无法执行，不得保存可确认草稿。

`executionPlan.allowedCapabilities` 只能来自能力目录。使用 `internal_tushare_dataset` 时必须同时保存 `capabilityConstraints.internal_tushare_dataset.allowedDatasets`、`maxRows` 和 `maxLookbackDays`。

`output` 只能描述结果格式：`format` 必须是 `MARKDOWN` 或 `JSON`，`includeEvidence`、`sendOnEmpty` 必须是布尔值，`detailLevel` 必须是 `BRIEF`、`STANDARD` 或 `DETAILED`。不得在 `output` 中保存 URL、Webhook 或投递目标。

`delivery` 必须明确使用以下一种形式，不得缺省：

- `{"type":"SAVE_ONLY"}`
- `{"type":"FEISHU","targetRef":"resolve_user_scope 返回的目标别名"}`

不得请求、保存或回显真实 Webhook URL。用户要求飞书但 `resolve_user_scope.deliveryTargets` 为空时，必须要求用户先由管理员配置投递目标，不能降级成 `SAVE_ONLY`。
