---
name: scheduled-task-edit
description: 通过独立对话修改已有定时任务，生成候选预览并等待用户确认，绝不直接覆盖正式版本。
---

# 定时任务修改

附加上下文中的 `scheduledTaskEdit` 是生成时冻结的任务配置。先询问用户具体希望修改什么；影响评分或调度的参数存在歧义时必须调用 `ask_user`，调用后立即结束本次运行。

当 `scheduledTaskEdit.mode` 为 `deterministic_scoring_builder` 时，只能提交结构化变更集，不得提交完整任务或投递设置。变更集固定使用 `scoring-task-agent-changes.v1`，包含 `generatedAtVersion`、`ambiguity` 和 `operations`。`operations` 只允许 `ADD_RULE`、`UPDATE_RULE`、`REMOVE_RULE`、`SET_UNIVERSE`、`SET_SCHEDULE`、`SET_SELECTION`、`SET_INDICATOR_PARAMS` 与 `SET_ADJUSTMENT`；规则使用完整规则对象。不得询问、读取、输出或修改 Webhook、凭证引用、启用状态和外部发送设置。完成后通过 `build_scheduled_task_edit_draft` 的 `changeSet` 参数提交，并等待用户在构建器整套应用。

修改时严格遵守以下流程：

1. 保留用户未要求改变的任务名称、目标、数据来源、执行计划、输出和投递设置。
2. 涉及任务目标或数据来源时，调用 `list_schedule_capabilities` 和 `inspect_schedule_capability` 核对能力。
3. 非确定性评分构建器模式才调用 `resolve_user_scope` 获取时区、用户范围和可用投递目标；不得请求或输出 Webhook URL。
4. 调用 `validate_schedule` 验证完整候选配置。
5. 仅当候选状态为 `SUPPORTED` 或无阻塞项的 `SUPPORTED_WITH_LIMITS` 时，调用 `build_scheduled_task_edit_draft`。
6. 告知用户检查修改预览并点击确认。不得自行确认、创建正式版本、改变任务状态或发送投递。

确认只能通过页面中的修改预览完成。不得用普通文本要求用户确认后再继续；信息不足时必须调用 `ask_user`，信息完整时必须在本次运行中生成修改预览。

非确定性评分构建器模式的候选必须包含 `name`、`userPrompt`、`schedule`、`dataSources`、`output` 和 `delivery`。输出配置包含 `format`、`includeEvidence`、`detailLevel` 和 `sendOnEmpty`。
